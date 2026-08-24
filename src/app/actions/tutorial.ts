"use server";

import { revalidatePath } from "next/cache";

import { getRequiredSessionUser } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { CURRENT_ONBOARDING_VERSION } from "@/lib/tutorial";

/**
 * 初回ガイドの完了または明示的なスキップを、Householdではなくユーザー単位で保存する。
 * クライアントからversionを受け取らず、古いリクエストで新しい完了versionを巻き戻さない。
 */
export async function completeCurrentOnboarding() {
  const user = await getRequiredSessionUser();

  await prisma.user.updateMany({
    where: {
      id: user.id,
      onboardingVersion: { lt: CURRENT_ONBOARDING_VERSION }
    },
    data: { onboardingVersion: CURRENT_ONBOARDING_VERSION }
  });

  revalidatePath("/", "layout");
}
