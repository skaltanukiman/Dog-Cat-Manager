"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { isFutureDateInput, parseDateInput, toDateInputValue } from "@/lib/date";
import { activityActorName } from "@/lib/household-activity";
import { writeServerLog } from "@/lib/logger";
import {
  commitWithNewPetRecordImage,
  deletePetRecordImage,
  getOptionalPetRecordImageFile,
  preparePetRecordImage,
  PetRecordImageError
} from "@/lib/pet-record-image";
import {
  assertCurrentPetRecordMutationPermission,
  assertExpectedPetRecordVersion,
  getActiveMutationPets,
  knownPetRecordCreateError,
  parsePetMemoryRecordForm,
  petRecordActivity,
  petRecordCreateError,
  PetRecordConflictError,
  PetRecordHouseholdBoundaryError,
  petRecordReturnSearchParams,
  petRecordReturnUrl,
  petRecordValidationStatus,
  publishAndRevalidatePetRecord,
  redirectKnownPetRecordMutationError,
  unexpectedPetRecordCreateError,
  type PetRecordCreateActionResult,
  type SavedMemoryTagDeleteActionResult
} from "@/lib/pet-record-mutations";
import {
  createPetMemoryRecordSchema,
  deletePetSavedMemoryTagsSchema,
  updatePetMemoryRecordSchema
} from "@/lib/pet-record-schemas";
import {
  buildPetMemorySearchText,
  buildPetMemoryTagSearchValues,
  buildPetSavedMemoryTagRows,
  isSameOrderedStringArray
} from "@/lib/pet-records";
import { prisma } from "@/lib/prisma";
import { isFutureRecordTime } from "@/lib/record-time";
import { commitHouseholdMutation, getRealtimeActorId } from "@/lib/realtime";
import { handleServerActionError, logUnexpectedError } from "@/lib/server-errors";

export type { PetRecordCreateActionResult, SavedMemoryTagDeleteActionResult } from "@/lib/pet-record-mutations";

function imageCreateError(error: InstanceType<typeof PetRecordImageError>): PetRecordCreateActionResult {
  if (error.code === "tooLarge") return petRecordCreateError("imageTooLarge");
  if (error.code === "unsupported") return petRecordCreateError("imageUnsupported");
  return petRecordCreateError("imageInvalid");
}

function imageRedirectStatus(error: InstanceType<typeof PetRecordImageError>) {
  if (error.code === "tooLarge") return "petRecordImageTooLarge";
  if (error.code === "unsupported") return "petRecordImageUnsupported";
  return "petRecordImageInvalid";
}

async function deleteImageAfterCommit(householdId: string, fileName: string, operation: string, recordId: string) {
  // DBの参照更新を正とし、後処理失敗で確定済みmutationを失敗扱いにしない。
  try {
    await deletePetRecordImage(householdId, fileName);
  } catch (error) {
    writeServerLog("warn", {
      event: "pet_record_image_delete_failed",
      message: "DB更新後のPet思い出画像削除に失敗しました。",
      operation,
      context: { householdId, recordId, errorName: error instanceof Error ? error.name : typeof error }
    });
  }
}

/** 複数Pet・タグ・画像を、Pet Record本体と同じHousehold transactionへ保存する。 */
export async function createPetMemoryRecord(formData: FormData): Promise<PetRecordCreateActionResult> {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = createPetMemoryRecordSchema.safeParse(parsePetMemoryRecordForm(formData));
    if (!parsed.success) {
      return petRecordCreateError(
        petRecordValidationStatus(parsed.error.issues),
        parsed.error.issues.some((issue) => issue.path[0] === "petIds") ? "petIds" : undefined
      );
    }
    if (isFutureDateInput(parsed.data.recordDate)) return petRecordCreateError("future");
    if (isFutureRecordTime(parsed.data.recordDate, parsed.data.recordTime)) return petRecordCreateError("futureTime");

    const candidatePets = await prisma.pet.findMany({
      where: { id: { in: parsed.data.petIds }, householdId: context.household.id },
      select: { isActive: true }
    });
    if (candidatePets.length !== parsed.data.petIds.length) {
      return petRecordCreateError("householdInvalid", "petIds");
    }
    if (candidatePets.some((pet) => !pet.isActive)) return petRecordCreateError("locked", "petIds");

    const imageFile = getOptionalPetRecordImageFile(formData.get("image"));
    const preparedImage = imageFile ? await preparePetRecordImage(imageFile) : null;
    const commit = (fileName?: string) =>
      commitHouseholdMutation({
        householdId: context.household.id,
        source: "petRecord",
        actorClientId: getRealtimeActorId(formData),
        actorUserId: context.user.id,
        actorNameSnapshot: activityActorName(context.user),
        mutate: async (tx) => {
          await assertCurrentPetRecordMutationPermission(tx, context.household.id, context.user.id);
          const pets = await getActiveMutationPets(tx, parsed.data.petIds, context.household.id);
          if (!parsed.data.petIds.includes(parsed.data.petId)) throw new PetRecordHouseholdBoundaryError();
          if (parsed.data.saveTags && parsed.data.tags.length > 0) {
            await tx.savedMemoryTag.createMany({
              data: buildPetSavedMemoryTagRows(context.household.id, context.user.id, parsed.data.tags),
              skipDuplicates: true
            });
          }
          return tx.petRecord.create({
            data: {
              petId: parsed.data.petId,
              recordType: "MEMORY",
              recordDate: parseDateInput(parsed.data.recordDate),
              recordTimeMinutes: parsed.data.recordTime,
              title: parsed.data.title,
              memo: parsed.data.content,
              searchText: buildPetMemorySearchText(parsed.data, pets.map((pet) => pet.name)),
              createdByUserId: context.user.id,
              memoryDetail: {
                create: {
                  tags: parsed.data.tags,
                  searchTags: buildPetMemoryTagSearchValues(parsed.data.tags),
                  isFavorite: parsed.data.isFavorite,
                  pets: {
                    create: parsed.data.petIds.map((targetPetId, sortOrder) => ({ petId: targetPetId, sortOrder }))
                  },
                  ...(fileName ? { images: { create: { fileName, sortOrder: 0 } } } : {})
                }
              }
            },
            select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
          });
        },
        activity: (created) => petRecordActivity("created", created)
      });

    const transactionResult = preparedImage
      ? await commitWithNewPetRecordImage({ householdId: context.household.id, image: preparedImage, commit })
      : await commit();
    publishAndRevalidatePetRecord(
      transactionResult.change,
      context.household.id,
      "petRecords.memory.create",
      transactionResult.result.id
    );
    return { success: true };
  } catch (error) {
    if (error instanceof PetRecordImageError) return imageCreateError(error);
    return knownPetRecordCreateError(error, "petIds") ?? unexpectedPetRecordCreateError(error, "petRecords.memory.create", petId);
  }
}

/** 画像補償と関連Petの順序・active状態を保ちながら思い出を楽観ロック更新する。 */
export async function updatePetMemoryRecord(formData: FormData) {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = updatePetMemoryRecordSchema.safeParse(parsePetMemoryRecordForm(formData));
    if (!parsed.success) {
      const status = petRecordValidationStatus(parsed.error.issues);
      redirect(petRecordReturnUrl(typeof petId === "string" ? petId : null, `petRecord${status[0].toUpperCase()}${status.slice(1)}`, formData));
    }
    if (isFutureDateInput(parsed.data.recordDate)) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFuture", formData));
    if (isFutureRecordTime(parsed.data.recordDate, parsed.data.recordTime)) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFutureTime", formData));
    }

    const current = await prisma.petRecord.findFirst({
      where: { id: parsed.data.id, petId: parsed.data.petId, recordType: "MEMORY", pet: { householdId: context.household.id } },
      select: {
        id: true,
        petId: true,
        recordDate: true,
        recordTimeMinutes: true,
        title: true,
        memo: true,
        updatedAt: true,
        pet: { select: { isActive: true } },
        memoryDetail: {
          select: {
            tags: true,
            isFavorite: true,
            pets: {
              orderBy: [{ sortOrder: "asc" }, { petId: "asc" }],
              select: { petId: true, pet: { select: { householdId: true, isActive: true } } }
            },
            images: { orderBy: { sortOrder: "asc" }, take: 1, select: { fileName: true } }
          }
        }
      }
    });
    if (!current || !current.memoryDetail) redirect(petRecordReturnUrl(typeof petId === "string" ? petId : null, "petRecordPetInvalid", formData));
    const currentPetIds = current.memoryDetail.pets.map((entry) => entry.petId);
    if (current.memoryDetail.pets.some((entry) => entry.pet.householdId !== context.household.id)) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordHouseholdInvalid", formData));
    }
    if (!current.pet.isActive || current.memoryDetail.pets.some((entry) => !entry.pet.isActive)) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordLocked", formData));
    }
    if (current.updatedAt.getTime() !== parsed.data.updatedAt.getTime()) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordConflict", formData));
    }
    const candidatePets = await prisma.pet.findMany({
      where: { id: { in: parsed.data.petIds }, householdId: context.household.id },
      select: { isActive: true }
    });
    if (candidatePets.length !== parsed.data.petIds.length) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordHouseholdInvalid", formData));
    }
    if (candidatePets.some((pet) => !pet.isActive)) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordLocked", formData));
    }
    const imageFile = getOptionalPetRecordImageFile(formData.get("image"));
    const removeImage = formData.get("removeImage") === "true" || formData.get("removeImage") === "on";
    const oldImageFileName = current.memoryDetail.images[0]?.fileName ?? null;
    const representativePetId = parsed.data.petIds.includes(current.petId) ? current.petId : parsed.data.petIds[0];
    if (
      toDateInputValue(current.recordDate) === parsed.data.recordDate &&
      current.recordTimeMinutes === parsed.data.recordTime &&
      current.title === parsed.data.title &&
      current.memo === parsed.data.content &&
      current.memoryDetail.isFavorite === parsed.data.isFavorite &&
      isSameOrderedStringArray(current.memoryDetail.tags, parsed.data.tags) &&
      isSameOrderedStringArray(currentPetIds, parsed.data.petIds) &&
      current.petId === representativePetId &&
      !imageFile &&
      !(removeImage && oldImageFileName)
    ) {
      redirect(petRecordReturnUrl(parsed.data.petId, "unchanged", formData));
    }

    const preparedImage = imageFile ? await preparePetRecordImage(imageFile) : null;
    const commit = (fileName?: string | null) =>
      commitHouseholdMutation({
        householdId: context.household.id,
        source: "petRecord",
        actorClientId: getRealtimeActorId(formData),
        actorUserId: context.user.id,
        actorNameSnapshot: activityActorName(context.user),
        mutate: async (tx) => {
          await assertCurrentPetRecordMutationPermission(tx, context.household.id, context.user.id);
          const transactionRecord = await tx.petRecord.findFirst({
            where: {
              id: parsed.data.id,
              petId: parsed.data.petId,
              recordType: "MEMORY",
              pet: { householdId: context.household.id }
            },
            select: {
              memoryDetail: {
                select: {
                  pets: {
                    orderBy: [{ sortOrder: "asc" }, { petId: "asc" }],
                    select: { petId: true }
                  }
                }
              }
            }
          });
          if (!transactionRecord?.memoryDetail) throw new PetRecordHouseholdBoundaryError();
          const transactionCurrentPetIds = transactionRecord.memoryDetail.pets.map((entry) => entry.petId);
          if (!isSameOrderedStringArray(currentPetIds, transactionCurrentPetIds)) {
            throw new PetRecordConflictError();
          }
          // 既存関連Petを外して更新する場合も、管理終了状態を迂回できないよう両集合を確認する。
          const allPetIds = [...new Set([...transactionCurrentPetIds, ...parsed.data.petIds])];
          const pets = await getActiveMutationPets(tx, allPetIds, context.household.id);
          await assertExpectedPetRecordVersion(tx, parsed.data.id, parsed.data.updatedAt, context.household.id, "MEMORY");
          const selectedPetNames = new Map(pets.map((pet) => [pet.id, pet.name]));
          const updated = await tx.petRecord.updateMany({
            where: {
              id: parsed.data.id,
              petId: parsed.data.petId,
              recordType: "MEMORY",
              updatedAt: parsed.data.updatedAt,
              pet: { householdId: context.household.id, isActive: true }
            },
            data: {
              petId: representativePetId,
              recordDate: parseDateInput(parsed.data.recordDate),
              recordTimeMinutes: parsed.data.recordTime,
              title: parsed.data.title,
              memo: parsed.data.content,
              searchText: buildPetMemorySearchText(
                parsed.data,
                parsed.data.petIds.map((targetPetId) => selectedPetNames.get(targetPetId) ?? "")
              )
            }
          });
          if (updated.count !== 1) throw new PetRecordConflictError();
          await tx.petMemoryRecordDetail.update({
            where: { petRecordId: parsed.data.id },
            data: {
              tags: parsed.data.tags,
              searchTags: buildPetMemoryTagSearchValues(parsed.data.tags),
              isFavorite: parsed.data.isFavorite
            }
          });
          if (!isSameOrderedStringArray(currentPetIds, parsed.data.petIds)) {
            await tx.petMemoryRecordPet.deleteMany({ where: { petRecordId: parsed.data.id } });
            await tx.petMemoryRecordPet.createMany({
              data: parsed.data.petIds.map((targetPetId, sortOrder) => ({
                petRecordId: parsed.data.id,
                petId: targetPetId,
                sortOrder
              }))
            });
          }
          // undefinedは維持、nullは削除、文字列は差し替えとして区別する。
          if (fileName !== undefined) {
            await tx.petMemoryRecordImage.deleteMany({ where: { memoryRecordId: parsed.data.id } });
            if (fileName) {
              await tx.petMemoryRecordImage.create({
                data: { memoryRecordId: parsed.data.id, fileName, sortOrder: 0 }
              });
            }
          }
          return tx.petRecord.findUniqueOrThrow({
            where: { id: parsed.data.id },
            select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
          });
        },
        activity: (updated) => petRecordActivity("updated", updated)
      });

    const transactionResult = preparedImage
      ? await commitWithNewPetRecordImage({ householdId: context.household.id, image: preparedImage, commit })
      : await commit(removeImage ? null : undefined);
    publishAndRevalidatePetRecord(
      transactionResult.change,
      context.household.id,
      "petRecords.memory.update",
      transactionResult.result.id
    );
    if ((preparedImage || removeImage) && oldImageFileName) {
      await deleteImageAfterCommit(
        context.household.id,
        oldImageFileName,
        "petRecords.memory.update.deleteOldImage",
        current.id
      );
    }
    redirect(petRecordReturnUrl(representativePetId, "petRecordUpdated", formData));
  } catch (error) {
    if (error instanceof PetRecordImageError) {
      redirect(petRecordReturnUrl(typeof petId === "string" ? petId : null, imageRedirectStatus(error), formData));
    }
    redirectKnownPetRecordMutationError(error, typeof petId === "string" ? petId : null, formData);
    handleServerActionError(error, {
      operation: "petRecords.memory.update",
      pathname: "/records",
      searchParams: petRecordReturnSearchParams(typeof petId === "string" ? petId : null, formData),
      context: { petId: typeof petId === "string" ? petId : undefined }
    });
  }
}

export async function deletePetSavedMemoryTags(formData: FormData): Promise<SavedMemoryTagDeleteActionResult> {
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = deletePetSavedMemoryTagsSchema.safeParse({ tags: formData.getAll("tags") });
    if (!parsed.success) return { success: false, errorMessage: "削除するタグを1件以上選択してください。" };
    const { change, result } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petRecord",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      mutate: async (tx) => {
        await assertCurrentPetRecordMutationPermission(tx, context.household.id, context.user.id);
        return tx.savedMemoryTag.deleteMany({
          where: { householdId: context.household.id, name: { in: parsed.data.tags } }
        });
      }
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.memoryTag.deleteMany");
    return { success: true, deletedCount: result.count };
  } catch (error) {
    unstable_rethrow(error);
    const errorId = logUnexpectedError(error, { operation: "petRecords.memoryTag.deleteMany" });
    return {
      success: false,
      errorMessage: "保存済みタグを削除できませんでした。時間を空けて再度お試しください。",
      errorId
    };
  }
}
