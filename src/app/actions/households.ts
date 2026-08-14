"use server";

import { redirect } from "next/navigation";

import { getRequiredSessionUser, setCurrentHouseholdCookie } from "@/lib/auth-context";
import { DEFAULT_DASHBOARD_BOARD_COUNT } from "@/lib/dashboard-settings";
import { prisma } from "@/lib/prisma";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { handleServerActionError } from "@/lib/server-errors";

function getRedirectPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

export async function switchCurrentHousehold(formData: FormData) {
  const redirectTo = getRedirectPath(formData.get("redirectTo"));
  try {
    const householdId = formData.get("householdId");
    if (typeof householdId !== "string" || !householdId) redirect(redirectTo);

    const user = await getRequiredSessionUser();
    const membership = await prisma.householdMember.findFirst({
      where: { householdId, userId: user.id },
      select: { householdId: true }
    });
    if (!membership) redirect(redirectTo);

    await prisma.appSetting.upsert({
      where: { userId_householdId: { userId: user.id, householdId } },
      update: {},
      create: {
        userId: user.id,
        householdId,
        dashboardBoardCount: DEFAULT_DASHBOARD_BOARD_COUNT
      }
    });
    await setCurrentHouseholdCookie(householdId);
    revalidatePathsSafely([{ path: "/", type: "layout" }], "households.switch.revalidate", {
      householdId,
      userId: user.id
    });
    redirect(redirectTo);
  } catch (error) {
    handleServerActionError(error, { operation: "households.switch", pathname: "/settings" });
  }
}
