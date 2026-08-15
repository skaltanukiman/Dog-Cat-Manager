"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import type { ZodIssue } from "zod";

import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { getCareDayRecordDate } from "@/lib/care-day";
import { isValidDateInput, parseDateInput } from "@/lib/date";
import { activityActorName } from "@/lib/household-activity";
import {
  isFuturePetCareTimestamp,
  isSameInputMinute,
  isTimestampInCareDate,
  parseJstDateTimeLocal
} from "@/lib/pet-care";
import { commitHouseholdMutation, getRealtimeActorId, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import {
  createPetLitterRecordSchema,
  deletePetLitterRecordSchema,
  updatePetLitterRecordSchema
} from "@/lib/schemas";
import { handleServerActionError } from "@/lib/server-errors";

class PetLitterMutationForbiddenError extends Error {}
class PetLitterRecordNotFoundError extends Error {}
class InactivePetLitterMutationError extends Error {}
class PetLitterSpeciesMismatchError extends Error {}
class PetLitterDateMismatchError extends Error {}
class PetLitterUnchangedError extends Error {}

function petLitterValidationStatus(issues: ZodIssue[]) {
  if (issues.some((issue) => issue.path[0] === "memo" && issue.code === "too_big")) return "petCareMemoTooLong";
  return "invalid";
}

function submittedCareDate(formData: FormData) {
  const value = formData.get("careDate");
  return typeof value === "string" && isValidDateInput(value) ? value : null;
}

function petLitterRedirect(petId: string, status: string, formData: FormData): never {
  const params = new URLSearchParams({ status });
  params.set("careSection", "litter");
  if (petId) params.set("petId", petId);
  const careDate = submittedCareDate(formData);
  if (careDate) params.set("date", careDate);
  if (formData.get("includeInactive") === "1") params.set("includeInactive", "1");
  redirect(`/care?${params.toString()}`);
}

/** 画面表示後の権限・日替わり時刻変更をLitter更新transaction内で再確認する。 */
async function currentCareDayStartMinutes(tx: Prisma.TransactionClient, householdId: string, userId: string) {
  const membership = await tx.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { role: true, household: { select: { careDayStartMinutes: true, isDemo: true } } }
  });
  if (!membership || !canEditHouseholdSharedData(membership.role) || membership.household.isDemo) {
    throw new PetLitterMutationForbiddenError();
  }
  return membership.household.careDayStartMinutes;
}

function handleKnownPetLitterError(error: unknown, petId: string, formData: FormData): void {
  if (error instanceof PetLitterMutationForbiddenError) petLitterRedirect(petId, "viewerForbidden", formData);
  if (error instanceof InactivePetLitterMutationError) petLitterRedirect(petId, "petCareLocked", formData);
  if (error instanceof PetLitterSpeciesMismatchError) petLitterRedirect(petId, "petCareSpeciesMismatch", formData);
  if (error instanceof PetLitterDateMismatchError) petLitterRedirect(petId, "petCareDateMismatch", formData);
  if (error instanceof PetLitterUnchangedError) petLitterRedirect(petId, "unchanged", formData);
  if (error instanceof PetLitterRecordNotFoundError) petLitterRedirect(petId, "invalid", formData);
}

export async function createPetLitterRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = createPetLitterRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success) petLitterRedirect(petId, petLitterValidationStatus(result.error.issues), formData);
    if (!careDate) petLitterRedirect(petId, "invalid", formData);

    const occurredAt = parseJstDateTimeLocal(result.data.occurredAt);
    if (isFuturePetCareTimestamp(occurredAt)) petLitterRedirect(petId, "petCareFuture", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petLitter",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const careDayStartMinutes = await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        if (!isTimestampInCareDate(occurredAt, careDate, careDayStartMinutes)) throw new PetLitterDateMismatchError();
        const pet = await tx.pet.findFirst({
          where: { id: result.data.petId, householdId: context.household.id },
          select: { id: true, name: true, species: true, isActive: true }
        });
        if (!pet) throw new PetLitterRecordNotFoundError();
        if (pet.species !== "CAT") throw new PetLitterSpeciesMismatchError();
        if (!pet.isActive) throw new InactivePetLitterMutationError();
        const record = await tx.petLitterRecord.create({
          data: {
            petId: pet.id,
            recordDate: getCareDayRecordDate(occurredAt, careDayStartMinutes),
            occurredAt,
            action: result.data.action,
            memo: result.data.memo,
            createdByUserId: context.user.id
          }
        });
        return { record, pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_LITTER_CREATED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: { occurredAt: record.occurredAt.toISOString(), action: record.action }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petLitter.create.revalidate",
      { householdId: context.household.id, petId: result.data.petId }
    );
    petLitterRedirect(result.data.petId, "petLitterCreated", formData);
  } catch (error) {
    handleKnownPetLitterError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petLitter.create",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}

export async function updatePetLitterRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = updatePetLitterRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success) petLitterRedirect(petId, petLitterValidationStatus(result.error.issues), formData);
    if (!careDate) petLitterRedirect(petId, "invalid", formData);

    const occurredAt = parseJstDateTimeLocal(result.data.occurredAt);
    if (isFuturePetCareTimestamp(occurredAt)) petLitterRedirect(petId, "petCareFuture", formData);
    const submittedRecordDate = parseDateInput(careDate);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petLitter",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const careDayStartMinutes = await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        if (!isTimestampInCareDate(occurredAt, careDate, careDayStartMinutes)) throw new PetLitterDateMismatchError();
        const record = await tx.petLitterRecord.findFirst({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            recordDate: submittedRecordDate,
            pet: { householdId: context.household.id }
          },
          select: {
            id: true,
            occurredAt: true,
            action: true,
            memo: true,
            updatedAt: true,
            pet: { select: { id: true, name: true, species: true, isActive: true } }
          }
        });
        if (!record) throw new PetLitterRecordNotFoundError();
        if (record.pet.species !== "CAT") throw new PetLitterSpeciesMismatchError();
        if (!record.pet.isActive) throw new InactivePetLitterMutationError();
        if (
          isSameInputMinute(record.occurredAt, occurredAt) &&
          record.action === result.data.action &&
          record.memo === result.data.memo
        ) throw new PetLitterUnchangedError();
        const updated = await tx.petLitterRecord.updateMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            recordDate: submittedRecordDate,
            updatedAt: record.updatedAt,
            pet: { householdId: context.household.id, species: "CAT", isActive: true }
          },
          data: {
            recordDate: getCareDayRecordDate(occurredAt, careDayStartMinutes),
            occurredAt,
            action: result.data.action,
            memo: result.data.memo
          }
        });
        if (updated.count !== 1) throw new PetLitterRecordNotFoundError();
        return { record, pet: record.pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_LITTER_UPDATED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: {
          previousOccurredAt: record.occurredAt.toISOString(),
          occurredAt: occurredAt.toISOString(),
          previousAction: record.action,
          action: result.data.action
        }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petLitter.update.revalidate",
      { householdId: context.household.id, petId: result.data.petId, recordId: result.data.id }
    );
    petLitterRedirect(result.data.petId, "petLitterUpdated", formData);
  } catch (error) {
    handleKnownPetLitterError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petLitter.update",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}

export async function deletePetLitterRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = deletePetLitterRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success || !careDate) petLitterRedirect(petId, "invalid", formData);
    const submittedRecordDate = parseDateInput(careDate);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petLitter",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        const record = await tx.petLitterRecord.findFirst({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            recordDate: submittedRecordDate,
            pet: { householdId: context.household.id }
          },
          select: {
            id: true,
            occurredAt: true,
            action: true,
            pet: { select: { id: true, name: true, species: true, isActive: true } }
          }
        });
        if (!record) throw new PetLitterRecordNotFoundError();
        if (record.pet.species !== "CAT") throw new PetLitterSpeciesMismatchError();
        if (!record.pet.isActive) throw new InactivePetLitterMutationError();
        const deleted = await tx.petLitterRecord.deleteMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            recordDate: submittedRecordDate,
            pet: { householdId: context.household.id, species: "CAT", isActive: true }
          }
        });
        if (deleted.count !== 1) throw new PetLitterRecordNotFoundError();
        return { record, pet: record.pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_LITTER_DELETED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: { occurredAt: record.occurredAt.toISOString(), action: record.action }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petLitter.delete.revalidate",
      { householdId: context.household.id, petId: result.data.petId, recordId: result.data.id }
    );
    petLitterRedirect(result.data.petId, "petLitterDeleted", formData);
  } catch (error) {
    handleKnownPetLitterError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petLitter.delete",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}
