"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import type { Prisma } from "@prisma/client";
import type { ZodIssue } from "zod";

import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { isFutureDateInput, parseDateInput, toDateInputValue } from "@/lib/date";
import { activityActorName } from "@/lib/household-activity";
import { writeServerLog } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isFutureRecordTime } from "@/lib/record-time";
import {
  commitWithNewRecordImage,
  deleteRecordImage,
  getOptionalRecordImageFile,
  prepareRecordImage,
  RecordImageError
} from "@/lib/record-image";
import {
  createHealthRecordSchema,
  createMedicalRecordSchema,
  createMemoryRecordSchema,
  deleteHamsterRecordSchema,
  deleteSavedMemoryTagsSchema,
  updateHealthRecordSchema,
  updateMedicalRecordSchema,
  updateMemoryRecordSchema
} from "@/lib/record-schemas";
import {
  buildHealthRecordTitle,
  buildHealthSearchText,
  buildSavedMemoryTagRows,
  buildMedicalRecordTitle,
  buildMedicalSearchText,
  buildMemorySearchText,
  buildMemoryTagSearchValues,
  normalizeRecordScope,
  recordsUrl
} from "@/lib/records";
import { commitHouseholdMutation, getRealtimeActorId, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { handleServerActionError, logUnexpectedError } from "@/lib/server-errors";

type RecordCreateErrorStatus =
  | "invalid"
  | "invalidDate"
  | "invalidTime"
  | "futureTime"
  | "feeInvalid"
  | "future"
  | "recordImageTooLarge"
  | "recordImageUnsupported"
  | "recordImageInvalid";

export type RecordCreateActionResult = {
  success: true;
} | {
  success: false;
  errorMessage: string;
  errorId?: string;
  field?: "hamsterIds";
};

export type SavedMemoryTagDeleteActionResult = {
  success: true;
  deletedCount: number;
} | {
  success: false;
  errorMessage: string;
  errorId?: string;
};

const recordCreateErrorMessages: Record<RecordCreateErrorStatus, string> = {
  invalid: "入力内容を確認してください。",
  invalidDate: "日付を確認してください。",
  invalidTime: "時刻を確認してください。",
  futureTime: "未来の時刻には記録できません。",
  feeInvalid: "診察費は0円以上の整数で入力してください。",
  future: "未来日には記録できません。",
  recordImageTooLarge: "思い出の写真は10MB以内で選択してください。",
  recordImageUnsupported: "思い出の写真はJPEG、PNG、WebP形式を選択してください。",
  recordImageInvalid: "思い出の写真を読み込めませんでした。別の画像を選択してください。"
};

function recordCreateError(status: RecordCreateErrorStatus, field?: "hamsterIds"): RecordCreateActionResult {
  return {
    success: false,
    errorMessage: recordCreateErrorMessages[status],
    ...(field ? { field } : {})
  };
}

function unexpectedRecordCreateError(
  error: unknown,
  operation: string,
  hamsterId: FormDataEntryValue | null
): RecordCreateActionResult {
  unstable_rethrow(error);
  const errorId = logUnexpectedError(error, {
    operation,
    context: { hamsterId: typeof hamsterId === "string" ? hamsterId : undefined }
  });
  return { success: false, errorMessage: "処理に失敗しました。時間を空けて再度お試しください。", errorId };
}

function recordUrl(hamsterId: string | null | undefined, status: string, formData?: FormData) {
  const viewScopeValue = formData?.get("viewScope");
  const returnHamsterIdValue = formData?.get("returnHamsterId");
  const scope = normalizeRecordScope(typeof viewScopeValue === "string" ? viewScopeValue : undefined);
  const returnHamsterId =
    typeof returnHamsterIdValue === "string" && returnHamsterIdValue.trim()
      ? returnHamsterIdValue.trim()
      : hamsterId;
  return recordsUrl({ scope, includeScope: true, hamsterId: returnHamsterId, status });
}

function recordReturnSearchParams(hamsterId: string | null | undefined, formData: FormData) {
  return new URL(recordUrl(hamsterId, "", formData), "http://localhost").searchParams;
}

function recordRedirect(hamsterId: string | null | undefined, status: string, formData?: FormData): never {
  redirect(recordUrl(hamsterId, status, formData));
}

function validationStatus(issues: ZodIssue[]): RecordCreateErrorStatus {
  if (issues.some((issue) => issue.path[0] === "consultationFee")) return "feeInvalid";
  if (issues.some((issue) => issue.path[0] === "recordDate" || issue.path[0] === "nextVisitDate")) return "invalidDate";
  if (issues.some((issue) => issue.path[0] === "recordTime")) return "invalidTime";
  return "invalid";
}

function imageValidationStatus(error: InstanceType<typeof RecordImageError>): RecordCreateErrorStatus {
  if (error.code === "tooLarge") return "recordImageTooLarge";
  if (error.code === "unsupported") return "recordImageUnsupported";
  return "recordImageInvalid";
}

async function getMutationHamster(hamsterId: string, householdId: string, allowInactive: boolean) {
  const hamster = await prisma.hamster.findFirst({
    where: { id: hamsterId, householdId },
    select: { id: true, isActive: true }
  });
  if (!hamster) recordRedirect(hamsterId, "invalid");
  if (!allowInactive && !hamster.isActive) recordRedirect(hamsterId, "locked");
  return hamster;
}

function parseHealthForm(formData: FormData) {
  return {
    ...Object.fromEntries(formData),
    symptoms: formData.getAll("symptoms")
  };
}

function parseMemoryForm(formData: FormData) {
  return {
    ...Object.fromEntries(formData),
    hamsterIds: formData.getAll("hamsterIds")
  };
}

class InvalidMemoryHamstersError extends Error {}

async function assertMemoryHamstersBelongToHousehold(
  tx: Prisma.TransactionClient,
  hamsterIds: string[],
  householdId: string
) {
  const count = await tx.hamster.count({ where: { id: { in: hamsterIds }, householdId } });
  if (count !== hamsterIds.length) throw new InvalidMemoryHamstersError();
}

function isSameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nullableDateValue(value: Date | null) {
  return value ? toDateInputValue(value) : null;
}

async function deleteImageAfterMutation(householdId: string, fileName: string, operation: string, recordId: string) {
  // DB更新を正とし、後処理のファイル削除失敗で確定済みの記録操作を失敗扱いにしない。
  try {
    await deleteRecordImage(householdId, fileName);
  } catch (error) {
    writeServerLog("warn", {
      event: "record_image_delete_failed",
      message: "DB更新後の思い出画像削除に失敗しました。",
      operation,
      context: { householdId, recordId, errorName: error instanceof Error ? error.name : typeof error }
    });
  }
}

function publishAndRevalidate(change: Parameters<typeof publishHouseholdChangeSafely>[0], householdId: string, operation: string) {
  publishHouseholdChangeSafely(change);
  revalidatePathsSafely(
    [{ path: "/records" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
    `${operation}.revalidate`,
    { householdId }
  );
}

export async function createHealthRecord(formData: FormData): Promise<RecordCreateActionResult> {
  const hamsterId = formData.get("hamsterId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const result = createHealthRecordSchema.safeParse(parseHealthForm(formData));
    if (!result.success) return recordCreateError(validationStatus(result.error.issues));
    if (isFutureDateInput(result.data.recordDate)) return recordCreateError("future");
    if (isFutureRecordTime(result.data.recordDate, result.data.recordTime)) return recordCreateError("futureTime");
    await getMutationHamster(result.data.hamsterId, context.household.id, false);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "record",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: (tx) =>
        tx.hamsterRecord.create({
          data: {
            hamsterId: result.data.hamsterId,
            recordType: "HEALTH",
            recordDate: parseDateInput(result.data.recordDate),
            recordTimeMinutes: result.data.recordTime,
            title: buildHealthRecordTitle(result.data.overallCondition),
            memo: result.data.memo,
            searchText: buildHealthSearchText(result.data),
            createdByUserId: context.user.id,
            healthDetail: {
              create: {
                overallCondition: result.data.overallCondition,
                appetite: result.data.appetite,
                activityLevel: result.data.activityLevel,
                stoolCondition: result.data.stoolCondition,
                urineCondition: result.data.urineCondition,
                symptoms: result.data.symptoms
              }
            }
          },
          select: { id: true, recordDate: true, hamster: { select: { name: true } } }
        }),
      activity: (record) => ({
        eventType: "HEALTH_RECORD_CREATED",
        category: "CARE_RECORD",
        targetType: "HEALTH_RECORD",
        targetId: record.id,
        targetNameSnapshot: record.hamster.name,
        details: { recordDate: toDateInputValue(record.recordDate) }
      })
    });
    publishAndRevalidate(change, context.household.id, "records.health.create");
    return { success: true };
  } catch (error) {
    return unexpectedRecordCreateError(error, "records.health.create", hamsterId);
  }
}

export async function createMedicalRecord(formData: FormData): Promise<RecordCreateActionResult> {
  const hamsterId = formData.get("hamsterId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const result = createMedicalRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) return recordCreateError(validationStatus(result.error.issues));
    if (isFutureDateInput(result.data.recordDate)) return recordCreateError("future");
    await getMutationHamster(result.data.hamsterId, context.household.id, false);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "record",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: (tx) =>
        tx.hamsterRecord.create({
          data: {
            hamsterId: result.data.hamsterId,
            recordType: "MEDICAL",
            recordDate: parseDateInput(result.data.recordDate),
            title: buildMedicalRecordTitle(result.data.hospitalName),
            memo: result.data.memo,
            searchText: buildMedicalSearchText(result.data),
            createdByUserId: context.user.id,
            medicalDetail: {
              create: {
                hospitalName: result.data.hospitalName,
                reason: result.data.reason,
                diagnosis: result.data.diagnosis,
                examination: result.data.examination,
                treatment: result.data.treatment,
                medication: result.data.medication,
                medicationInstructions: result.data.medicationInstructions,
                nextVisitDate: result.data.nextVisitDate,
                consultationFee: result.data.consultationFee
              }
            }
          },
          select: { id: true, recordDate: true, hamster: { select: { name: true } } }
        }),
      activity: (record) => ({
        eventType: "MEDICAL_RECORD_CREATED",
        category: "CARE_RECORD",
        targetType: "MEDICAL_RECORD",
        targetId: record.id,
        targetNameSnapshot: record.hamster.name,
        details: { recordDate: toDateInputValue(record.recordDate) }
      })
    });
    publishAndRevalidate(change, context.household.id, "records.medical.create");
    return { success: true };
  } catch (error) {
    return unexpectedRecordCreateError(error, "records.medical.create", hamsterId);
  }
}

export async function createMemoryRecord(formData: FormData): Promise<RecordCreateActionResult> {
  const hamsterId = formData.get("hamsterId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const result = createMemoryRecordSchema.safeParse(parseMemoryForm(formData));
    if (!result.success) {
      const field = result.error.issues.some((issue) => issue.path[0] === "hamsterIds")
        ? "hamsterIds"
        : undefined;
      return recordCreateError(validationStatus(result.error.issues), field);
    }
    if (isFutureDateInput(result.data.recordDate)) return recordCreateError("future");
    await getMutationHamster(result.data.hamsterId, context.household.id, true);
    const imageFile = getOptionalRecordImageFile(formData.get("image"));
    const preparedImage = imageFile ? await prepareRecordImage(imageFile) : null;
    const commit = (fileName?: string) =>
      commitHouseholdMutation({
        householdId: context.household.id,
        source: "record",
        actorClientId: getRealtimeActorId(formData),
        actorUserId: context.user.id,
        actorNameSnapshot: activityActorName(context.user),
        mutate: async (tx) => {
          await assertMemoryHamstersBelongToHousehold(tx, result.data.hamsterIds, context.household.id);
          if (result.data.saveTags && result.data.tags.length > 0) {
            await tx.savedMemoryTag.createMany({
              data: buildSavedMemoryTagRows(context.household.id, context.user.id, result.data.tags),
              skipDuplicates: true
            });
          }
          return tx.hamsterRecord.create({
            data: {
              hamsterId: result.data.hamsterId,
              recordType: "MEMORY",
              recordDate: parseDateInput(result.data.recordDate),
              title: result.data.title,
              memo: result.data.content,
              searchText: buildMemorySearchText(result.data),
              createdByUserId: context.user.id,
              memoryDetail: {
                create: {
                  tags: result.data.tags,
                  searchTags: buildMemoryTagSearchValues(result.data.tags),
                  isFavorite: result.data.isFavorite,
                  hamsters: {
                    create: result.data.hamsterIds.map((targetHamsterId, sortOrder) => ({
                      hamsterId: targetHamsterId,
                      sortOrder
                    }))
                  },
                  ...(fileName ? { images: { create: { fileName, sortOrder: 0 } } } : {})
                }
              }
            },
            select: { id: true, recordDate: true, hamster: { select: { name: true } } }
          });
        },
        activity: (record) => ({
          eventType: "MEMORY_RECORD_CREATED",
          category: "CARE_RECORD",
          targetType: "MEMORY_RECORD",
          targetId: record.id,
          targetNameSnapshot: record.hamster.name,
          details: { recordDate: toDateInputValue(record.recordDate) }
        })
      });
    const { change } = preparedImage
      ? await commitWithNewRecordImage({ householdId: context.household.id, image: preparedImage, commit })
      : await commit();
    publishAndRevalidate(change, context.household.id, "records.memory.create");
    return { success: true };
  } catch (error) {
    if (error instanceof InvalidMemoryHamstersError) return recordCreateError("invalid", "hamsterIds");
    if (error instanceof RecordImageError) {
      return recordCreateError(imageValidationStatus(error));
    }
    return unexpectedRecordCreateError(error, "records.memory.create", hamsterId);
  }
}

export async function deleteSavedMemoryTags(formData: FormData): Promise<SavedMemoryTagDeleteActionResult> {
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const result = deleteSavedMemoryTagsSchema.safeParse({ tags: formData.getAll("tags") });
    if (!result.success) {
      return { success: false, errorMessage: "削除するタグを1件以上選択してください。" };
    }

    const { change, result: deleted } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "record",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      mutate: (tx) =>
        tx.savedMemoryTag.deleteMany({
          where: {
            householdId: context.household.id,
            name: { in: result.data.tags }
          }
        })
    });
    publishAndRevalidate(change, context.household.id, "records.memoryTag.deleteMany");
    return { success: true, deletedCount: deleted.count };
  } catch (error) {
    unstable_rethrow(error);
    const errorId = logUnexpectedError(error, { operation: "records.memoryTag.deleteMany" });
    return {
      success: false,
      errorMessage: "保存済みタグを削除できませんでした。時間を空けて再度お試しください。",
      errorId
    };
  }
}

async function getEditableRecord(id: string, hamsterId: string, householdId: string, formData: FormData) {
  const record = await prisma.hamsterRecord.findFirst({
    where: { id, hamsterId, hamster: { householdId } },
    include: {
      hamster: { select: { isActive: true, name: true } },
      healthDetail: true,
      medicalDetail: true,
      memoryDetail: {
        include: {
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
          hamsters: { orderBy: [{ sortOrder: "asc" }, { hamsterId: "asc" }] }
        }
      }
    }
  });
  if (!record) recordRedirect(hamsterId, "invalid", formData);
  return record;
}

export async function updateHealthRecord(formData: FormData) {
  const hamsterId = formData.get("hamsterId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const result = updateHealthRecordSchema.safeParse(parseHealthForm(formData));
    if (!result.success) recordRedirect(typeof hamsterId === "string" ? hamsterId : null, validationStatus(result.error.issues), formData);
    if (isFutureDateInput(result.data.recordDate)) recordRedirect(result.data.hamsterId, "future", formData);
    if (isFutureRecordTime(result.data.recordDate, result.data.recordTime)) recordRedirect(result.data.hamsterId, "futureTime", formData);
    const record = await getEditableRecord(result.data.id, result.data.hamsterId, context.household.id, formData);
    if (record.recordType !== "HEALTH" || !record.healthDetail) recordRedirect(result.data.hamsterId, "invalid", formData);
    if (!record.hamster.isActive) recordRedirect(result.data.hamsterId, "locked", formData);

    const detail = record.healthDetail;
    if (
      toDateInputValue(record.recordDate) === result.data.recordDate &&
      record.recordTimeMinutes === result.data.recordTime &&
      record.memo === result.data.memo &&
      detail.overallCondition === result.data.overallCondition &&
      detail.appetite === result.data.appetite &&
      detail.activityLevel === result.data.activityLevel &&
      detail.stoolCondition === result.data.stoolCondition &&
      detail.urineCondition === result.data.urineCondition &&
      isSameStringArray(detail.symptoms, result.data.symptoms)
    ) recordRedirect(result.data.hamsterId, "unchanged", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "record",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const updated = await tx.hamsterRecord.updateMany({
          where: { id: record.id, updatedAt: record.updatedAt },
          data: {
            recordDate: parseDateInput(result.data.recordDate),
            recordTimeMinutes: result.data.recordTime,
            title: buildHealthRecordTitle(result.data.overallCondition),
            memo: result.data.memo,
            searchText: buildHealthSearchText(result.data)
          }
        });
        if (updated.count !== 1) recordRedirect(result.data.hamsterId, "invalid", formData);
        await tx.healthRecordDetail.update({
          where: { hamsterRecordId: record.id },
          data: {
            overallCondition: result.data.overallCondition,
            appetite: result.data.appetite,
            activityLevel: result.data.activityLevel,
            stoolCondition: result.data.stoolCondition,
            urineCondition: result.data.urineCondition,
            symptoms: result.data.symptoms
          }
        });
        return tx.hamsterRecord.findUniqueOrThrow({
          where: { id: record.id },
          select: { id: true, recordDate: true, hamster: { select: { name: true } } }
        });
      },
      activity: (updatedRecord) => ({
        eventType: "HEALTH_RECORD_UPDATED",
        category: "CARE_RECORD",
        targetType: "HEALTH_RECORD",
        targetId: updatedRecord.id,
        targetNameSnapshot: updatedRecord.hamster.name,
        details: { recordDate: toDateInputValue(updatedRecord.recordDate) }
      })
    });
    publishAndRevalidate(change, context.household.id, "records.health.update");
    recordRedirect(result.data.hamsterId, "recordUpdated", formData);
  } catch (error) {
    handleServerActionError(error, {
      operation: "records.health.update",
      pathname: "/records",
      searchParams: recordReturnSearchParams(typeof hamsterId === "string" ? hamsterId : null, formData),
      context: { hamsterId: typeof hamsterId === "string" ? hamsterId : undefined }
    });
  }
}

export async function updateMedicalRecord(formData: FormData) {
  const hamsterId = formData.get("hamsterId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const result = updateMedicalRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) recordRedirect(typeof hamsterId === "string" ? hamsterId : null, validationStatus(result.error.issues), formData);
    if (isFutureDateInput(result.data.recordDate)) recordRedirect(result.data.hamsterId, "future", formData);
    const record = await getEditableRecord(result.data.id, result.data.hamsterId, context.household.id, formData);
    if (record.recordType !== "MEDICAL" || !record.medicalDetail) recordRedirect(result.data.hamsterId, "invalid", formData);
    if (!record.hamster.isActive) recordRedirect(result.data.hamsterId, "locked", formData);
    const detail = record.medicalDetail;
    if (
      toDateInputValue(record.recordDate) === result.data.recordDate &&
      record.memo === result.data.memo &&
      detail.hospitalName === result.data.hospitalName && detail.reason === result.data.reason &&
      detail.diagnosis === result.data.diagnosis && detail.examination === result.data.examination &&
      detail.treatment === result.data.treatment && detail.medication === result.data.medication &&
      detail.medicationInstructions === result.data.medicationInstructions &&
      nullableDateValue(detail.nextVisitDate) === nullableDateValue(result.data.nextVisitDate) &&
      (detail.consultationFee?.toString() ?? null) === (result.data.consultationFee?.toString() ?? null)
    ) recordRedirect(result.data.hamsterId, "unchanged", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "record",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const updated = await tx.hamsterRecord.updateMany({
          where: { id: record.id, updatedAt: record.updatedAt },
          data: {
            recordDate: parseDateInput(result.data.recordDate),
            title: buildMedicalRecordTitle(result.data.hospitalName),
            memo: result.data.memo,
            searchText: buildMedicalSearchText(result.data)
          }
        });
        if (updated.count !== 1) recordRedirect(result.data.hamsterId, "invalid", formData);
        await tx.medicalVisitDetail.update({
          where: { hamsterRecordId: record.id },
          data: {
            hospitalName: result.data.hospitalName,
            reason: result.data.reason,
            diagnosis: result.data.diagnosis,
            examination: result.data.examination,
            treatment: result.data.treatment,
            medication: result.data.medication,
            medicationInstructions: result.data.medicationInstructions,
            nextVisitDate: result.data.nextVisitDate,
            consultationFee: result.data.consultationFee
          }
        });
        return tx.hamsterRecord.findUniqueOrThrow({
          where: { id: record.id },
          select: { id: true, recordDate: true, hamster: { select: { name: true } } }
        });
      },
      activity: (updatedRecord) => ({
        eventType: "MEDICAL_RECORD_UPDATED",
        category: "CARE_RECORD",
        targetType: "MEDICAL_RECORD",
        targetId: updatedRecord.id,
        targetNameSnapshot: updatedRecord.hamster.name,
        details: { recordDate: toDateInputValue(updatedRecord.recordDate) }
      })
    });
    publishAndRevalidate(change, context.household.id, "records.medical.update");
    recordRedirect(result.data.hamsterId, "recordUpdated", formData);
  } catch (error) {
    handleServerActionError(error, {
      operation: "records.medical.update",
      pathname: "/records",
      searchParams: recordReturnSearchParams(typeof hamsterId === "string" ? hamsterId : null, formData),
      context: { hamsterId: typeof hamsterId === "string" ? hamsterId : undefined }
    });
  }
}

export async function updateMemoryRecord(formData: FormData) {
  const hamsterId = formData.get("hamsterId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const result = updateMemoryRecordSchema.safeParse(parseMemoryForm(formData));
    if (!result.success) recordRedirect(typeof hamsterId === "string" ? hamsterId : null, validationStatus(result.error.issues), formData);
    if (isFutureDateInput(result.data.recordDate)) recordRedirect(result.data.hamsterId, "future", formData);
    const record = await getEditableRecord(result.data.id, result.data.hamsterId, context.household.id, formData);
    if (record.recordType !== "MEMORY" || !record.memoryDetail) recordRedirect(result.data.hamsterId, "invalid", formData);
    const imageFile = getOptionalRecordImageFile(formData.get("image"));
    const removeImage = formData.get("removeImage") === "true";
    const oldImage = record.memoryDetail.images[0]?.fileName ?? null;
    const currentHamsterIds = record.memoryDetail.hamsters.map((entry) => entry.hamsterId);
    const representativeHamsterId = result.data.hamsterIds.includes(record.hamsterId)
      ? record.hamsterId
      : result.data.hamsterIds[0];
    if (
      toDateInputValue(record.recordDate) === result.data.recordDate && record.title === result.data.title &&
      record.memo === result.data.content && record.memoryDetail.isFavorite === result.data.isFavorite &&
      isSameStringArray(record.memoryDetail.tags, result.data.tags) &&
      isSameStringArray(currentHamsterIds, result.data.hamsterIds) &&
      !imageFile && !(removeImage && oldImage)
    ) recordRedirect(result.data.hamsterId, "unchanged", formData);

    const preparedImage = imageFile ? await prepareRecordImage(imageFile) : null;
    const commit = (fileName?: string | null) =>
      commitHouseholdMutation({
        householdId: context.household.id,
        source: "record",
        actorClientId: getRealtimeActorId(formData),
        actorUserId: context.user.id,
        actorNameSnapshot: activityActorName(context.user),
        mutate: async (tx) => {
          await assertMemoryHamstersBelongToHousehold(tx, result.data.hamsterIds, context.household.id);
          const updated = await tx.hamsterRecord.updateMany({
            where: { id: record.id, updatedAt: record.updatedAt },
            data: {
              hamsterId: representativeHamsterId,
              recordDate: parseDateInput(result.data.recordDate),
              title: result.data.title,
              memo: result.data.content,
              searchText: buildMemorySearchText(result.data)
            }
          });
          if (updated.count !== 1) recordRedirect(result.data.hamsterId, "invalid", formData);
          await tx.memoryRecordDetail.update({
            where: { hamsterRecordId: record.id },
            data: {
              tags: result.data.tags,
              searchTags: buildMemoryTagSearchValues(result.data.tags),
              isFavorite: result.data.isFavorite
            }
          });
          await tx.memoryRecordHamster.deleteMany({ where: { hamsterRecordId: record.id } });
          await tx.memoryRecordHamster.createMany({
            data: result.data.hamsterIds.map((targetHamsterId, sortOrder) => ({
              hamsterRecordId: record.id,
              hamsterId: targetHamsterId,
              sortOrder
            }))
          });
          // undefinedは画像を維持、nullは削除、文字列は置換として区別する。
          if (fileName !== undefined) {
            await tx.memoryRecordImage.deleteMany({ where: { memoryRecordId: record.id } });
            if (fileName) {
              await tx.memoryRecordImage.create({ data: { memoryRecordId: record.id, fileName, sortOrder: 0 } });
            }
          }
          return tx.hamsterRecord.findUniqueOrThrow({
            where: { id: record.id },
            select: { id: true, recordDate: true, hamster: { select: { name: true } } }
          });
        },
        activity: (updatedRecord) => ({
          eventType: "MEMORY_RECORD_UPDATED",
          category: "CARE_RECORD",
          targetType: "MEMORY_RECORD",
          targetId: updatedRecord.id,
          targetNameSnapshot: updatedRecord.hamster.name,
          details: { recordDate: toDateInputValue(updatedRecord.recordDate) }
        })
      });
    const { change } = preparedImage
      ? await commitWithNewRecordImage({ householdId: context.household.id, image: preparedImage, commit })
      : await commit(removeImage ? null : undefined);
    publishAndRevalidate(change, context.household.id, "records.memory.update");
    // 新しい参照の確定後に旧ファイルを消し、DBが削除済みファイルを指す状態を避ける。
    if ((preparedImage || removeImage) && oldImage) {
      await deleteImageAfterMutation(context.household.id, oldImage, "records.memory.update.deleteOldImage", record.id);
    }
    recordRedirect(result.data.hamsterId, "recordUpdated", formData);
  } catch (error) {
    if (error instanceof InvalidMemoryHamstersError) {
      recordRedirect(typeof hamsterId === "string" ? hamsterId : null, "invalid", formData);
    }
    if (error instanceof RecordImageError) {
      recordRedirect(typeof hamsterId === "string" ? hamsterId : null, imageValidationStatus(error), formData);
    }
    handleServerActionError(error, {
      operation: "records.memory.update",
      pathname: "/records",
      searchParams: recordReturnSearchParams(typeof hamsterId === "string" ? hamsterId : null, formData),
      context: { hamsterId: typeof hamsterId === "string" ? hamsterId : undefined }
    });
  }
}

export async function deleteHamsterRecord(formData: FormData) {
  const hamsterId = formData.get("hamsterId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const result = deleteHamsterRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) recordRedirect(typeof hamsterId === "string" ? hamsterId : null, "invalid", formData);
    const record = await getEditableRecord(result.data.id, result.data.hamsterId, context.household.id, formData);
    if (record.recordType !== "MEMORY" && !record.hamster.isActive) recordRedirect(result.data.hamsterId, "locked", formData);
    const imageFileName = record.memoryDetail?.images[0]?.fileName ?? null;
    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "record",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const target = await tx.hamsterRecord.findFirst({
          where: { id: result.data.id, hamsterId: result.data.hamsterId, hamster: { householdId: context.household.id } },
          select: { id: true, recordType: true, recordDate: true, hamster: { select: { name: true } } }
        });
        if (!target) recordRedirect(result.data.hamsterId, "invalid", formData);
        const deleted = await tx.hamsterRecord.deleteMany({
          where: { id: result.data.id, hamsterId: result.data.hamsterId, hamster: { householdId: context.household.id } }
        });
        if (deleted.count !== 1) recordRedirect(result.data.hamsterId, "invalid", formData);
        return target;
      },
      activity: (deletedRecord) => ({
        eventType: deletedRecord.recordType === "HEALTH"
          ? "HEALTH_RECORD_DELETED"
          : deletedRecord.recordType === "MEDICAL"
            ? "MEDICAL_RECORD_DELETED"
            : "MEMORY_RECORD_DELETED",
        category: "CARE_RECORD",
        targetType: deletedRecord.recordType === "HEALTH"
          ? "HEALTH_RECORD"
          : deletedRecord.recordType === "MEDICAL"
            ? "MEDICAL_RECORD"
            : "MEMORY_RECORD",
        targetId: deletedRecord.id,
        targetNameSnapshot: deletedRecord.hamster.name,
        details: { recordDate: toDateInputValue(deletedRecord.recordDate) }
      })
    });
    publishAndRevalidate(change, context.household.id, "records.delete");
    if (imageFileName) {
      await deleteImageAfterMutation(context.household.id, imageFileName, "records.delete.deleteImage", record.id);
    }
    recordRedirect(result.data.hamsterId, "recordDeleted", formData);
  } catch (error) {
    handleServerActionError(error, {
      operation: "records.delete",
      pathname: "/records",
      searchParams: recordReturnSearchParams(typeof hamsterId === "string" ? hamsterId : null, formData),
      context: { hamsterId: typeof hamsterId === "string" ? hamsterId : undefined }
    });
  }
}
