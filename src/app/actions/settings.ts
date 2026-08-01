"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { normalizeCleaningMobileDefaultDateFilter } from "@/lib/cleaning-settings";
import {
  getDashboardHamsterSelectionError,
  normalizeDashboardBoardCount,
  normalizeHamsterSelectorMode,
  pickDashboardHamsters
} from "@/lib/dashboard-settings";
import { prisma } from "@/lib/prisma";
import { normalizeRecordScope } from "@/lib/records";
import {
  getRealtimeActorId,
  publishHouseholdChangesSafely,
  updateHouseholdRevisions
} from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { dashboardSettingsSchema, updateUserProfileSchema } from "@/lib/schemas";
import { logUnexpectedError } from "@/lib/server-errors";
import { getSettingsChanges } from "@/lib/settings-diff";
import {
  createSettingsSaveState,
  type SettingsSaveState
} from "@/lib/settings-save-state";

export async function saveSettings(previousState: SettingsSaveState, formData: FormData): Promise<SettingsSaveState> {
  try {
    const context = await getRequiredHouseholdContext();
    const profileResult = updateUserProfileSchema.safeParse({ name: formData.get("name") });
    if (!profileResult.success) {
      const isNameTooLong = profileResult.error.issues.some(
        (issue) => issue.path[0] === "name" && issue.code === "too_big"
      );
      return createSettingsSaveState(previousState, isNameTooLong ? "profileNameTooLong" : "invalid");
    }
    const dashboardResult = dashboardSettingsSchema.safeParse({
      dashboardBoardCount: formData.get("dashboardBoardCount"),
      hamsterSelectorMode: formData.get("hamsterSelectorMode"),
      recordTimelineDefaultScope: formData.get("recordTimelineDefaultScope"),
      cleaningMobileDefaultDateFilter: formData.get("cleaningMobileDefaultDateFilter"),
      hamsterIds: formData.getAll("hamsterIds")
    });
    if (!dashboardResult.success) return createSettingsSaveState(previousState, "invalid");

    const {
      dashboardBoardCount,
      hamsterSelectorMode,
      recordTimelineDefaultScope,
      cleaningMobileDefaultDateFilter
    } = dashboardResult.data;
    const selectedHamsterIds = dashboardResult.data.hamsterIds;
    const savedDashboardSettings = {
      dashboardBoardCount,
      hamsterSelectorMode,
      recordTimelineDefaultScope,
      cleaningMobileDefaultDateFilter,
      hamsterIds: selectedHamsterIds
    };
    const [user, hamsters, setting] = await Promise.all([
      prisma.user.findUnique({
        where: { id: context.user.id },
        select: { id: true, name: true }
      }),
      prisma.hamster.findMany({
        where: { householdId: context.household.id },
        orderBy: { createdAt: "asc" },
        select: { id: true }
      }),
      prisma.appSetting.findUnique({
        where: { userId_householdId: { userId: context.user.id, householdId: context.household.id } },
        include: { dashboardHamsters: { orderBy: { sortOrder: "asc" } } }
      })
    ]);
    if (!user) redirect("/login");

    const selectionError = getDashboardHamsterSelectionError(
      hamsters.map((hamster) => hamster.id),
      dashboardBoardCount,
      selectedHamsterIds
    );
    if (selectionError === "duplicate" || selectionError === "unknown") {
      return createSettingsSaveState(previousState, "invalid");
    }
    if (selectionError === "tooMany") {
      return createSettingsSaveState(previousState, "dashboardLimitExceeded");
    }
    if (selectionError === "tooFew") {
      return createSettingsSaveState(previousState, "dashboardSelectionRequired");
    }

    const currentBoardCount = normalizeDashboardBoardCount(setting?.dashboardBoardCount);
    const currentSelectorMode = normalizeHamsterSelectorMode(setting?.hamsterSelectorMode);
    const currentRecordTimelineDefaultScope = normalizeRecordScope(setting?.recordTimelineDefaultScope);
    const currentCleaningMobileDefaultDateFilter = normalizeCleaningMobileDefaultDateFilter(
      setting?.cleaningMobileDefaultDateFilter
    );
    const currentSelectedHamsterIds = pickDashboardHamsters(
      hamsters,
      currentBoardCount,
      setting?.dashboardHamsters.map((entry) => entry.hamsterId) ?? []
    ).map((hamster) => hamster.id);
    const {
      profileChanged,
      dashboardChanged,
      recordTimelineDefaultScopeChanged,
      cleaningMobileDefaultDateFilterChanged
    } = getSettingsChanges(
      {
        name: user.name ?? "",
        dashboardBoardCount: currentBoardCount,
        hamsterSelectorMode: currentSelectorMode,
        recordTimelineDefaultScope: currentRecordTimelineDefaultScope,
        cleaningMobileDefaultDateFilter: currentCleaningMobileDefaultDateFilter,
        hamsterIds: currentSelectedHamsterIds
      },
      {
        name: profileResult.data.name,
        dashboardBoardCount,
        hamsterSelectorMode,
        recordTimelineDefaultScope,
        cleaningMobileDefaultDateFilter,
        hamsterIds: selectedHamsterIds
      }
    );

    if (
      !profileChanged &&
      !dashboardChanged &&
      !recordTimelineDefaultScopeChanged &&
      !cleaningMobileDefaultDateFilterChanged
    ) {
      return createSettingsSaveState(previousState, "unchanged", {
        savedName: profileResult.data.name,
        savedDashboardSettings
      });
    }

    const actorClientId = getRealtimeActorId(formData);
    const changes = await prisma.$transaction(async (tx) => {
      if (profileChanged) {
        await tx.user.update({ where: { id: context.user.id }, data: { name: profileResult.data.name } });
      }

      if (dashboardChanged || recordTimelineDefaultScopeChanged || cleaningMobileDefaultDateFilterChanged) {
        const setting = await tx.appSetting.upsert({
          where: { userId_householdId: { userId: context.user.id, householdId: context.household.id } },
          update: {
            dashboardBoardCount,
            hamsterSelectorMode,
            recordTimelineDefaultScope,
            cleaningMobileDefaultDateFilter
          },
          create: {
            userId: context.user.id,
            householdId: context.household.id,
            dashboardBoardCount,
            hamsterSelectorMode,
            recordTimelineDefaultScope,
            cleaningMobileDefaultDateFilter
          }
        });
        if (dashboardChanged) {
          await tx.dashboardHamster.deleteMany({ where: { settingId: setting.id } });
          for (const [index, hamsterId] of selectedHamsterIds.entries()) {
            await tx.dashboardHamster.create({ data: { settingId: setting.id, hamsterId, sortOrder: index } });
          }
        }
      }
      // 表示名は全所属Householdに現れるため、個人用ダッシュボード設定と異なり全所属先へ通知する。
      const householdIds = profileChanged
        ? (
            await tx.householdMember.findMany({
              where: { userId: context.user.id },
              select: { householdId: true }
            })
          ).map((membership) => membership.householdId)
        : [context.household.id];

      return updateHouseholdRevisions(
        tx,
        householdIds,
        profileChanged ? "profile" : "settings",
        actorClientId,
        context.user.id
      );
    });

    publishHouseholdChangesSafely(changes);
    revalidatePathsSafely(
      [
        { path: "/", type: "layout" },
        { path: "/cleaning" },
        { path: "/records" },
        { path: "/settings" },
        { path: "/settings/members" },
        { path: "/weights" },
        { path: "/weights/export" },
        { path: "/admin" }
      ],
      "settings.save.revalidate",
      { householdId: context.household.id, userId: context.user.id }
    );
    return createSettingsSaveState(previousState, "saved", {
      savedName: profileResult.data.name,
      savedDashboardSettings
    });
  } catch (error) {
    unstable_rethrow(error);
    const errorId = logUnexpectedError(error, { operation: "settings.save" });
    return createSettingsSaveState(previousState, "systemError", { errorId });
  }
}
