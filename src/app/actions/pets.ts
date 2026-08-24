"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import type { ZodIssue } from "zod";

import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { writeServerLog } from "@/lib/logger";
import {
  commitWithNewPetImage,
  deletePetImage,
  getOptionalPetImageFile,
  PetImageError,
  preparePetImage
} from "@/lib/pet-image";
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

class PetBreedInvalidError extends Error {
  constructor() {
    super("The selected breed is unavailable for the Pet species.");
    this.name = "PetBreedInvalidError";
  }
}

export type PetCreateActionState = {
  submissionId: number;
  status:
    | "invalid"
    | "future"
    | "petDuplicate"
    | "petNameTooLong"
    | "petBreedTooLong"
    | "petBreedInvalid"
    | "petMemoTooLong"
    | "petImageTooLarge"
    | "petImageUnsupported"
    | "petImageInvalid"
    | null;
};

function createPetErrorState(
  previousState: PetCreateActionState,
  status: Exclude<PetCreateActionState["status"], null>
): PetCreateActionState {
  return { submissionId: previousState.submissionId + 1, status };
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
  if (issues.some((issue) => issue.path[0] === "customBreedName" && issue.code === "too_big")) {
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

/** breedIdをクライアント値だけで採用せず、有効状態とPet speciesを同一transaction内で確認する。 */
async function assertValidBreedChoice(
  tx: Prisma.TransactionClient,
  input: { breedId: string | null; customBreedName: string | null },
  species: "DOG" | "CAT",
  allowInactiveBreedId?: string | null
) {
  if (!input.breedId) return;
  const breed = await tx.breed.findFirst({
    where: {
      id: input.breedId,
      species,
      ...(input.breedId === allowInactiveBreedId ? {} : { isActive: true })
    },
    select: { id: true }
  });
  if (!breed) throw new PetBreedInvalidError();
}

function petImageValidationStatus(error: InstanceType<typeof PetImageError>) {
  if (error.code === "tooLarge") return "petImageTooLarge";
  if (error.code === "unsupported") return "petImageUnsupported";
  return "petImageInvalid";
}

/** DB更新後の画像削除失敗は更新結果を戻さず、安全な識別子だけをwarningへ残す。 */
async function deletePetImageAfterMutation(
  householdId: string,
  fileName: string,
  operation: string,
  petId: string
) {
  try {
    await deletePetImage(householdId, fileName);
  } catch (error) {
    writeServerLog("warn", {
      event: "pet_image_delete_failed",
      message: "Petプロフィール更新後の画像削除に失敗しました。",
      operation,
      context: { householdId, petId, errorName: error instanceof Error ? error.name : typeof error }
    });
  }
}

/**
 * Pet作成に成功した場合だけ従来の完了URLへredirectし、修正可能な入力エラーはフォームへ返す。
 * これによりClient Componentを再生成せず、ブラウザ上の入力値と選択済み画像を再送信に利用できる。
 */
export async function createPet(
  previousState: PetCreateActionState,
  formData: FormData
): Promise<PetCreateActionState> {
  try {
    const context = await getRequiredHouseholdMutationContext("/pets");
    const result = createPetSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return createPetErrorState(previousState, petValidationStatus(result.error.issues));
    }

    const imageFile = getOptionalPetImageFile(formData.get("profileImage"));
    const preparedImage = imageFile ? await preparePetImage(imageFile) : null;
    const commit = (profileImageFileName?: string) =>
      commitHouseholdMutation({
        householdId: context.household.id,
        source: "pet",
        actorUserId: context.user.id,
        mutate: async (tx) => {
          await assertCurrentPetMutationPermission(tx, context.household.id, context.user.id);
          await assertValidBreedChoice(tx, result.data, result.data.species);
          return tx.pet.create({
            data: { ...result.data, householdId: context.household.id, profileImageFileName }
          });
        }
      });
    const { result: createdPet, change } = preparedImage
      ? await commitWithNewPetImage({ householdId: context.household.id, image: preparedImage, commit })
      : await commit();
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/pets" }], "pets.create.revalidate", {
      householdId: context.household.id
    });
    redirect(`/pets?status=created&createdPetId=${encodeURIComponent(createdPet.id)}`);
  } catch (error) {
    if (error instanceof PetImageError) {
      return createPetErrorState(previousState, petImageValidationStatus(error));
    }
    if (error instanceof PetBreedInvalidError) {
      return createPetErrorState(previousState, "petBreedInvalid");
    }
    if (error instanceof PetMutationForbiddenError) redirect("/pets?status=viewerForbidden");
    if (isPrismaUniqueConstraintError(error)) {
      return createPetErrorState(previousState, "petDuplicate");
    }
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
        species: true,
        breedId: true,
        customBreedName: true,
        sex: true,
        birthDate: true,
        adoptionDate: true,
        memo: true,
        profileImageFileName: true,
        updatedAt: true
      }
    });
    if (!pet) redirect("/pets?status=invalid");

    const imageFile = getOptionalPetImageFile(formData.get("profileImage"));
    const removeProfileImage = formData.get("removeProfileImage") === "true";

    if (
      pet.name === data.name &&
      pet.breedId === data.breedId &&
      pet.customBreedName === data.customBreedName &&
      pet.sex === data.sex &&
      isSameNullableDate(pet.birthDate, data.birthDate) &&
      isSameNullableDate(pet.adoptionDate, data.adoptionDate) &&
      pet.memo === data.memo &&
      !imageFile &&
      !(removeProfileImage && pet.profileImageFileName)
    ) {
      redirect("/pets?status=unchanged");
    }

    const preparedImage = imageFile ? await preparePetImage(imageFile) : null;
    const commit = (profileImageFileName?: string | null) =>
      commitHouseholdMutation({
        householdId: context.household.id,
        source: "pet",
        actorUserId: context.user.id,
        mutate: async (tx) => {
          await assertCurrentPetMutationPermission(tx, context.household.id, context.user.id);
          await assertValidBreedChoice(tx, data, pet.species, pet.breedId);
          const updated = await tx.pet.updateMany({
            where: { id, householdId: context.household.id, updatedAt: pet.updatedAt },
            data: {
              ...data,
              ...(profileImageFileName !== undefined ? { profileImageFileName } : {})
            }
          });
          if (updated.count !== 1) redirect("/pets?status=invalid");
          return updated;
        }
      });
    const { change } = preparedImage
      ? await commitWithNewPetImage({ householdId: context.household.id, image: preparedImage, commit })
      : await commit(removeProfileImage ? null : undefined);
    publishHouseholdChangeSafely(change);
    if ((preparedImage || removeProfileImage) && pet.profileImageFileName) {
      await deletePetImageAfterMutation(
        context.household.id,
        pet.profileImageFileName,
        "pets.update.deleteOldImage",
        id
      );
    }
    revalidatePathsSafely([{ path: "/pets" }], "pets.update.revalidate", {
      householdId: context.household.id,
      petId: id
    });
    redirect("/pets?status=updated");
  } catch (error) {
    if (error instanceof PetImageError) redirect(`/pets?status=${petImageValidationStatus(error)}`);
    if (error instanceof PetBreedInvalidError) redirect("/pets?status=petBreedInvalid");
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
