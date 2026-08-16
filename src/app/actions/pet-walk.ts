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
  createPetWalkRecordSchema,
  deletePetWalkRecordSchema,
  updatePetWalkRecordSchema
} from "@/lib/schemas";
import { handleServerActionError } from "@/lib/server-errors";

class PetWalkMutationForbiddenError extends Error {}
class PetWalkRecordNotFoundError extends Error {}
class InactivePetWalkMutationError extends Error {}
class PetWalkSpeciesMismatchError extends Error {}
class PetWalkDateMismatchError extends Error {}
class PetWalkUnchangedError extends Error {}

function petWalkValidationStatus(issues: ZodIssue[]) {
  if (issues.some((issue) => issue.path[0] === "memo" && issue.code === "too_big")) return "petCareMemoTooLong";
  if (issues.some((issue) => issue.path[0] === "durationMinutes")) return "petWalkDurationInvalid";
  if (issues.some((issue) => issue.path[0] === "distanceMeters")) return "petWalkDistanceInvalid";
  return "invalid";
}

function submittedCareDate(formData: FormData) {
  const value = formData.get("careDate");
  return typeof value === "string" && isValidDateInput(value) ? value : null;
}

function petWalkRedirect(petId: string, status: string, formData: FormData): never {
  const params = new URLSearchParams({ status });
  params.set("careSection", "walk");
  if (petId) params.set("petId", petId);
  const careDate = submittedCareDate(formData);
  if (careDate) params.set("date", careDate);
  if (formData.get("includeInactive") === "1") params.set("includeInactive", "1");
  redirect(`/care?${params.toString()}`);
}

/** 画面表示後の権限・日替わり時刻変更をWalk更新transaction内で再確認する。 */
async function currentCareDayStartMinutes(tx: Prisma.TransactionClient, householdId: string, userId: string) {
  const membership = await tx.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { role: true, household: { select: { careDayStartMinutes: true, isDemo: true } } }
  });
  if (!membership || !canEditHouseholdSharedData(membership.role) || membership.household.isDemo) {
    throw new PetWalkMutationForbiddenError();
  }
  return membership.household.careDayStartMinutes;
}

function handleKnownPetWalkError(error: unknown, petId: string, formData: FormData): void {
  if (error instanceof PetWalkMutationForbiddenError) petWalkRedirect(petId, "viewerForbidden", formData);
  if (error instanceof InactivePetWalkMutationError) petWalkRedirect(petId, "petCareLocked", formData);
  if (error instanceof PetWalkSpeciesMismatchError) petWalkRedirect(petId, "petCareSpeciesMismatch", formData);
  if (error instanceof PetWalkDateMismatchError) petWalkRedirect(petId, "petCareDateMismatch", formData);
  if (error instanceof PetWalkUnchangedError) petWalkRedirect(petId, "unchanged", formData);
  if (error instanceof PetWalkRecordNotFoundError) petWalkRedirect(petId, "invalid", formData);
}

export async function createPetWalkRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = createPetWalkRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success) petWalkRedirect(petId, petWalkValidationStatus(result.error.issues), formData);
    if (!careDate) petWalkRedirect(petId, "invalid", formData);

    const startedAt = parseJstDateTimeLocal(result.data.startedAt);
    if (isFuturePetCareTimestamp(startedAt)) petWalkRedirect(petId, "petCareFuture", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWalk",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const careDayStartMinutes = await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        if (!isTimestampInCareDate(startedAt, careDate, careDayStartMinutes)) throw new PetWalkDateMismatchError();
        const pet = await tx.pet.findFirst({
          where: { id: result.data.petId, householdId: context.household.id },
          select: { id: true, name: true, species: true, isActive: true }
        });
        if (!pet) throw new PetWalkRecordNotFoundError();
        if (pet.species !== "DOG") throw new PetWalkSpeciesMismatchError();
        if (!pet.isActive) throw new InactivePetWalkMutationError();
        const record = await tx.petWalkRecord.create({
          data: {
            petId: pet.id,
            recordDate: getCareDayRecordDate(startedAt, careDayStartMinutes),
            startedAt,
            durationMinutes: result.data.durationMinutes,
            distanceMeters: result.data.distanceMeters,
            memo: result.data.memo,
            createdByUserId: context.user.id
          }
        });
        return { record, pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_WALK_CREATED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: {
          startedAt: record.startedAt.toISOString(),
          durationMinutes: record.durationMinutes,
          distanceMeters: record.distanceMeters
        }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWalk.create.revalidate",
      { householdId: context.household.id, petId: result.data.petId }
    );
    petWalkRedirect(result.data.petId, "petWalkCreated", formData);
  } catch (error) {
    handleKnownPetWalkError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petWalk.create",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}

export async function updatePetWalkRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = updatePetWalkRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success) petWalkRedirect(petId, petWalkValidationStatus(result.error.issues), formData);
    if (!careDate) petWalkRedirect(petId, "invalid", formData);

    const startedAt = parseJstDateTimeLocal(result.data.startedAt);
    if (isFuturePetCareTimestamp(startedAt)) petWalkRedirect(petId, "petCareFuture", formData);
    const submittedRecordDate = parseDateInput(careDate);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWalk",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const careDayStartMinutes = await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        if (!isTimestampInCareDate(startedAt, careDate, careDayStartMinutes)) throw new PetWalkDateMismatchError();
        const record = await tx.petWalkRecord.findFirst({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            recordDate: submittedRecordDate,
            pet: { householdId: context.household.id }
          },
          select: {
            id: true,
            startedAt: true,
            durationMinutes: true,
            distanceMeters: true,
            memo: true,
            updatedAt: true,
            pet: { select: { id: true, name: true, species: true, isActive: true } }
          }
        });
        if (!record) throw new PetWalkRecordNotFoundError();
        if (record.pet.species !== "DOG") throw new PetWalkSpeciesMismatchError();
        if (!record.pet.isActive) throw new InactivePetWalkMutationError();
        if (
          isSameInputMinute(record.startedAt, startedAt) &&
          record.durationMinutes === result.data.durationMinutes &&
          record.distanceMeters === result.data.distanceMeters &&
          record.memo === result.data.memo
        ) throw new PetWalkUnchangedError();
        const updated = await tx.petWalkRecord.updateMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            recordDate: submittedRecordDate,
            updatedAt: record.updatedAt,
            pet: { householdId: context.household.id, species: "DOG", isActive: true }
          },
          data: {
            recordDate: getCareDayRecordDate(startedAt, careDayStartMinutes),
            startedAt,
            durationMinutes: result.data.durationMinutes,
            distanceMeters: result.data.distanceMeters,
            memo: result.data.memo
          }
        });
        if (updated.count !== 1) throw new PetWalkRecordNotFoundError();
        return { record, pet: record.pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_WALK_UPDATED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: {
          previousStartedAt: record.startedAt.toISOString(),
          startedAt: startedAt.toISOString(),
          previousDurationMinutes: record.durationMinutes,
          durationMinutes: result.data.durationMinutes,
          previousDistanceMeters: record.distanceMeters,
          distanceMeters: result.data.distanceMeters
        }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWalk.update.revalidate",
      { householdId: context.household.id, petId: result.data.petId, recordId: result.data.id }
    );
    petWalkRedirect(result.data.petId, "petWalkUpdated", formData);
  } catch (error) {
    handleKnownPetWalkError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petWalk.update",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}

export async function deletePetWalkRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = deletePetWalkRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success || !careDate) petWalkRedirect(petId, "invalid", formData);
    const submittedRecordDate = parseDateInput(careDate);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWalk",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        const record = await tx.petWalkRecord.findFirst({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            recordDate: submittedRecordDate,
            pet: { householdId: context.household.id }
          },
          select: {
            id: true,
            startedAt: true,
            durationMinutes: true,
            distanceMeters: true,
            pet: { select: { id: true, name: true, species: true, isActive: true } }
          }
        });
        if (!record) throw new PetWalkRecordNotFoundError();
        if (record.pet.species !== "DOG") throw new PetWalkSpeciesMismatchError();
        if (!record.pet.isActive) throw new InactivePetWalkMutationError();
        const deleted = await tx.petWalkRecord.deleteMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            recordDate: submittedRecordDate,
            pet: { householdId: context.household.id, species: "DOG", isActive: true }
          }
        });
        if (deleted.count !== 1) throw new PetWalkRecordNotFoundError();
        return { record, pet: record.pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_WALK_DELETED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: {
          startedAt: record.startedAt.toISOString(),
          durationMinutes: record.durationMinutes,
          distanceMeters: record.distanceMeters
        }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWalk.delete.revalidate",
      { householdId: context.household.id, petId: result.data.petId, recordId: result.data.id }
    );
    petWalkRedirect(result.data.petId, "petWalkDeleted", formData);
  } catch (error) {
    handleKnownPetWalkError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petWalk.delete",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}
