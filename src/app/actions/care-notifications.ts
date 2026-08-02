"use server";

import { unstable_rethrow } from "next/navigation";

import { getRequiredHouseholdContext } from "@/lib/auth-context";
import {
  careNotificationSettingsEqual,
  parseCareNotificationSettingsForm
} from "@/lib/care-notification-settings";
import { normalizeCareNotificationSettings } from "@/lib/care-notifications";
import { prisma } from "@/lib/prisma";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { logUnexpectedError } from "@/lib/server-errors";
import {
  createSettingsSaveState,
  type SettingsSaveState
} from "@/lib/settings-save-state";

/**
 * 現在ユーザー・Household組み合わせのお世話通知設定を保存するServer Action。
 *
 * 共有データではないためVIEWERも変更できるが、保存直前に所属継続を再確認する。
 * Web Push端末の購読登録は別APIの責務で、このActionでは変更しない。
 */
export async function saveCareNotificationSettings(
  previousState: SettingsSaveState,
  formData: FormData
): Promise<SettingsSaveState> {
  try {
    const context = await getRequiredHouseholdContext();
    const nextSetting = parseCareNotificationSettingsForm({
      feedingNotificationEnabled: formData.get("feedingNotificationEnabled") === "on",
      feedingDeadline: formData.get("feedingDeadline"),
      feedingNotifyBeforeMinutes: formData.get("feedingNotifyBeforeMinutes"),
      waterNotificationEnabled: formData.get("waterNotificationEnabled") === "on",
      waterDeadline: formData.get("waterDeadline"),
      waterNotifyBeforeMinutes: formData.get("waterNotifyBeforeMinutes"),
      careNotificationCompactBody: formData.get("careNotificationCompactBody") === "on"
    });
    if (!nextSetting) return createSettingsSaveState(previousState, "invalid");

    const current = await prisma.appSetting.findUnique({
      where: {
        userId_householdId: { userId: context.user.id, householdId: context.household.id }
      },
      select: {
        feedingNotificationEnabled: true,
        feedingDeadlineMinutes: true,
        feedingNotifyBeforeMinutes: true,
        waterNotificationEnabled: true,
        waterDeadlineMinutes: true,
        waterNotifyBeforeMinutes: true,
        careNotificationCompactBody: true
      }
    });
    if (careNotificationSettingsEqual(normalizeCareNotificationSettings(current), nextSetting)) {
      return createSettingsSaveState(previousState, "unchanged", {
        savedCareNotificationSettings: nextSetting
      });
    }

    const saved = await prisma.$transaction(async (tx) => {
      // VIEWERも自分の設定は変更可能。共有データではないが、保存直前の所属だけは再確認する。
      const membership = await tx.householdMember.findUnique({
        where: {
          householdId_userId: { householdId: context.household.id, userId: context.user.id }
        },
        select: { id: true }
      });
      if (!membership) return false;
      await tx.appSetting.upsert({
        where: {
          userId_householdId: { userId: context.user.id, householdId: context.household.id }
        },
        update: nextSetting,
        create: { userId: context.user.id, householdId: context.household.id, ...nextSetting }
      });
      return true;
    });
    if (!saved) return createSettingsSaveState(previousState, "forbidden");
    revalidatePathsSafely([{ path: "/settings" }], "careNotifications.settings.revalidate", {
      userId: context.user.id,
      householdId: context.household.id
    });
    return createSettingsSaveState(previousState, "notificationSaved", {
      savedCareNotificationSettings: nextSetting
    });
  } catch (error) {
    unstable_rethrow(error);
    const errorId = logUnexpectedError(error, {
      operation: "careNotifications.settings.save"
    });
    return createSettingsSaveState(previousState, "systemError", { errorId });
  }
}
