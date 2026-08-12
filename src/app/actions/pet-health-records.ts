"use server";

import { redirect } from "next/navigation";

import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { isFutureDateInput, parseDateInput, toDateInputValue } from "@/lib/date";
import { activityActorName } from "@/lib/household-activity";
import {
  assertCurrentPetRecordMutationPermission,
  assertExpectedPetRecordVersion,
  getActiveMutationPets,
  knownPetRecordCreateError,
  parsePetHealthRecordForm,
  petRecordActivity,
  petRecordCreateError,
  petRecordReturnSearchParams,
  petRecordReturnUrl,
  petRecordValidationStatus,
  publishAndRevalidatePetRecord,
  redirectKnownPetRecordMutationError,
  PetRecordConflictError,
  unexpectedPetRecordCreateError,
  type PetRecordCreateActionResult
} from "@/lib/pet-record-mutations";
import { createPetHealthRecordSchema, updatePetHealthRecordSchema } from "@/lib/pet-record-schemas";
import {
  buildPetHealthRecordTitle,
  buildPetHealthSearchText,
  isSameOrderedStringArray
} from "@/lib/pet-records";
import { prisma } from "@/lib/prisma";
import { isFutureRecordTime } from "@/lib/record-time";
import { commitHouseholdMutation, getRealtimeActorId } from "@/lib/realtime";
import { handleServerActionError } from "@/lib/server-errors";

export type { PetRecordCreateActionResult } from "@/lib/pet-record-mutations";

export async function createPetHealthRecord(formData: FormData): Promise<PetRecordCreateActionResult> {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = createPetHealthRecordSchema.safeParse(parsePetHealthRecordForm(formData));
    if (!parsed.success) return petRecordCreateError(petRecordValidationStatus(parsed.error.issues));
    if (isFutureDateInput(parsed.data.recordDate)) return petRecordCreateError("future");
    if (isFutureRecordTime(parsed.data.recordDate, parsed.data.recordTime)) return petRecordCreateError("futureTime");

    const { change, result: record } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petRecord",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await assertCurrentPetRecordMutationPermission(tx, context.household.id, context.user.id);
        await getActiveMutationPets(tx, [parsed.data.petId], context.household.id);
        return tx.petRecord.create({
          data: {
            petId: parsed.data.petId,
            recordType: "HEALTH",
            recordDate: parseDateInput(parsed.data.recordDate),
            recordTimeMinutes: parsed.data.recordTime,
            title: buildPetHealthRecordTitle(parsed.data.overallCondition),
            memo: parsed.data.memo,
            searchText: buildPetHealthSearchText(parsed.data),
            createdByUserId: context.user.id,
            healthDetail: {
              create: {
                overallCondition: parsed.data.overallCondition,
                appetite: parsed.data.appetite,
                activityLevel: parsed.data.activityLevel,
                stoolCondition: parsed.data.stoolCondition,
                urineCondition: parsed.data.urineCondition,
                symptoms: parsed.data.symptoms
              }
            }
          },
          select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
        });
      },
      activity: (created) => petRecordActivity("created", created)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.health.create", record.id);
    return { success: true };
  } catch (error) {
    return knownPetRecordCreateError(error) ?? unexpectedPetRecordCreateError(error, "petRecords.health.create", petId);
  }
}

export async function updatePetHealthRecord(formData: FormData) {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = updatePetHealthRecordSchema.safeParse(parsePetHealthRecordForm(formData));
    if (!parsed.success) {
      redirect(petRecordReturnUrl(typeof petId === "string" ? petId : null, `petRecord${petRecordValidationStatus(parsed.error.issues)[0].toUpperCase()}${petRecordValidationStatus(parsed.error.issues).slice(1)}`, formData));
    }
    if (isFutureDateInput(parsed.data.recordDate)) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFuture", formData));
    if (isFutureRecordTime(parsed.data.recordDate, parsed.data.recordTime)) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFutureTime", formData));
    }

    const current = await prisma.petRecord.findFirst({
      where: { id: parsed.data.id, petId: parsed.data.petId, recordType: "HEALTH", pet: { householdId: context.household.id } },
      select: {
        recordDate: true,
        recordTimeMinutes: true,
        memo: true,
        updatedAt: true,
        healthDetail: true,
        pet: { select: { isActive: true } }
      }
    });
    if (!current || !current.healthDetail) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordPetInvalid", formData));
    if (!current.pet.isActive) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordLocked", formData));
    if (current.updatedAt.getTime() !== parsed.data.updatedAt.getTime()) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordConflict", formData));
    }
    const detail = current.healthDetail;
    if (
      toDateInputValue(current.recordDate) === parsed.data.recordDate &&
      current.recordTimeMinutes === parsed.data.recordTime &&
      current.memo === parsed.data.memo &&
      detail.overallCondition === parsed.data.overallCondition &&
      detail.appetite === parsed.data.appetite &&
      detail.activityLevel === parsed.data.activityLevel &&
      detail.stoolCondition === parsed.data.stoolCondition &&
      detail.urineCondition === parsed.data.urineCondition &&
      isSameOrderedStringArray(detail.symptoms, parsed.data.symptoms)
    ) {
      redirect(petRecordReturnUrl(parsed.data.petId, "unchanged", formData));
    }

    const { change, result: updatedRecord } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petRecord",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await assertCurrentPetRecordMutationPermission(tx, context.household.id, context.user.id);
        await getActiveMutationPets(tx, [parsed.data.petId], context.household.id);
        await assertExpectedPetRecordVersion(tx, parsed.data.id, parsed.data.updatedAt, context.household.id, "HEALTH");
        const updated = await tx.petRecord.updateMany({
          where: {
            id: parsed.data.id,
            petId: parsed.data.petId,
            recordType: "HEALTH",
            updatedAt: parsed.data.updatedAt,
            pet: { householdId: context.household.id, isActive: true }
          },
          data: {
            recordDate: parseDateInput(parsed.data.recordDate),
            recordTimeMinutes: parsed.data.recordTime,
            title: buildPetHealthRecordTitle(parsed.data.overallCondition),
            memo: parsed.data.memo,
            searchText: buildPetHealthSearchText(parsed.data)
          }
        });
        if (updated.count !== 1) throw new PetRecordConflictError();
        await tx.petHealthRecordDetail.update({
          where: { petRecordId: parsed.data.id },
          data: {
            overallCondition: parsed.data.overallCondition,
            appetite: parsed.data.appetite,
            activityLevel: parsed.data.activityLevel,
            stoolCondition: parsed.data.stoolCondition,
            urineCondition: parsed.data.urineCondition,
            symptoms: parsed.data.symptoms
          }
        });
        return tx.petRecord.findUniqueOrThrow({
          where: { id: parsed.data.id },
          select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
        });
      },
      activity: (updated) => petRecordActivity("updated", updated)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.health.update", updatedRecord.id);
    redirect(petRecordReturnUrl(parsed.data.petId, "petRecordUpdated", formData));
  } catch (error) {
    redirectKnownPetRecordMutationError(error, typeof petId === "string" ? petId : null, formData);
    handleServerActionError(error, {
      operation: "petRecords.health.update",
      pathname: "/records",
      searchParams: petRecordReturnSearchParams(typeof petId === "string" ? petId : null, formData),
      context: { petId: typeof petId === "string" ? petId : undefined }
    });
  }
}
