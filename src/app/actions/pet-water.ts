"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import type { ZodIssue } from "zod";

import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { getCareDayRecordDate } from "@/lib/care-day";
import { isValidDateInput } from "@/lib/date";
import { activityActorName } from "@/lib/household-activity";
import type { CareMutationResult } from "@/lib/care-mutation";
import {
  isFuturePetCareTimestamp,
  isSameInputMinute,
  isTimestampInCareDate,
  parseJstDateTimeLocal
} from "@/lib/pet-care";
import { commitHouseholdMutation, getRealtimeActorId, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import {
  createPetWaterRecordSchema,
  deletePetWaterRecordSchema,
  updatePetWaterRecordSchema
} from "@/lib/schemas";
import { handleServerActionError } from "@/lib/server-errors";

class PetWaterMutationForbiddenError extends Error {}
class PetWaterRecordNotFoundError extends Error {}
class InactivePetWaterMutationError extends Error {}
class PetWaterDateMismatchError extends Error {}
class PetWaterUnchangedError extends Error {}

function petWaterValidationStatus(issues: ZodIssue[]) {
  if (issues.some((issue) => issue.path[0] === "memo" && issue.code === "too_big")) return "petCareMemoTooLong";
  return "invalid";
}

function submittedCareDate(formData: FormData) {
  const value = formData.get("careDate");
  return typeof value === "string" && isValidDateInput(value) ? value : null;
}

function petWaterRedirect(petId: string, status: string, formData: FormData): never {
  const params = new URLSearchParams({ status });
  params.set("careSection", "water");
  if (petId) params.set("petId", petId);
  const careDate = submittedCareDate(formData);
  if (careDate) params.set("date", careDate);
  if (formData.get("includeInactive") === "1") params.set("includeInactive", "1");
  redirect(`/care?${params.toString()}`);
}

/** 画面表示後の権限・日替わり時刻変更を更新transaction内で再確認する。 */
async function currentCareDayStartMinutes(tx: Prisma.TransactionClient, householdId: string, userId: string) {
  const membership = await tx.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { role: true, household: { select: { careDayStartMinutes: true, isDemo: true } } }
  });
  if (!membership || !canEditHouseholdSharedData(membership.role) || membership.household.isDemo) {
    throw new PetWaterMutationForbiddenError();
  }
  return membership.household.careDayStartMinutes;
}

function handleKnownPetWaterError(error: unknown, petId: string, formData: FormData): void {
  if (error instanceof PetWaterMutationForbiddenError) petWaterRedirect(petId, "viewerForbidden", formData);
  if (error instanceof InactivePetWaterMutationError) petWaterRedirect(petId, "petCareLocked", formData);
  if (error instanceof PetWaterDateMismatchError) petWaterRedirect(petId, "petCareDateMismatch", formData);
  if (error instanceof PetWaterUnchangedError) petWaterRedirect(petId, "unchanged", formData);
  if (error instanceof PetWaterRecordNotFoundError) petWaterRedirect(petId, "invalid", formData);
}

export async function createPetWaterRecord(formData: FormData): Promise<CareMutationResult> {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = createPetWaterRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success) petWaterRedirect(petId, petWaterValidationStatus(result.error.issues), formData);
    if (!careDate) petWaterRedirect(petId, "invalid", formData);

    const caredAt = parseJstDateTimeLocal(result.data.caredAt);
    if (isFuturePetCareTimestamp(caredAt)) petWaterRedirect(petId, "petCareFuture", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWater",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const careDayStartMinutes = await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        if (!isTimestampInCareDate(caredAt, careDate, careDayStartMinutes)) {
          throw new PetWaterDateMismatchError();
        }
        const pet = await tx.pet.findFirst({
          where: { id: result.data.petId, householdId: context.household.id },
          select: { id: true, name: true, isActive: true }
        });
        if (!pet) throw new PetWaterRecordNotFoundError();
        if (!pet.isActive) throw new InactivePetWaterMutationError();
        const record = await tx.petWaterRecord.create({
          data: {
            petId: pet.id,
            recordDate: getCareDayRecordDate(caredAt, careDayStartMinutes),
            caredAt,
            action: result.data.action,
            memo: result.data.memo,
            createdByUserId: context.user.id
          }
        });
        return { record, pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_WATER_CREATED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: { caredAt: record.caredAt.toISOString(), action: record.action }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWater.create.revalidate",
      { householdId: context.household.id, petId: result.data.petId }
    );
    return { success: true, status: "petWaterCreated" };
  } catch (error) {
    handleKnownPetWaterError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petWater.create",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}

export async function updatePetWaterRecord(formData: FormData): Promise<CareMutationResult> {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = updatePetWaterRecordSchema.safeParse(Object.fromEntries(formData));
    const careDate = submittedCareDate(formData);
    if (!result.success) petWaterRedirect(petId, petWaterValidationStatus(result.error.issues), formData);
    if (!careDate) petWaterRedirect(petId, "invalid", formData);

    const caredAt = parseJstDateTimeLocal(result.data.caredAt);
    if (isFuturePetCareTimestamp(caredAt)) petWaterRedirect(petId, "petCareFuture", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWater",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        const careDayStartMinutes = await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        if (!isTimestampInCareDate(caredAt, careDate, careDayStartMinutes)) {
          throw new PetWaterDateMismatchError();
        }
        const record = await tx.petWaterRecord.findFirst({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            pet: { householdId: context.household.id }
          },
          select: {
            id: true,
            caredAt: true,
            action: true,
            memo: true,
            updatedAt: true,
            pet: { select: { id: true, name: true, isActive: true } }
          }
        });
        if (!record) throw new PetWaterRecordNotFoundError();
        if (!record.pet.isActive) throw new InactivePetWaterMutationError();
        if (
          isSameInputMinute(record.caredAt, caredAt) &&
          record.action === result.data.action &&
          record.memo === result.data.memo
        ) {
          throw new PetWaterUnchangedError();
        }
        const updated = await tx.petWaterRecord.updateMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            updatedAt: record.updatedAt,
            pet: { householdId: context.household.id, isActive: true }
          },
          data: {
            recordDate: getCareDayRecordDate(caredAt, careDayStartMinutes),
            caredAt,
            action: result.data.action,
            memo: result.data.memo
          }
        });
        if (updated.count !== 1) throw new PetWaterRecordNotFoundError();
        return { record, pet: record.pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_WATER_UPDATED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: {
          previousCaredAt: record.caredAt.toISOString(),
          caredAt: caredAt.toISOString(),
          previousAction: record.action,
          action: result.data.action
        }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWater.update.revalidate",
      { householdId: context.household.id, petId: result.data.petId, recordId: result.data.id }
    );
    return { success: true, status: "petWaterUpdated" };
  } catch (error) {
    handleKnownPetWaterError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petWater.update",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}

export async function deletePetWaterRecord(formData: FormData): Promise<CareMutationResult> {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/care");
    const result = deletePetWaterRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success || !submittedCareDate(formData)) petWaterRedirect(petId, "invalid", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWater",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await currentCareDayStartMinutes(tx, context.household.id, context.user.id);
        const record = await tx.petWaterRecord.findFirst({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            pet: { householdId: context.household.id }
          },
          select: {
            id: true,
            caredAt: true,
            action: true,
            pet: { select: { id: true, name: true, isActive: true } }
          }
        });
        if (!record) throw new PetWaterRecordNotFoundError();
        if (!record.pet.isActive) throw new InactivePetWaterMutationError();
        const deleted = await tx.petWaterRecord.deleteMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            pet: { householdId: context.household.id, isActive: true }
          }
        });
        if (deleted.count !== 1) throw new PetWaterRecordNotFoundError();
        return { record, pet: record.pet };
      },
      activity: ({ record, pet }) => ({
        eventType: "PET_WATER_DELETED",
        category: "CARE_RECORD",
        targetType: "PET",
        targetId: pet.id,
        targetNameSnapshot: pet.name,
        details: { caredAt: record.caredAt.toISOString(), action: record.action }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/care" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWater.delete.revalidate",
      { householdId: context.household.id, petId: result.data.petId, recordId: result.data.id }
    );
    return { success: true, status: "petWaterDeleted" };
  } catch (error) {
    handleKnownPetWaterError(error, petId, formData);
    handleServerActionError(error, {
      operation: "petWater.delete",
      pathname: "/care",
      searchParams: petId ? new URLSearchParams({ petId }) : undefined,
      context: { petId }
    });
  }
}
