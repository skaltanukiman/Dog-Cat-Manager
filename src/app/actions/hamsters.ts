"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import type { Prisma } from "@prisma/client";
import type { ZodIssue } from "zod";

import { belongsToCurrentHousehold } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { activityActorName } from "@/lib/household-activity";
import {
  commitWithNewHamsterImage,
  deleteHamsterImage,
  deleteHamsterImageRecords,
  getOptionalImageFile,
  HamsterImageError,
  prepareHamsterImage
} from "@/lib/hamster-image";
import { writeServerLog } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { deleteRecordImage } from "@/lib/record-image";
import { planMemoryRecordsForHamsterDeletion } from "@/lib/records";
import { commitHouseholdMutation, getRealtimeActorId, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { handleServerActionError, isPrismaUniqueConstraintError, logUnexpectedError } from "@/lib/server-errors";
import {
  createHamsterSchema,
  deleteHamstersSchema,
  deleteHamsterSchema,
  updateHamsterActiveStatusSchema,
  updateHamsterSchema
} from "@/lib/schemas";

function isSameNullableDate(first: Date | null, second: Date | null) {
  if (first === null || second === null) {
    return first === second;
  }

  return first.getTime() === second.getTime();
}

// maxLengthをすり抜けて送信された場合でも、文字数超過は項目別のメッセージに分ける。
function hamsterValidationStatus(issues: ZodIssue[]) {
  if (issues.some((issue) => issue.path[0] === "name" && issue.code === "too_big")) {
    return "hamsterNameTooLong";
  }

  if (issues.some((issue) => issue.path[0] === "memo" && issue.code === "too_big")) {
    return "hamsterMemoTooLong";
  }

  // 誕生日・お迎え日の未来日だけは、入力不備の理由が伝わるように専用メッセージへ振り分ける。
  if (issues.some((issue) => ["birthDate", "adoptionDate"].includes(String(issue.path[0])) && issue.message === "future")) {
    return "future";
  }

  return "invalid";
}

function hamsterImageValidationStatus(error: HamsterImageError) {
  if (error.code === "tooLarge") return "hamsterImageTooLarge";
  if (error.code === "unsupported") return "hamsterImageUnsupported";
  return "hamsterImageInvalid";
}

async function deleteImageAfterMutation(householdId: string, fileName: string, operation: string, hamsterId?: string) {
  try {
    await deleteHamsterImage(householdId, fileName);
  } catch (error) {
    writeServerLog("warn", {
      event: "hamster_image_delete_failed",
      message: "DB更新後のハムスター画像削除に失敗しました。",
      operation,
      context: {
        householdId,
        hamsterId,
        errorName: error instanceof Error ? error.name : typeof error
      }
    });
  }
}

async function deleteRecordImagesAfterHamsterMutation(
  householdId: string,
  records: Array<{ id: string; memoryDetail: { images: Array<{ fileName: string }> } | null }>,
  operation: string
) {
  const deletedFileNames = new Set<string>();
  for (const record of records) {
    for (const image of record.memoryDetail?.images ?? []) {
      if (deletedFileNames.has(image.fileName)) continue;
      deletedFileNames.add(image.fileName);
      try {
        await deleteRecordImage(householdId, image.fileName);
      } catch (error) {
        writeServerLog("warn", {
          event: "record_image_delete_failed",
          message: "ハムスター削除後の思い出画像削除に失敗しました。",
          operation,
          context: { householdId, hamsterRecordId: record.id, errorName: error instanceof Error ? error.name : typeof error }
        });
      }
    }
  }
}

async function prepareMemoryRecordsForHamsterDeletion(
  tx: Prisma.TransactionClient,
  householdId: string,
  hamsterIds: string[]
) {
  const records = await tx.hamsterRecord.findMany({
    where: {
      recordType: "MEMORY",
      hamster: { householdId },
      OR: [
        { hamsterId: { in: hamsterIds } },
        { memoryDetail: { is: { hamsters: { some: { hamsterId: { in: hamsterIds } } } } } }
      ]
    },
    select: {
      id: true,
      hamsterId: true,
      memoryDetail: {
        select: {
          hamsters: {
            orderBy: [{ sortOrder: "asc" }, { hamsterId: "asc" }],
            select: { hamsterId: true }
          },
          images: { select: { fileName: true } }
        }
      }
    }
  });
  const plans = planMemoryRecordsForHamsterDeletion(
    records.map((record) => ({
      id: record.id,
      representativeHamsterId: record.hamsterId,
      hamsterIds: record.memoryDetail?.hamsters.map((entry) => entry.hamsterId) ?? [],
      imageFileNames: record.memoryDetail?.images.map((image) => image.fileName) ?? []
    })),
    hamsterIds
  );
  const representatives = new Map(records.map((record) => [record.id, record.hamsterId]));

  for (const plan of plans) {
    if (
      !plan.deleteRecord &&
      plan.nextRepresentativeHamsterId &&
      plan.nextRepresentativeHamsterId !== representatives.get(plan.recordId)
    ) {
      await tx.hamsterRecord.update({
        where: { id: plan.recordId },
        data: { hamsterId: plan.nextRepresentativeHamsterId }
      });
    }
  }

  const deletedRecordIds = plans.filter((plan) => plan.deleteRecord).map((plan) => plan.recordId);
  if (deletedRecordIds.length > 0) {
    await tx.hamsterRecord.deleteMany({
      where: { id: { in: deletedRecordIds }, recordType: "MEMORY", hamster: { householdId } }
    });
  }

  return plans
    .filter((plan) => plan.deleteRecord)
    .map((plan) => ({
      id: plan.recordId,
      memoryDetail: { images: plan.imageFileNamesToDelete.map((fileName) => ({ fileName })) }
    }));
}

export async function createHamster(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/hamsters");
    const result = createHamsterSchema.safeParse(Object.fromEntries(formData));

    if (!result.success) {
      redirect(`/hamsters?status=${hamsterValidationStatus(result.error.issues)}`);
    }

    const imageFile = getOptionalImageFile(formData.get("profileImage"));
    const preparedImage = imageFile ? await prepareHamsterImage(imageFile) : null;
    const commit = (profileImageFileName?: string) =>
      commitHouseholdMutation({
        householdId: context.household.id,
        source: "hamster",
        actorClientId: getRealtimeActorId(formData),
        actorUserId: context.user.id,
        actorNameSnapshot: activityActorName(context.user),
        mutate: (tx) =>
          tx.hamster.create({
            data: {
              ...result.data,
              householdId: context.household.id,
              profileImageFileName
            }
          }),
        activity: (hamster) => ({
          eventType: "HAMSTER_CREATED",
          category: "CARE_RECORD",
          targetType: "HAMSTER",
          targetId: hamster.id,
          targetNameSnapshot: hamster.name
        })
      });
    const { change } = preparedImage
      ? await commitWithNewHamsterImage({ householdId: context.household.id, image: preparedImage, commit })
      : await commit();
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/" }, { path: "/hamsters" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "hamsters.create.revalidate", {
      householdId: context.household.id
    });
    redirect("/hamsters?status=created");
  } catch (error) {
    if (error instanceof HamsterImageError) {
      redirect(`/hamsters?status=${hamsterImageValidationStatus(error)}`);
    }

    if (isPrismaUniqueConstraintError(error)) {
      redirect("/hamsters?status=hamsterDuplicate");
    }

    handleServerActionError(error, { operation: "hamsters.create", pathname: "/hamsters" });
  }
}

export async function updateHamster(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/hamsters");
    const result = updateHamsterSchema.safeParse(Object.fromEntries(formData));

    if (!result.success) {
      redirect(`/hamsters?status=${hamsterValidationStatus(result.error.issues)}`);
    }

    const { id, ...data } = result.data;
    const hamster = await prisma.hamster.findUnique({
      where: { id },
      select: {
        householdId: true,
        name: true,
        memo: true,
        birthDate: true,
        adoptionDate: true,
        profileImageFileName: true,
        isActive: true,
        updatedAt: true
      }
    });

    if (!hamster || !belongsToCurrentHousehold(hamster.householdId, context.household.id)) {
      redirect("/hamsters?status=invalid");
    }

    if (!hamster.isActive) {
      redirect("/hamsters?status=locked");
    }

    const imageFile = getOptionalImageFile(formData.get("profileImage"));
    const removeProfileImage = formData.get("removeProfileImage") === "true";

    if (
      hamster.name === data.name &&
      hamster.memo === data.memo &&
      isSameNullableDate(hamster.birthDate, data.birthDate) &&
      isSameNullableDate(hamster.adoptionDate, data.adoptionDate) &&
      !imageFile &&
      !(removeProfileImage && hamster.profileImageFileName)
    ) {
      redirect("/hamsters?status=unchanged");
    }

    const preparedImage = imageFile ? await prepareHamsterImage(imageFile) : null;
    const imageAction = preparedImage
      ? hamster.profileImageFileName ? "REPLACED" : "ADDED"
      : removeProfileImage && hamster.profileImageFileName ? "REMOVED" : null;
    const commit = (profileImageFileName?: string | null) =>
      commitHouseholdMutation({
        householdId: context.household.id,
        source: "hamster",
        actorClientId: getRealtimeActorId(formData),
        actorUserId: context.user.id,
        actorNameSnapshot: activityActorName(context.user),
        mutate: async (tx) => {
          const updated = await tx.hamster.updateMany({
            where: { id, householdId: context.household.id, isActive: true, updatedAt: hamster.updatedAt },
            data: {
              ...data,
              ...(profileImageFileName !== undefined ? { profileImageFileName } : {})
            }
          });
          if (updated.count !== 1) redirect("/hamsters?status=invalid");
          return tx.hamster.findUniqueOrThrow({ where: { id }, select: { id: true, name: true } });
        },
        activity: imageAction ? (updatedHamster) => ({
          eventType: "HAMSTER_PROFILE_IMAGE_UPDATED",
          category: "CARE_RECORD",
          targetType: "HAMSTER",
          targetId: updatedHamster.id,
          targetNameSnapshot: updatedHamster.name,
          details: { imageAction }
        }) : null
      });
    const { change } = preparedImage
      ? await commitWithNewHamsterImage({ householdId: context.household.id, image: preparedImage, commit })
      : await commit(removeProfileImage ? null : undefined);
    publishHouseholdChangeSafely(change);
    if ((preparedImage || removeProfileImage) && hamster.profileImageFileName) {
      await deleteImageAfterMutation(context.household.id, hamster.profileImageFileName, "hamsters.update.deleteOldImage", id);
    }
    revalidatePathsSafely(
      [
        { path: "/" },
        { path: "/hamsters" },
        ...(imageAction ? [{ path: "/settings/members" }, { path: "/settings/members/activity" }] : [])
      ],
      "hamsters.update.revalidate",
      { householdId: context.household.id, hamsterId: id }
    );
    redirect("/hamsters?status=updated");
  } catch (error) {
    if (error instanceof HamsterImageError) {
      redirect(`/hamsters?status=${hamsterImageValidationStatus(error)}`);
    }

    if (isPrismaUniqueConstraintError(error)) {
      redirect("/hamsters?status=hamsterDuplicate");
    }

    handleServerActionError(error, { operation: "hamsters.update", pathname: "/hamsters" });
  }
}

export type HamsterActiveStatusActionResult =
  | { success: true; status: "updated"; errorId?: never }
  | { success: false; status: "invalid" | "unchanged"; errorId?: never }
  | { success: false; status: "systemError"; errorId: string };

class HamsterActiveStatusResultError extends Error {
  constructor(readonly status: "invalid" | "unchanged") {
    super(status);
    this.name = "HamsterActiveStatusResultError";
  }
}

export async function updateHamsterActiveStatus(formData: FormData): Promise<HamsterActiveStatusActionResult> {
  try {
    const context = await getRequiredHouseholdMutationContext("/hamsters");
    const result = updateHamsterActiveStatusSchema.safeParse(Object.fromEntries(formData));

    if (!result.success) return { success: false, status: "invalid" };

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "hamster",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const hamster = await tx.hamster.findFirst({
          where: { id: result.data.id, householdId: context.household.id },
          select: { id: true, name: true, isActive: true }
        });
        if (!hamster) throw new HamsterActiveStatusResultError("invalid");
        if (hamster.isActive === result.data.isActive) throw new HamsterActiveStatusResultError("unchanged");
        const updated = await tx.hamster.updateMany({
          where: { id: result.data.id, householdId: context.household.id, isActive: hamster.isActive },
          data: { isActive: result.data.isActive }
        });
        if (updated.count !== 1) throw new HamsterActiveStatusResultError("invalid");
        return {
          id: hamster.id,
          name: hamster.name,
          previousIsActive: hamster.isActive,
          newIsActive: result.data.isActive
        };
      },
      activity: (hamster) => ({
        eventType: "HAMSTER_ACTIVE_STATUS_UPDATED",
        category: "CARE_RECORD",
        targetType: "HAMSTER",
        targetId: hamster.id,
        targetNameSnapshot: hamster.name,
        details: { previousIsActive: hamster.previousIsActive, newIsActive: hamster.newIsActive }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      ["/", "/hamsters", "/cleaning", "/weights", "/settings", "/settings/members", "/settings/members/activity"].map((path) => ({ path })),
      "hamsters.activeStatus.revalidate",
      { householdId: context.household.id, hamsterId: result.data.id }
    );
    return { success: true, status: "updated" };
  } catch (error) {
    if (error instanceof HamsterActiveStatusResultError) {
      return { success: false, status: error.status };
    }
    unstable_rethrow(error);
    const errorId = logUnexpectedError(error, {
      operation: "hamsters.activeStatus",
      context: {
        hamsterId: typeof formData.get("id") === "string" ? String(formData.get("id")) : undefined
      }
    });
    return { success: false, status: "systemError", errorId };
  }
}

export async function deleteHamster(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/hamsters");
    const result = deleteHamsterSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) redirect("/hamsters?status=invalid");

    const hamster = await prisma.hamster.findFirst({
      where: { id: result.data.id, householdId: context.household.id },
      select: {
        name: true,
        profileImageFileName: true
      }
    });
    if (!hamster) redirect("/hamsters?status=invalid");

    const { change, result: deletedMemoryRecords } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "hamster",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      activity: {
        eventType: "HAMSTER_DELETED",
        category: "CARE_RECORD",
        targetType: "HAMSTER",
        targetId: result.data.id,
        targetNameSnapshot: hamster.name
      },
      mutate: async (tx) => {
        const memoryRecords = await prepareMemoryRecordsForHamsterDeletion(
          tx,
          context.household.id,
          [result.data.id]
        );
        const deleted = await tx.hamster.deleteMany({ where: { id: result.data.id, householdId: context.household.id } });
        if (deleted.count !== 1) redirect("/hamsters?status=invalid");
        return memoryRecords;
      }
    });
    publishHouseholdChangeSafely(change);
    await deleteHamsterImageRecords([{ id: result.data.id, ...hamster }], (record) =>
      deleteImageAfterMutation(
        context.household.id,
        record.profileImageFileName!,
        "hamsters.delete.deleteImage",
        record.id
      )
    );
    await deleteRecordImagesAfterHamsterMutation(
      context.household.id,
      deletedMemoryRecords,
      "hamsters.delete.deleteRecordImages"
    );
    revalidatePathsSafely([{ path: "/" }, { path: "/hamsters" }, { path: "/records" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "hamsters.delete.revalidate", {
      householdId: context.household.id,
      hamsterId: result.data.id
    });
    redirect("/hamsters?status=deleted");
  } catch (error) {
    handleServerActionError(error, { operation: "hamsters.delete", pathname: "/hamsters" });
  }
}

export async function deleteHamsters(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/hamsters");
    const result = deleteHamstersSchema.safeParse({ ids: formData.getAll("ids") });
    if (!result.success) redirect("/hamsters?status=invalid");

    const hamsters = await prisma.hamster.findMany({
      where: { id: { in: result.data.ids }, householdId: context.household.id },
      select: {
        id: true,
        name: true,
        profileImageFileName: true
      }
    });
    if (hamsters.length !== result.data.ids.length) redirect("/hamsters?status=invalid");

    const { change, result: deletedMemoryRecords } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "hamster",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      activity: hamsters.map((hamster) => ({
        eventType: "HAMSTER_DELETED" as const,
        category: "CARE_RECORD" as const,
        targetType: "HAMSTER",
        targetId: hamster.id,
        targetNameSnapshot: hamster.name
      })),
      mutate: async (tx) => {
        const memoryRecords = await prepareMemoryRecordsForHamsterDeletion(
          tx,
          context.household.id,
          result.data.ids
        );
        const deleted = await tx.hamster.deleteMany({
          where: { id: { in: result.data.ids }, householdId: context.household.id }
        });
        if (deleted.count !== result.data.ids.length) redirect("/hamsters?status=invalid");
        return memoryRecords;
      }
    });
    publishHouseholdChangeSafely(change);
    await deleteHamsterImageRecords(hamsters, (hamster) =>
      deleteImageAfterMutation(
        context.household.id,
        hamster.profileImageFileName!,
        "hamsters.deleteMany.deleteImage",
        hamster.id
      )
    );
    await deleteRecordImagesAfterHamsterMutation(
      context.household.id,
      deletedMemoryRecords,
      "hamsters.deleteMany.deleteRecordImages"
    );
    revalidatePathsSafely(
      ["/", "/hamsters", "/records", "/cleaning", "/weights", "/settings", "/settings/members", "/settings/members/activity"].map((path) => ({ path })),
      "hamsters.deleteMany.revalidate",
      { householdId: context.household.id, targetCount: result.data.ids.length }
    );
    redirect("/hamsters?status=deleted");
  } catch (error) {
    handleServerActionError(error, { operation: "hamsters.deleteMany", pathname: "/hamsters" });
  }
}
