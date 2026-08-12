"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import type { ZodIssue } from "zod";

import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { commitHouseholdMutation, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { handleServerActionError, isPrismaUniqueConstraintError } from "@/lib/server-errors";
import { createPetSchema, updatePetActiveStatusSchema, updatePetSchema } from "@/lib/schemas";

class PetMutationForbiddenError extends Error {
  constructor() {
    super("The current membership cannot mutate Pet data.");
    this.name = "PetMutationForbiddenError";
  }
}

/**
 * 画面表示後に権限が変わる場合に備え、Pet更新と同じtransaction内で最新membershipを確認する。
 */
async function assertCurrentPetMutationPermission(
  tx: Prisma.TransactionClient,
  householdId: string,
  userId: string
) {
  const membership = await tx.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { role: true }
  });

  if (!membership || !canEditHouseholdSharedData(membership.role)) {
    throw new PetMutationForbiddenError();
  }
}

function isSameNullableDate(first: Date | null, second: Date | null) {
  if (first === null || second === null) return first === second;
  return first.getTime() === second.getTime();
}

function petValidationStatus(issues: ZodIssue[]) {
  if (issues.some((issue) => issue.path[0] === "name" && issue.code === "too_big")) {
    return "petNameTooLong";
  }
  if (issues.some((issue) => issue.path[0] === "breed" && issue.code === "too_big")) {
    return "petBreedTooLong";
  }
  if (issues.some((issue) => issue.path[0] === "memo" && issue.code === "too_big")) {
    return "petMemoTooLong";
  }
  if (
    issues.some(
      (issue) => ["birthDate", "adoptionDate"].includes(String(issue.path[0])) && issue.message === "future"
    )
  ) {
    return "future";
  }
  return "invalid";
}

export async function createPet(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/pets");
    const result = createPetSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) redirect(`/pets?status=${petValidationStatus(result.error.issues)}`);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "pet",
      actorUserId: context.user.id,
      mutate: async (tx) => {
        await assertCurrentPetMutationPermission(tx, context.household.id, context.user.id);
        return tx.pet.create({
          data: { ...result.data, householdId: context.household.id }
        });
      }
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/pets" }], "pets.create.revalidate", {
      householdId: context.household.id
    });
    redirect("/pets?status=created");
  } catch (error) {
    if (error instanceof PetMutationForbiddenError) redirect("/pets?status=viewerForbidden");
    if (isPrismaUniqueConstraintError(error)) redirect("/pets?status=petDuplicate");
    handleServerActionError(error, { operation: "pets.create", pathname: "/pets" });
  }
}

export async function updatePet(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/pets");
    const result = updatePetSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) redirect(`/pets?status=${petValidationStatus(result.error.issues)}`);

    const { id, ...data } = result.data;
    const pet = await prisma.pet.findFirst({
      where: { id, householdId: context.household.id },
      select: {
        name: true,
        breed: true,
        sex: true,
        birthDate: true,
        adoptionDate: true,
        memo: true,
        updatedAt: true
      }
    });
    if (!pet) redirect("/pets?status=invalid");

    if (
      pet.name === data.name &&
      pet.breed === data.breed &&
      pet.sex === data.sex &&
      isSameNullableDate(pet.birthDate, data.birthDate) &&
      isSameNullableDate(pet.adoptionDate, data.adoptionDate) &&
      pet.memo === data.memo
    ) {
      redirect("/pets?status=unchanged");
    }

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "pet",
      actorUserId: context.user.id,
      mutate: async (tx) => {
        await assertCurrentPetMutationPermission(tx, context.household.id, context.user.id);
        const updated = await tx.pet.updateMany({
          where: { id, householdId: context.household.id, updatedAt: pet.updatedAt },
          data
        });
        if (updated.count !== 1) redirect("/pets?status=invalid");
        return updated;
      }
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/pets" }], "pets.update.revalidate", {
      householdId: context.household.id,
      petId: id
    });
    redirect("/pets?status=updated");
  } catch (error) {
    if (error instanceof PetMutationForbiddenError) redirect("/pets?status=viewerForbidden");
    if (isPrismaUniqueConstraintError(error)) redirect("/pets?status=petDuplicate");
    handleServerActionError(error, { operation: "pets.update", pathname: "/pets" });
  }
}

export async function updatePetActiveStatus(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/pets");
    const result = updatePetActiveStatusSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) redirect("/pets?status=invalid");

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "pet",
      actorUserId: context.user.id,
      mutate: async (tx) => {
        await assertCurrentPetMutationPermission(tx, context.household.id, context.user.id);
        const pet = await tx.pet.findFirst({
          where: { id: result.data.id, householdId: context.household.id },
          select: { isActive: true }
        });
        if (!pet) redirect("/pets?status=invalid");
        if (pet.isActive === result.data.isActive) redirect("/pets?status=unchanged");

        const updated = await tx.pet.updateMany({
          where: { id: result.data.id, householdId: context.household.id, isActive: pet.isActive },
          data: { isActive: result.data.isActive }
        });
        if (updated.count !== 1) redirect("/pets?status=invalid");
        return updated;
      }
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/pets" }], "pets.activeStatus.revalidate", {
      householdId: context.household.id,
      petId: result.data.id
    });
    redirect("/pets?status=updated");
  } catch (error) {
    if (error instanceof PetMutationForbiddenError) redirect("/pets?status=viewerForbidden");
    handleServerActionError(error, { operation: "pets.activeStatus", pathname: "/pets" });
  }
}
