"use server";

import { unstable_rethrow } from "next/navigation";

import { canManageCareDaySettings } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import {
  normalizeCareDayStartMinutes,
  parseTimeInputToMinutes
} from "@/lib/care-day";
import { prisma } from "@/lib/prisma";
import {
  getRealtimeActorId,
  publishHouseholdChangeSafely,
  updateHouseholdRevision
} from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { logUnexpectedError } from "@/lib/server-errors";
import {
  createSettingsSaveState,
  type SettingsSaveState
} from "@/lib/settings-save-state";

/**
 * Householdのお世話日境界を、最新の管理権限を再確認して保存するServer Action。
 *
 * 境界変更とrevision更新を同一transactionで確定し、Pet Careの各画面へ反映する。
 */
export async function saveCareDaySettings(
  previousState: SettingsSaveState,
  formData: FormData
): Promise<SettingsSaveState> {
  try {
    const context = await getRequiredHouseholdContext();
    const careDayStartMinutes = parseTimeInputToMinutes(formData.get("careDayStartTime"));
    if (careDayStartMinutes === null) {
      return createSettingsSaveState(previousState, "invalid");
    }

    const actorClientId = getRealtimeActorId(formData);
    const outcome = await prisma.$transaction(async (tx) => {
      // Household設定の変更と所属変更を直列化し、保存直前の権限と現在値を確定する。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.household.id}, 0))`;
      const membership = await tx.householdMember.findUnique({
        where: {
          householdId_userId: {
            householdId: context.household.id,
            userId: context.user.id
          }
        },
        select: {
          role: true,
          household: {
            select: { careDayStartMinutes: true, isDemo: true }
          }
        }
      });
      if (
        !membership ||
        membership.household.isDemo ||
        !canManageCareDaySettings(membership.role)
      ) {
        return { status: "forbidden" as const };
      }

      if (
        normalizeCareDayStartMinutes(membership.household.careDayStartMinutes) ===
        careDayStartMinutes
      ) {
        return { status: "unchanged" as const, careDayStartMinutes };
      }

      await tx.household.update({
        where: { id: context.household.id },
        data: { careDayStartMinutes }
      });
      const change = await updateHouseholdRevision(
        tx,
        context.household.id,
        "settings",
        actorClientId,
        context.user.id
      );
      return { status: "saved" as const, careDayStartMinutes, change };
    });

    if (outcome.status === "forbidden") {
      return createSettingsSaveState(previousState, "forbidden");
    }
    if (outcome.status === "unchanged") {
      return createSettingsSaveState(previousState, "unchanged", {
        savedCareDayStartMinutes: outcome.careDayStartMinutes
      });
    }

    publishHouseholdChangeSafely(outcome.change);
    revalidatePathsSafely(
      [{ path: "/" }, { path: "/settings" }],
      "careDaySettings.save.revalidate",
      { householdId: context.household.id }
    );
    return createSettingsSaveState(previousState, "careDaySaved", {
      savedCareDayStartMinutes: outcome.careDayStartMinutes
    });
  } catch (error) {
    unstable_rethrow(error);
    const errorId = logUnexpectedError(error, { operation: "careDaySettings.save" });
    return createSettingsSaveState(previousState, "systemError", { errorId });
  }
}
