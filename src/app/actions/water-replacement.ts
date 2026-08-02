"use server";

import { redirect } from "next/navigation";

import { belongsToCurrentHousehold, canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { toDateInputValue } from "@/lib/date";
import { activityActorName } from "@/lib/household-activity";
import { commitHouseholdMutation, getRealtimeActorId, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { waterReplacementStateSchema } from "@/lib/schemas";
import { handleServerActionError } from "@/lib/server-errors";
import { setTodayWaterReplacementState } from "@/lib/water-replacement";

/**
 * 現在のお世話日に対する水替え状態を更新するServer Action。
 *
 * transaction内で所属・編集権限・管理中状態・日替わり時刻を再取得し、
 * 記録、操作履歴、revisionを原子的に確定してから通知・cache再検証を行う。
 */
export async function setTodayWaterReplacement(formData: FormData) {
  const submittedHamsterId = formData.get("hamsterId");

  try {
    const context = await getRequiredHouseholdMutationContext("/");
    const parsed = waterReplacementStateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect("/?status=invalid");

    const now = new Date();
    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "waterReplacement",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: async (tx) => {
        // クライアントのIDを信用せず、更新transaction内でも最新の所属・設定・管理状態を確定する。
        const [membership, hamster] = await Promise.all([
          tx.householdMember.findUnique({
            where: {
              householdId_userId: {
                householdId: context.household.id,
                userId: context.user.id
              }
            },
            select: {
              role: true,
              household: { select: { careDayStartMinutes: true, isDemo: true } }
            }
          }),
          tx.hamster.findUnique({
            where: { id: parsed.data.hamsterId },
            select: { householdId: true, isActive: true, name: true }
          })
        ]);
        if (!membership || !canEditHouseholdSharedData(membership.role)) {
          redirect("/?status=viewerForbidden");
        }
        if (membership.household.isDemo) redirect("/?status=invalid");
        if (!hamster || !belongsToCurrentHousehold(hamster.householdId, context.household.id)) {
          redirect("/?status=invalid");
        }
        if (!hamster.isActive) redirect("/?status=locked");

        const waterReplacement = await setTodayWaterReplacementState(tx, {
          hamsterId: parsed.data.hamsterId,
          createdByUserId: context.user.id,
          state: parsed.data.state,
          now,
          careDayStartMinutes: membership.household.careDayStartMinutes
        });
        return { ...waterReplacement, hamsterName: hamster.name };
      },
      activity: (result) =>
        result.changed
          ? {
              eventType:
                parsed.data.state === "marked"
                  ? "WATER_REPLACEMENT_MARKED"
                  : "WATER_REPLACEMENT_UNMARKED",
              category: "CARE_RECORD",
              targetType: "HAMSTER",
              targetId: parsed.data.hamsterId,
              targetNameSnapshot: result.hamsterName,
              details: { recordDate: toDateInputValue(result.recordDate) }
            }
          : null
    });

    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [
        { path: "/" },
        { path: "/settings/members" },
        { path: "/settings/members/activity" }
      ],
      "waterReplacement.setToday.revalidate",
      {
        householdId: context.household.id,
        hamsterId: parsed.data.hamsterId
      }
    );
    redirect("/");
  } catch (error) {
    handleServerActionError(error, {
      operation: "waterReplacement.setToday",
      pathname: "/",
      context: {
        hamsterId: typeof submittedHamsterId === "string" ? submittedHamsterId : undefined
      }
    });
  }
}
