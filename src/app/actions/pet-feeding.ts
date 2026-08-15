"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import type { ZodIssue } from "zod";

import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { getCareDayRecordDate } from "@/lib/care-day";
import { isValidDateInput } from "@/lib/date";
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
  createPetFeedingRecordSchema,
  deletePetFeedingRecordSchema,
  updatePetFeedingRecordSchema
} from "@/lib/schemas";
import { handleServerActionError } from "@/lib/server-errors";

class PetFeedingMutationForbiddenError extends Error {}
class PetFeedingRecordNotFoundError extends Error {}
class InactivePetFeedingMutationError extends Error {}
class PetFeedingDateMismatchError extends Error {}
class PetFeedingUnchangedError extends Error {}

function petFeedingValidationStatus(issues: ZodIssue[]) {
  if (issues.some((issue) => issue.path[0] === "memo" && issue.code === "too_big")) return "petCareMemoTooLong";
  return "invalid";
}

function submittedCareDate(formData: FormData) {
  const value = formData.get("careDate");
  return typeof value === "string" && isValidDateInput(value) ? value : null;
}

function petFeedingRedirect(petId: string, status: string, formData: FormData): never {
  const params = new URLSearchParams({ status });
  params.set("careSection", "feeding");
  if (petId) params.set("petId", petId);
  const careDate = submittedCareDate(formData);
  if (careDate) params.set("date", careDate);
  if (formData.get("includeInactive") === "1") params.set("includeInactive", "1");
  redirect(`/care?${params.toString()}`);
}

/** 画面表示後の権限・日替わり時刻変更を更新transaction内で再確認する。 */
async function currentCareDayStartMinutes(
  tx: Prisma.TransactionClient,
  householdId: string,
  userId: string
) {
  const membership = await tx.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { role: true, household: { select: { careDayStartMinutes: true, isDemo: true } } }
  });
  if (!membership || !canEditHouseholdSharedData(membership.role) || membership.household.isDemo) {
    throw new PetFeedingMutationForbiddenError();
  }
  return membership.household.careDayStartMinutes;
}

function handleKnownPetFeedingError(error: unknown, petId: string, formData: FormData): void {
  if (error instanceof PetFeedingMutationForbiddenError) petFeedingRedirect(petId, "viewerForbidden", formData);
  if (error instanceof InactivePetFeedingMutationError) petFeedingRedirect(petId, "petCareLocked", formData);
  if (error instanceof PetFeedingDateMismatchError) petFeedingRedirect(petId, "petCareDateMismatch", formData);
  if (error instanceof PetFeedingUnchangedError) petFeedingRedirect(petId, "unchanged", formData);
  if (error instanceof PetFeedingRecordNotFoundError) petFeedingRedirect(petId, "invalid", formData);
}

export async function createPetFeedingRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = createPetFeedingRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success) petFeedingRedirect(petId, petFeedingValidationStatus(result.error.issues), formData);
    if (!careDate) petFeedingRedirect(petId, "invalid", formData);

    const fedAt = parseJstDateTimeLocal(result.data.fedAt);
    if (isFuturePetCareTimestamp(fedAt)) petFeedingRedirect(petId, "petCareFuture", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petFeeding",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const careDayStartMinutes = await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        if (!isTimestampInCareDate(fedAt, careDate, careDayStartMinutes)) {
          throw new PetFeedingDateMismatchError();
        }
        const pet = await tx.pet.findFirst({
          where: { id: result.data.petId, householdId: context.household.id },
          select: { id: true, name: true, isActive: true }
        });
        if (!pet) throw new PetFeedingRecordNotFoundError();
        if (!pet.isActive) throw new InactivePetFeedingMutationError();
        const record = await tx.petFeedingRecord.create({
          data: {
            petId: pet.id,
            recordDate: getCareDayRecordDate(fedAt, careDayStartMinutes),
            fedAt,
            memo: result.data.memo,
            createdByUserId: context.user.id
          }
        });
        return { record, pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_FEEDING_CREATED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: { fedAt: record.fedAt.toISOString() }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petFeeding.create.revalidate",
      { householdId: context.household.id, petId: result.data.petId }
    );
    petFeedingRedirect(result.data.petId, "petFeedingCreated", formData);
  } catch (error) {
    handleKnownPetFeedingError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petFeeding.create",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}

export async function updatePetFeedingRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = updatePetFeedingRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success) petFeedingRedirect(petId, petFeedingValidationStatus(result.error.issues), formData);
    if (!careDate) petFeedingRedirect(petId, "invalid", formData);

    const fedAt = parseJstDateTimeLocal(result.data.fedAt);
    if (isFuturePetCareTimestamp(fedAt)) petFeedingRedirect(petId, "petCareFuture", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petFeeding",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const careDayStartMinutes = await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        if (!isTimestampInCareDate(fedAt, careDate, careDayStartMinutes)) {
          throw new PetFeedingDateMismatchError();
        }
        const record = await tx.petFeedingRecord.findFirst({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            pet: { householdId: context.household.id }
          },
          select: {
            id: true,
            fedAt: true,
            memo: true,
            updatedAt: true,
            pet: { select: { id: true, name: true, isActive: true } }
          }
        });
        if (!record) throw new PetFeedingRecordNotFoundError();
        if (!record.pet.isActive) throw new InactivePetFeedingMutationError();
        if (isSameInputMinute(record.fedAt, fedAt) && record.memo === result.data.memo) {
          throw new PetFeedingUnchangedError();
        }
        const updated = await tx.petFeedingRecord.updateMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            updatedAt: record.updatedAt,
            pet: { householdId: context.household.id, isActive: true }
          },
          data: {
            recordDate: getCareDayRecordDate(fedAt, careDayStartMinutes),
            fedAt,
            memo: result.data.memo
          }
        });
        if (updated.count !== 1) throw new PetFeedingRecordNotFoundError();
        return { record, pet: record.pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_FEEDING_UPDATED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: { previousFedAt: record.fedAt.toISOString(), fedAt: fedAt.toISOString() }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petFeeding.update.revalidate",
      { householdId: context.household.id, petId: result.data.petId, recordId: result.data.id }
    );
    petFeedingRedirect(result.data.petId, "petFeedingUpdated", formData);
  } catch (error) {
    handleKnownPetFeedingError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petFeeding.update",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}

export async function deletePetFeedingRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = deletePetFeedingRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success || !submittedCareDate(formData)) petFeedingRedirect(petId, "invalid", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petFeeding",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        const record = await tx.petFeedingRecord.findFirst({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            pet: { householdId: context.household.id }
          },
          select: {
            id: true,
            fedAt: true,
            pet: { select: { id: true, name: true, isActive: true } }
          }
        });
        if (!record) throw new PetFeedingRecordNotFoundError();
        if (!record.pet.isActive) throw new InactivePetFeedingMutationError();
        const deleted = await tx.petFeedingRecord.deleteMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            pet: { householdId: context.household.id, isActive: true }
          }
        });
        if (deleted.count !== 1) throw new PetFeedingRecordNotFoundError();
        return { record, pet: record.pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_FEEDING_DELETED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: { fedAt: record.fedAt.toISOString() }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petFeeding.delete.revalidate",
      { householdId: context.household.id, petId: result.data.petId, recordId: result.data.id }
    );
    petFeedingRedirect(result.data.petId, "petFeedingDeleted", formData);
  } catch (error) {
    handleKnownPetFeedingError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petFeeding.delete",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}
