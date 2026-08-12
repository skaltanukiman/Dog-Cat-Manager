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
import { createPetMedicalRecordSchema, updatePetMedicalRecordSchema } from "@/lib/pet-record-schemas";
import { buildPetMedicalRecordTitle, buildPetMedicalSearchText } from "@/lib/pet-records";
import { prisma } from "@/lib/prisma";
import { isFutureRecordTime } from "@/lib/record-time";
import { commitHouseholdMutation, getRealtimeActorId } from "@/lib/realtime";
import { handleServerActionError } from "@/lib/server-errors";

function nullableDateValue(value: Date | string | null) {
  if (value === null) return null;
  return typeof value === "string" ? value : toDateInputValue(value);
}

function feeValue(value: { toString(): string } | number | null) {
  return value === null ? null : value.toString();
}

export async function createPetMedicalRecord(formData: FormData): Promise<PetRecordCreateActionResult> {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = createPetMedicalRecordSchema.safeParse(Object.fromEntries(formData));
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
            recordType: "MEDICAL",
            recordDate: parseDateInput(parsed.data.recordDate),
            recordTimeMinutes: parsed.data.recordTime,
            title: buildPetMedicalRecordTitle(parsed.data.hospitalName),
            memo: parsed.data.memo,
            searchText: buildPetMedicalSearchText(parsed.data),
            createdByUserId: context.user.id,
            medicalDetail: {
              create: {
                hospitalName: parsed.data.hospitalName,
                reason: parsed.data.reason,
                diagnosis: parsed.data.diagnosis,
                examination: parsed.data.examination,
                treatment: parsed.data.treatment,
                medication: parsed.data.medication,
                medicationInstructions: parsed.data.medicationInstructions,
                nextVisitDate: parsed.data.nextVisitDate ? parseDateInput(parsed.data.nextVisitDate) : null,
                consultationFee: parsed.data.consultationFee
              }
            }
          },
          select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
        });
      },
      activity: (created) => petRecordActivity("created", created)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.medical.create", record.id);
    return { success: true };
  } catch (error) {
    return knownPetRecordCreateError(error) ?? unexpectedPetRecordCreateError(error, "petRecords.medical.create", petId);
  }
}

export async function updatePetMedicalRecord(formData: FormData) {
  const petId = formData.get("petId");
  try {
    const context = await getRequiredHouseholdMutationContext("/records");
    const parsed = updatePetMedicalRecordSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const status = petRecordValidationStatus(parsed.error.issues);
      redirect(
        petRecordReturnUrl(
          typeof petId === "string" ? petId : null,
          `petRecord${status[0].toUpperCase()}${status.slice(1)}`,
          formData
        )
      );
    }
    if (isFutureDateInput(parsed.data.recordDate)) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFuture", formData));
    if (isFutureRecordTime(parsed.data.recordDate, parsed.data.recordTime)) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordFutureTime", formData));
    }

    const current = await prisma.petRecord.findFirst({
      where: { id: parsed.data.id, petId: parsed.data.petId, recordType: "MEDICAL", pet: { householdId: context.household.id } },
      select: {
        recordDate: true,
        recordTimeMinutes: true,
        memo: true,
        updatedAt: true,
        medicalDetail: true,
        pet: { select: { isActive: true } }
      }
    });
    if (!current || !current.medicalDetail) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordPetInvalid", formData));
    if (!current.pet.isActive) redirect(petRecordReturnUrl(parsed.data.petId, "petRecordLocked", formData));
    if (current.updatedAt.getTime() !== parsed.data.updatedAt.getTime()) {
      redirect(petRecordReturnUrl(parsed.data.petId, "petRecordConflict", formData));
    }
    const detail = current.medicalDetail;
    if (
      toDateInputValue(current.recordDate) === parsed.data.recordDate &&
      current.recordTimeMinutes === parsed.data.recordTime &&
      current.memo === parsed.data.memo &&
      detail.hospitalName === parsed.data.hospitalName &&
      detail.reason === parsed.data.reason &&
      detail.diagnosis === parsed.data.diagnosis &&
      detail.examination === parsed.data.examination &&
      detail.treatment === parsed.data.treatment &&
      detail.medication === parsed.data.medication &&
      detail.medicationInstructions === parsed.data.medicationInstructions &&
      nullableDateValue(detail.nextVisitDate) === nullableDateValue(parsed.data.nextVisitDate) &&
      feeValue(detail.consultationFee) === feeValue(parsed.data.consultationFee)
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
        await assertExpectedPetRecordVersion(tx, parsed.data.id, parsed.data.updatedAt, context.household.id, "MEDICAL");
        const updated = await tx.petRecord.updateMany({
          where: {
            id: parsed.data.id,
            petId: parsed.data.petId,
            recordType: "MEDICAL",
            updatedAt: parsed.data.updatedAt,
            pet: { householdId: context.household.id, isActive: true }
          },
          data: {
            recordDate: parseDateInput(parsed.data.recordDate),
            recordTimeMinutes: parsed.data.recordTime,
            title: buildPetMedicalRecordTitle(parsed.data.hospitalName),
            memo: parsed.data.memo,
            searchText: buildPetMedicalSearchText(parsed.data)
          }
        });
        if (updated.count !== 1) throw new PetRecordConflictError();
        await tx.petMedicalVisitDetail.update({
          where: { petRecordId: parsed.data.id },
          data: {
            hospitalName: parsed.data.hospitalName,
            reason: parsed.data.reason,
            diagnosis: parsed.data.diagnosis,
            examination: parsed.data.examination,
            treatment: parsed.data.treatment,
            medication: parsed.data.medication,
            medicationInstructions: parsed.data.medicationInstructions,
            nextVisitDate: parsed.data.nextVisitDate ? parseDateInput(parsed.data.nextVisitDate) : null,
            consultationFee: parsed.data.consultationFee
          }
        });
        return tx.petRecord.findUniqueOrThrow({
          where: { id: parsed.data.id },
          select: { id: true, recordType: true, recordDate: true, pet: { select: { name: true } } }
        });
      },
      activity: (updated) => petRecordActivity("updated", updated)
    });
    publishAndRevalidatePetRecord(change, context.household.id, "petRecords.medical.update", updatedRecord.id);
    redirect(petRecordReturnUrl(parsed.data.petId, "petRecordUpdated", formData));
  } catch (error) {
    redirectKnownPetRecordMutationError(error, typeof petId === "string" ? petId : null, formData);
    handleServerActionError(error, {
      operation: "petRecords.medical.update",
      pathname: "/records",
      searchParams: petRecordReturnSearchParams(typeof petId === "string" ? petId : null, formData),
      context: { petId: typeof petId === "string" ? petId : undefined }
    });
  }
}
