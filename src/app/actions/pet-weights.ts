"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import type { ZodIssue } from "zod";

import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { parseDateInput, toDateInputValue } from "@/lib/date";
import { activityActorName } from "@/lib/household-activity";
import { commitHouseholdMutation, getRealtimeActorId, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import {
  createPetWeightRecordSchema,
  deletePetWeightRecordSchema,
  updatePetWeightRecordSchema
} from "@/lib/schemas";
import { handleServerActionError, isPrismaUniqueConstraintError } from "@/lib/server-errors";

class PetWeightMutationForbiddenError extends Error {}
class PetWeightRecordNotFoundError extends Error {}
class InactivePetWeightMutationError extends Error {}
class PetWeightUnchangedError extends Error {}

function petWeightValidationStatus(issues: ZodIssue[]) {
  if (issues.some((issue) => issue.path[0] === "recordDate" && issue.message === "future")) return "future";
  if (issues.some((issue) => issue.path[0] === "memo" && issue.code === "too_big")) return "petWeightMemoTooLong";
  if (issues.some((issue) => issue.path[0] === "weightKg" && issue.message === "weightIncrement")) {
    return "petWeightIncrement";
  }
  if (issues.some((issue) => issue.path[0] === "weightKg" && issue.message === "max")) return "petWeightTooHigh";
  return "invalid";
}

function petWeightRedirect(petId: string, status: string, formData?: FormData): never {
  const params = new URLSearchParams({ petId, status });
  if (formData?.get("includeInactive") === "1") params.set("includeInactive", "1");
  const page = formData?.get("page");
  if (typeof page === "string" && /^\d+$/.test(page) && Number(page) > 1) params.set("page", page);
  redirect(`/weights?${params.toString()}`);
}

/**
 * 画面表示後の権限変更を考慮し、Pet体重更新と同じtransactionで最新membershipを確認する。
 */
async function assertCurrentPetWeightMutationPermission(
  tx: Prisma.TransactionClient,
  householdId: string,
  userId: string
) {
  const membership = await tx.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { role: true }
  });
  if (!membership || !canEditHouseholdSharedData(membership.role)) {
    throw new PetWeightMutationForbiddenError();
  }
}

function decimalWeight(weightKg: number) {
  return new Prisma.Decimal(weightKg.toFixed(2));
}

function handleKnownPetWeightError(error: unknown, petId: string, formData: FormData): void {
  if (error instanceof PetWeightMutationForbiddenError) petWeightRedirect(petId, "viewerForbidden", formData);
  if (error instanceof InactivePetWeightMutationError) petWeightRedirect(petId, "petWeightLocked", formData);
  if (error instanceof PetWeightUnchangedError) petWeightRedirect(petId, "unchanged", formData);
  if (error instanceof PetWeightRecordNotFoundError) petWeightRedirect(petId, "invalid", formData);
  if (isPrismaUniqueConstraintError(error)) petWeightRedirect(petId, "duplicate", formData);
}

export async function createPetWeightRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/weights");
    const result = createPetWeightRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) petWeightRedirect(petId, petWeightValidationStatus(result.error.issues), formData);

    const recordDate = parseDateInput(result.data.recordDate);
    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWeight",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await assertCurrentPetWeightMutationPermission(tx, context.household.id, context.user.id);
        const pet = await tx.pet.findFirst({
          where: { id: result.data.petId, householdId: context.household.id },
          select: { name: true, isActive: true }
        });
        if (!pet) throw new PetWeightRecordNotFoundError();
        if (!pet.isActive) throw new InactivePetWeightMutationError();
        const record = await tx.petWeightRecord.create({
          data: {
            petId: result.data.petId,
            recordDate,
            weightKg: decimalWeight(result.data.weightKg),
            memo: result.data.memo
          }
        });
        return { record, petName: pet.name };
      },
      activity: ({ record, petName }) => ({
        eventType: "PET_WEIGHT_CREATED",
        category: "CARE_RECORD",
        targetType: "PET_WEIGHT_RECORD",
        targetId: record.id,
        targetNameSnapshot: petName,
        details: { recordDate: result.data.recordDate, weightKg: result.data.weightKg }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWeights.create.revalidate",
      { householdId: context.household.id, petId: result.data.petId }
    );
    petWeightRedirect(result.data.petId, "created", formData);
  } catch (error) {
    handleKnownPetWeightError(error, petId, formData);
    const params = new URLSearchParams();
    if (petId) params.set("petId", petId);
    handleServerActionError(error, {
      operation: "petWeights.create",
      pathname: "/weights",
      searchParams: params,
      context: { petId }
    });
  }
}

export async function updatePetWeightRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/weights");
    const result = updatePetWeightRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) petWeightRedirect(petId, petWeightValidationStatus(result.error.issues), formData);

    const nextWeight = decimalWeight(result.data.weightKg);
    const nextDate = parseDateInput(result.data.recordDate);
    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWeight",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await assertCurrentPetWeightMutationPermission(tx, context.household.id, context.user.id);
        const record = await tx.petWeightRecord.findFirst({
          where: { id: result.data.id, petId: result.data.petId, pet: { householdId: context.household.id } },
          select: {
            id: true,
            recordDate: true,
            weightKg: true,
            memo: true,
            updatedAt: true,
            pet: { select: { name: true, isActive: true } }
          }
        });
        if (!record) throw new PetWeightRecordNotFoundError();
        if (!record.pet.isActive) throw new InactivePetWeightMutationError();
        if (
          toDateInputValue(record.recordDate) === result.data.recordDate &&
          record.weightKg.equals(nextWeight) &&
          record.memo === result.data.memo
        ) {
          throw new PetWeightUnchangedError();
        }
        const updated = await tx.petWeightRecord.updateMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            updatedAt: record.updatedAt,
            pet: { householdId: context.household.id, isActive: true }
          },
          data: { recordDate: nextDate, weightKg: nextWeight, memo: result.data.memo }
        });
        if (updated.count !== 1) throw new PetWeightRecordNotFoundError();
        return { record, petName: record.pet.name };
      },
      activity: ({ record, petName }) => ({
        eventType: "PET_WEIGHT_UPDATED",
        category: "CARE_RECORD",
        targetType: "PET_WEIGHT_RECORD",
        targetId: record.id,
        targetNameSnapshot: petName,
        details: {
          previousRecordDate: toDateInputValue(record.recordDate),
          newRecordDate: result.data.recordDate,
          previousWeightKg: Number(record.weightKg),
          newWeightKg: result.data.weightKg
        }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWeights.update.revalidate",
      { householdId: context.household.id, petId: result.data.petId, petWeightRecordId: result.data.id }
    );
    petWeightRedirect(result.data.petId, "updated", formData);
  } catch (error) {
    handleKnownPetWeightError(error, petId, formData);
    const params = new URLSearchParams();
    if (petId) params.set("petId", petId);
    handleServerActionError(error, {
      operation: "petWeights.update",
      pathname: "/weights",
      searchParams: params,
      context: { petId }
    });
  }
}

export async function deletePetWeightRecord(formData: FormData) {
  const rawPetId = formData.get("petId");
  const petId = typeof rawPetId === "string" ? rawPetId : "";
  try {
    const context = await getRequiredHouseholdMutationContext("/weights");
    const result = deletePetWeightRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) petWeightRedirect(petId, "invalid", formData);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "petWeight",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        await assertCurrentPetWeightMutationPermission(tx, context.household.id, context.user.id);
        const record = await tx.petWeightRecord.findFirst({
          where: { id: result.data.id, petId: result.data.petId, pet: { householdId: context.household.id } },
          select: {
            id: true,
            recordDate: true,
            weightKg: true,
            pet: { select: { name: true, isActive: true } }
          }
        });
        if (!record) throw new PetWeightRecordNotFoundError();
        if (!record.pet.isActive) throw new InactivePetWeightMutationError();
        const deleted = await tx.petWeightRecord.deleteMany({
          where: {
            id: result.data.id,
            petId: result.data.petId,
            pet: { householdId: context.household.id, isActive: true }
          }
        });
        if (deleted.count !== 1) throw new PetWeightRecordNotFoundError();
        return { record, petName: record.pet.name };
      },
      activity: ({ record, petName }) => ({
        eventType: "PET_WEIGHT_DELETED",
        category: "CARE_RECORD",
        targetType: "PET_WEIGHT_RECORD",
        targetId: record.id,
        targetNameSnapshot: petName,
        details: {
          recordDate: toDateInputValue(record.recordDate),
          weightKg: Number(record.weightKg)
        }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "petWeights.delete.revalidate",
      { householdId: context.household.id, petId: result.data.petId, petWeightRecordId: result.data.id }
    );
    petWeightRedirect(result.data.petId, "deleted", formData);
  } catch (error) {
    handleKnownPetWeightError(error, petId, formData);
    const params = new URLSearchParams();
    if (petId) params.set("petId", petId);
    handleServerActionError(error, {
      operation: "petWeights.delete",
      pathname: "/weights",
      searchParams: params,
      context: { petId }
    });
  }
}
