"use server";

import { unstable_rethrow } from "next/navigation";

import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { logUnexpectedError } from "@/lib/server-errors";
import {
  createSettingsSaveState,
  type SettingsSaveState
} from "@/lib/settings-save-state";

/** 現在のHouseholdにおける本人の通知本文モードだけを保存する。 */
export async function saveCareNotificationBodySetting(
  previousState: SettingsSaveState,
  formData: FormData
): Promise<SettingsSaveState> {
  try {
    const context = await getRequiredHouseholdContext();
    const bodyMode = formData.get("careNotificationBodyMode");
    if (bodyMode !== "normal" && bodyMode !== "compact") {
      return createSettingsSaveState(previousState, "invalid");
    }
    const compact = bodyMode === "compact";
    const result = await prisma.$transaction(async (tx) => {
      const membership = await tx.householdMember.findUnique({
        where: {
          householdId_userId: {
            householdId: context.household.id,
            userId: context.user.id
          }
        },
        select: { id: true, household: { select: { isDemo: true } } }
      });
      if (!membership || membership.household.isDemo) return "forbidden" as const;
      const current = await tx.appSetting.findUnique({
        where: {
          userId_householdId: { userId: context.user.id, householdId: context.household.id }
        },
        select: { careNotificationCompactBody: true }
      });
      if ((current?.careNotificationCompactBody ?? false) === compact) return "unchanged" as const;
      await tx.appSetting.upsert({
        where: {
          userId_householdId: { userId: context.user.id, householdId: context.household.id }
        },
        update: { careNotificationCompactBody: compact },
        create: {
          userId: context.user.id,
          householdId: context.household.id,
          careNotificationCompactBody: compact
        }
      });
      return "notificationSaved" as const;
    });
    if (result === "forbidden") return createSettingsSaveState(previousState, "forbidden");
    revalidatePathsSafely([{ path: "/settings" }], "careNotifications.body.revalidate", {
      userId: context.user.id,
      householdId: context.household.id
    });
    return createSettingsSaveState(previousState, result, {
      savedCareNotificationCompactBody: compact
    });
  } catch (error) {
    unstable_rethrow(error);
    const errorId = logUnexpectedError(error, { operation: "careNotifications.body.save" });
    return createSettingsSaveState(previousState, "systemError", { errorId });
  }
}
