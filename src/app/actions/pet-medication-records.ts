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
  petRecordActivity,
  petRecordCreateError,
  PetRecordConflictError,
  petRecordReturnSearchParams,
  petRecordReturnUrl,
  petRecordValidationStatus,
  publishAndRevalidatePetRecord,
  redirectKnownPetRecordMutationError,
  unexpectedPetRecordCreateError,
  type PetRecordCreateActionResult
} from "@/lib/pet-record-mutations";
import { createPetMedicationRecordSchema, updatePetMedicationRecordSchema } from "@/lib/pet-record-schemas";
import { buildPetMedicationRecordTitle, buildPetMedicationSearchText } from "@/lib/pet-records";
import { prisma } from "@/lib/prisma";
import { isFutureRecordTime } from "@/lib/record-time";
import { commitHouseholdMutation, getRealtimeActorId } from "@/lib/realtime";
import { handleServerActionError } from "@/lib/server-errors";

export async function createPetMedicationRecord(formData: FormData): Promise<PetRecordCreateActionResult> {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = createPetMedicationRecordSchema.safeParse(Object.fromEntries(formData));
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
            recordType: "MEDICATION",
            recordDate: parseDateInput(parsed.data.recordDate),
            recordTimeMinutes: parsed.data.recordTime,
            title: buildPetMedicationRecordTitle(parsed.data.medicationName),
            memo: parsed.data.memo,
            searchText: buildPetMedicationSearchText(parsed.data),
            createdByUserId: context.user.id,
            medicationDetail: {
              create: { medicationName: parsed.data.medicationName, dosage: parsed.data.dosage }
            }
          },
          select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
        });
      },
      activity: (created) => petRecordActivity("created", created)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.medication.create", record.id);
    return { success: true };
  } catch (error) {
    return knownPetRecordCreateError(error) ?? unexpectedPetRecordCreateError(error, "petRecords.medication.create", petId);
  }
}

export async function updatePetMedicationRecord(formData: FormData) {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = updatePetMedicationRecordSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const status = petRecordValidationStatus(parsed.error.issues);
      redirect(petRecordReturnUrl(typeof petId === "string" ? petId : null, `petRecord${status[0].toUpperCase()}${status.slice(1)}`, formData));
    }
    if (isFutureDateInput(parsed.data.recordDate)) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFuture", formData));
    if (isFutureRecordTime(parsed.data.recordDate, parsed.data.recordTime)) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFutureTime", formData));
    }

    const current = await prisma.petRecord.findFirst({
      where: { id: parsed.data.id, petId: parsed.data.petId, recordType: "MEDICATION", pet: { householdId: context.household.id } },
      select: {
        recordDate: true,
        recordTimeMinutes: true,
        memo: true,
        updatedAt: true,
        medicationDetail: true,
        pet: { select: { isActive: true } }
      }
    });
    if (!current || !current.medicationDetail) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordPetInvalid", formData));
    if (!current.pet.isActive) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordLocked", formData));
    if (current.updatedAt.getTime() !== parsed.data.updatedAt.getTime()) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordConflict", formData));
    }
    if (
      toDateInputValue(current.recordDate) === parsed.data.recordDate &&
      current.recordTimeMinutes === parsed.data.recordTime &&
      current.memo === parsed.data.memo &&
      current.medicationDetail.medicationName === parsed.data.medicationName &&
      current.medicationDetail.dosage === parsed.data.dosage
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
        await assertExpectedPetRecordVersion(tx, parsed.data.id, parsed.data.updatedAt, context.household.id, "MEDICATION");
        const updated = await tx.petRecord.updateMany({
          where: {
            id: parsed.data.id,
            petId: parsed.data.petId,
            recordType: "MEDICATION",
            updatedAt: parsed.data.updatedAt,
            pet: { householdId: context.household.id, isActive: true }
          },
          data: {
            recordDate: parseDateInput(parsed.data.recordDate),
            recordTimeMinutes: parsed.data.recordTime,
            title: buildPetMedicationRecordTitle(parsed.data.medicationName),
            memo: parsed.data.memo,
            searchText: buildPetMedicationSearchText(parsed.data)
          }
        });
        if (updated.count !== 1) throw new PetRecordConflictError();
        await tx.petMedicationRecordDetail.update({
          where: { petRecordId: parsed.data.id },
          data: { medicationName: parsed.data.medicationName, dosage: parsed.data.dosage }
        });
        return tx.petRecord.findUniqueOrThrow({
          where: { id: parsed.data.id },
          select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
        });
      },
      activity: (updated) => petRecordActivity("updated", updated)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.medication.update", updatedRecord.id);
    redirect(petRecordReturnUrl(parsed.data.petId, "petRecordUpdated", formData));
  } catch (error) {
    redirectKnownPetRecordMutationError(error, typeof petId === "string" ? petId : null, formData);
    handleServerActionError(error, {
      operation: "petRecords.medication.update",
      pathname: "/records",
      searchParams: petRecordReturnSearchParams(typeof petId === "string" ? petId : null, formData),
      context: { petId: typeof petId === "string" ? petId : undefined }
    });
  }
}
