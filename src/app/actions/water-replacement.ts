"use server";

import { redirect } from "next/navigation";

import { belongsToCurrentHousehold } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { todayInputJst } from "@/lib/date";
import { activityActorName } from "@/lib/household-activity";
import { commitHouseholdMutation, getRealtimeActorId, publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { waterReplacementStateSchema } from "@/lib/schemas";
import { handleServerActionError } from "@/lib/server-errors";
import { setTodayWaterReplacementState } from "@/lib/water-replacement";

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
        const hamster = await tx.hamster.findUnique({
          where: { id: parsed.data.hamsterId },
          select: { householdId: true, isActive: true, name: true }
        });
        if (!hamster || !belongsToCurrentHousehold(hamster.householdId, context.household.id)) {
          redirect("/?status=invalid");
        }
        if (!hamster.isActive) redirect("/?status=locked");

        const waterReplacement = await setTodayWaterReplacementState(tx, {
          hamsterId: parsed.data.hamsterId,
          createdByUserId: context.user.id,
          state: parsed.data.state,
          now
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
              details: { recordDate: todayInputJst(now) }
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
