"use server";

import { redirect } from "next/navigation";

import { getRequiredHouseholdContext } from "@/lib/auth-context";
import {
  careNotificationSettingsEqual,
  parseCareNotificationSettingsForm
} from "@/lib/care-notification-settings";
import { normalizeCareNotificationSettings } from "@/lib/care-notifications";
import { prisma } from "@/lib/prisma";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { handleServerActionError } from "@/lib/server-errors";

export async function saveCareNotificationSettings(formData: FormData) {
  try {
    const context = await getRequiredHouseholdContext();
    const nextSetting = parseCareNotificationSettingsForm({
      feedingNotificationEnabled: formData.get("feedingNotificationEnabled") === "on",
      feedingDeadline: formData.get("feedingDeadline"),
      feedingNotifyBeforeMinutes: formData.get("feedingNotifyBeforeMinutes"),
      waterNotificationEnabled: formData.get("waterNotificationEnabled") === "on",
      waterDeadline: formData.get("waterDeadline"),
      waterNotifyBeforeMinutes: formData.get("waterNotifyBeforeMinutes")
    });
    if (!nextSetting) redirect("/settings?status=invalid");

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
        waterNotifyBeforeMinutes: true
      }
    });
    if (careNotificationSettingsEqual(normalizeCareNotificationSettings(current), nextSetting)) {
      redirect("/settings?status=unchanged");
    }

    await prisma.$transaction(async (tx) => {
      // VIEWERも自分の設定は変更可能。共有データではないが、保存直前の所属だけは再確認する。
      const membership = await tx.householdMember.findUnique({
        where: {
          householdId_userId: { householdId: context.household.id, userId: context.user.id }
        },
        select: { id: true }
      });
      if (!membership) redirect("/settings?status=forbidden");
      await tx.appSetting.upsert({
        where: {
          userId_householdId: { userId: context.user.id, householdId: context.household.id }
        },
        update: nextSetting,
        create: { userId: context.user.id, householdId: context.household.id, ...nextSetting }
      });
    });
    revalidatePathsSafely([{ path: "/settings" }], "careNotifications.settings.revalidate", {
      userId: context.user.id,
      householdId: context.household.id
    });
    redirect("/settings?status=notificationSaved");
  } catch (error) {
    handleServerActionError(error, {
      operation: "careNotifications.settings.save",
      pathname: "/settings"
    });
  }
}
