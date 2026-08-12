"use server";

import { redirect } from "next/navigation";

import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { activityActorName } from "@/lib/household-activity";
import { writeServerLog } from "@/lib/logger";
import { deletePetRecordImage } from "@/lib/pet-record-image";
import {
  assertCurrentPetRecordMutationPermission,
  getActiveMutationPets,
  petRecordActivity,
  PetRecordHouseholdBoundaryError,
  PetRecordNotFoundError,
  petRecordReturnSearchParams,
  petRecordReturnUrl,
  publishAndRevalidatePetRecord,
  redirectKnownPetRecordMutationError
} from "@/lib/pet-record-mutations";
import { deletePetRecordSchema } from "@/lib/pet-record-schemas";
import { commitHouseholdMutation, getRealtimeActorId } from "@/lib/realtime";
import { handleServerActionError } from "@/lib/server-errors";

async function deleteImageAfterCommit(householdId: string, fileName: string, recordId: string) {
  try {
    await deletePetRecordImage(householdId, fileName);
  } catch (error) {
    writeServerLog("warn", {
      event: "pet_record_image_delete_failed",
      message: "Pet思い出記録削除後の画像削除に失敗しました。",
      operation: "petRecords.delete.deleteImage",
      context: { householdId, recordId, errorName: error instanceof Error ? error.name : typeof error }
    });
  }
}

/** ClientのrecordTypeを受け取らず、DB上の種別から削除Activityを確定する。 */
export async function deletePetRecord(formData: FormData) {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = deletePetRecordSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      redirect(petRecordReturnUrl(typeof petId === "string" ? petId : null, "petRecordPetInvalid", formData));
    }

    const { change, result } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petRecord",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await assertCurrentPetRecordMutationPermission(tx, context.household.id, context.user.id);
        const record = await tx.petRecord.findFirst({
          where: { id: parsed.data.id, petId: parsed.data.petId, pet: { householdId: context.household.id } },
          select: {
            id: true,
            recordType: true,
            recordDate: true,
            pet: { select: { id: true, name: true, householdId: true, isActive: true } },
            memoryDetail: {
              select: {
                pets: { select: { petId: true, pet: { select: { householdId: true, isActive: true } } } },
                images: { orderBy: { sortOrder: "asc" }, take: 1, select: { fileName: true } }
              }
            }
          }
        });
        if (!record) throw new PetRecordNotFoundError();
        const relatedPetIds = record.recordType === "MEMORY"
          ? record.memoryDetail?.pets.map((entry) => entry.petId) ?? []
          : [record.pet.id];
        if (record.recordType === "MEMORY" && relatedPetIds.length === 0) {
          throw new PetRecordHouseholdBoundaryError();
        }
        if (
          record.pet.householdId !== context.household.id ||
          record.memoryDetail?.pets.some((entry) => entry.pet.householdId !== context.household.id)
        ) {
          throw new PetRecordHouseholdBoundaryError();
        }
        await getActiveMutationPets(tx, relatedPetIds, context.household.id);
        const deleted = await tx.petRecord.deleteMany({
          where: {
            id: parsed.data.id,
            petId: parsed.data.petId,
            pet: { householdId: context.household.id, isActive: true }
          }
        });
        if (deleted.count !== 1) throw new PetRecordNotFoundError();
        return {
          record,
          imageFileName: record.memoryDetail?.images[0]?.fileName ?? null
        };
      },
      activity: ({ record }) => petRecordActivity("deleted", record)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.delete", result.record.id);
    if (result.imageFileName) {
      await deleteImageAfterCommit(context.household.id, result.imageFileName, result.record.id);
    }
    redirect(petRecordReturnUrl(parsed.data.petId, "petRecordDeleted", formData));
  } catch (error) {
    redirectKnownPetRecordMutationError(error, typeof petId === "string" ? petId : null, formData);
    handleServerActionError(error, {
      operation: "petRecords.delete",
      pathname: "/records",
      searchParams: petRecordReturnSearchParams(typeof petId === "string" ? petId : null, formData),
      context: { petId: typeof petId === "string" ? petId : undefined }
    });
  }
}
