"use server";

import { unstable_rethrow } from "next/navigation";

import { getRequiredHouseholdContext } from "@/lib/auth-context";
import {
  parsePetNotificationRulesJson,
  petNotificationRulesEqual,
  validatePetNotificationRuleSet
} from "@/lib/pet-notification-settings";
import {
  createPetNotificationSaveState,
  type PetNotificationSaveState
} from "@/lib/pet-notification-save-state";
import { prisma } from "@/lib/prisma";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { logUnexpectedError } from "@/lib/server-errors";

const VALIDATION_STATUS = {
  tooMany: "petNotificationLimitExceeded",
  speciesMismatch: "petNotificationSpeciesMismatch",
  invalidSchedule: "petNotificationScheduleInvalid",
  duplicate: "petNotificationDuplicate"
} as const;

/**
 * 現在ユーザーの1 Pet分の通知ルールを一括置換する。
 * 共有Pet更新権限とは分離し、VIEWERを含む所属メンバー本人だけに許可する。
 */
export async function savePetNotificationRules(
  previousState: PetNotificationSaveState,
  formData: FormData
): Promise<PetNotificationSaveState> {
  try {
    const context = await getRequiredHouseholdContext();
    const petId = formData.get("petId");
    const rules = parsePetNotificationRulesJson(formData.get("rules"));
    if (typeof petId !== "string" || petId.length > 128 || !rules) {
      return createPetNotificationSaveState(previousState, "invalid");
    }

    const outcome = await prisma.$transaction(async (tx) => {
      // 同じ利用者・Petへの複数タブ保存を直列化し、一括置換の途中状態を外へ見せない。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.user.id}:${petId}`}, 0))`;
      const [membership, pet] = await Promise.all([
        tx.householdMember.findUnique({
          where: {
            householdId_userId: {
              householdId: context.household.id,
              userId: context.user.id
            }
          },
          select: {
            id: true,
            household: { select: { careDayStartMinutes: true, isDemo: true } }
          }
        }),
        tx.pet.findFirst({
          where: { id: petId, householdId: context.household.id },
          select: { id: true, species: true }
        })
      ]);
      if (!membership || membership.household.isDemo || !pet) {
        return { status: "forbidden" as const };
      }

      const validation = validatePetNotificationRuleSet(
        pet.species,
        membership.household.careDayStartMinutes,
        rules
      );
      if (validation) return { status: VALIDATION_STATUS[validation] };

      const current = await tx.petNotificationRule.findMany({
        where: {
          userId: context.user.id,
          householdId: context.household.id,
          petId
        },
        select: {
          kind: true,
          label: true,
          deadlineMinutes: true,
          notifyBeforeMinutes: true,
          enabled: true
        }
      });
      if (petNotificationRulesEqual(current, rules)) {
        return { status: "unchanged" as const, rules };
      }

      await tx.petNotificationRule.deleteMany({
        where: { userId: context.user.id, householdId: context.household.id, petId }
      });
      if (rules.length > 0) {
        await tx.petNotificationRule.createMany({
          data: rules.map((rule) => ({
            ...rule,
            userId: context.user.id,
            householdId: context.household.id,
            petId
          }))
        });
      }
      return { status: "petNotificationSaved" as const, rules };
    });

    if (outcome.status === "forbidden") {
      return createPetNotificationSaveState(previousState, "forbidden");
    }
    if (outcome.status !== "petNotificationSaved" && outcome.status !== "unchanged") {
      return createPetNotificationSaveState(previousState, outcome.status);
    }
    revalidatePathsSafely([{ path: "/pets" }], "petNotifications.rules.revalidate", {
      userId: context.user.id,
      householdId: context.household.id,
      petId
    });
    return createPetNotificationSaveState(previousState, outcome.status, {
      savedRules: outcome.rules
    });
  } catch (error) {
    unstable_rethrow(error);
    const errorId = logUnexpectedError(error, { operation: "petNotifications.rules.save" });
    return createPetNotificationSaveState(previousState, "systemError", { errorId });
  }
}
