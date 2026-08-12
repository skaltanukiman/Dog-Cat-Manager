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
import { createPetVaccinationRecordSchema, updatePetVaccinationRecordSchema } from "@/lib/pet-record-schemas";
import { buildPetVaccinationRecordTitle, buildPetVaccinationSearchText } from "@/lib/pet-records";
import { prisma } from "@/lib/prisma";
import { isFutureRecordTime } from "@/lib/record-time";
import { commitHouseholdMutation, getRealtimeActorId } from "@/lib/realtime";
import { handleServerActionError } from "@/lib/server-errors";

function nullableDateValue(value: Date | string | null) {
  if (value === null) return null;
  return typeof value === "string" ? value : toDateInputValue(value);
}

export async function createPetVaccinationRecord(formData: FormData): Promise<PetRecordCreateActionResult> {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = createPetVaccinationRecordSchema.safeParse(Object.fromEntries(formData));
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
            recordType: "VACCINATION",
            recordDate: parseDateInput(parsed.data.recordDate),
            recordTimeMinutes: parsed.data.recordTime,
            title: buildPetVaccinationRecordTitle(parsed.data.vaccineName),
            memo: parsed.data.memo,
            searchText: buildPetVaccinationSearchText(parsed.data),
            createdByUserId: context.user.id,
            vaccinationDetail: {
              create: {
                vaccineName: parsed.data.vaccineName,
                hospitalName: parsed.data.hospitalName,
                nextDueDate: parsed.data.nextDueDate ? parseDateInput(parsed.data.nextDueDate) : null
              }
            }
          },
          select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
        });
      },
      activity: (created) => petRecordActivity("created", created)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.vaccination.create", record.id);
    return { success: true };
  } catch (error) {
    return knownPetRecordCreateError(error) ?? unexpectedPetRecordCreateError(error, "petRecords.vaccination.create", petId);
  }
}

export async function updatePetVaccinationRecord(formData: FormData) {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = updatePetVaccinationRecordSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const status = petRecordValidationStatus(parsed.error.issues);
      redirect(petRecordReturnUrl(typeof petId === "string" ? petId : null, `petRecord${status[0].toUpperCase()}${status.slice(1)}`, formData));
    }
    if (isFutureDateInput(parsed.data.recordDate)) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFuture", formData));
    if (isFutureRecordTime(parsed.data.recordDate, parsed.data.recordTime)) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFutureTime", formData));
    }

    const current = await prisma.petRecord.findFirst({
      where: { id: parsed.data.id, petId: parsed.data.petId, recordType: "VACCINATION", pet: { householdId: context.household.id } },
      select: {
        recordDate: true,
        recordTimeMinutes: true,
        memo: true,
        updatedAt: true,
        vaccinationDetail: true,
        pet: { select: { isActive: true } }
      }
    });
    if (!current || !current.vaccinationDetail) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordPetInvalid", formData));
    if (!current.pet.isActive) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordLocked", formData));
    if (current.updatedAt.getTime() !== parsed.data.updatedAt.getTime()) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordConflict", formData));
    }
    const detail = current.vaccinationDetail;
    if (
      toDateInputValue(current.recordDate) === parsed.data.recordDate &&
      current.recordTimeMinutes === parsed.data.recordTime &&
      current.memo === parsed.data.memo &&
      detail.vaccineName === parsed.data.vaccineName &&
      detail.hospitalName === parsed.data.hospitalName &&
      nullableDateValue(detail.nextDueDate) === nullableDateValue(parsed.data.nextDueDate)
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
        await assertExpectedPetRecordVersion(tx, parsed.data.id, parsed.data.updatedAt, context.household.id, "VACCINATION");
        const updated = await tx.petRecord.updateMany({
          where: {
            id: parsed.data.id,
            petId: parsed.data.petId,
            recordType: "VACCINATION",
            updatedAt: parsed.data.updatedAt,
            pet: { householdId: context.household.id, isActive: true }
          },
          data: {
            recordDate: parseDateInput(parsed.data.recordDate),
            recordTimeMinutes: parsed.data.recordTime,
            title: buildPetVaccinationRecordTitle(parsed.data.vaccineName),
            memo: parsed.data.memo,
            searchText: buildPetVaccinationSearchText(parsed.data)
          }
        });
        if (updated.count !== 1) throw new PetRecordConflictError();
        await tx.petVaccinationRecordDetail.update({
          where: { petRecordId: parsed.data.id },
          data: {
            vaccineName: parsed.data.vaccineName,
            hospitalName: parsed.data.hospitalName,
            nextDueDate: parsed.data.nextDueDate ? parseDateInput(parsed.data.nextDueDate) : null
          }
        });
        return tx.petRecord.findUniqueOrThrow({
          where: { id: parsed.data.id },
          select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
        });
      },
      activity: (updated) => petRecordActivity("updated", updated)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.vaccination.update", updatedRecord.id);
    redirect(petRecordReturnUrl(parsed.data.petId, "petRecordUpdated", formData));
  } catch (error) {
    redirectKnownPetRecordMutationError(error, typeof petId === "string" ? petId : null, formData);
    handleServerActionError(error, {
      operation: "petRecords.vaccination.update",
      pathname: "/records",
      searchParams: petRecordReturnSearchParams(typeof petId === "string" ? petId : null, formData),
      context: { petId: typeof petId === "string" ? petId : undefined }
    });
  }
}
