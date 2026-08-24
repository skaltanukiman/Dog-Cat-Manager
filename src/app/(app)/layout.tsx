import { LogOut } from "lucide-react";

import { switchCurrentHousehold } from "@/app/actions/households";
import { auth, signOut } from "@/auth";
import { AppNav } from "@/components/app-nav";
import { HouseholdSwitcher } from "@/components/household-switcher";
import { RealtimeRefreshListener } from "@/components/realtime-refresh-listener";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { TutorialProvider } from "@/components/tutorial-provider";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getCurrentHouseholdSwitcherData } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

async function signOutAction() {
  "use server";

  await signOut({ redirectTo: "/login" });
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const currentUserLabel = session?.user?.name || session?.user?.email;
  const householdSwitcherData = session?.user ? await getCurrentHouseholdSwitcherData() : null;
  const isAppAdmin = session?.user?.appRole === "ADMIN" || session?.user?.appRole === "SUPER_ADMIN";
  const [onboardingVersion, hasActivePets] = householdSwitcherData
    ? await Promise.all([
        prisma.user
          .findUnique({
            where: { id: householdSwitcherData.context.user.id },
            select: { onboardingVersion: true }
          })
          .then((user) => user?.onboardingVersion ?? 0),
        prisma.pet
          .count({
            where: { householdId: householdSwitcherData.context.household.id, isActive: true }
          })
          .then((count) => count > 0)
      ])
    : [0, false];

  const content = (
    <div className="min-h-screen">
      {session?.user ? (
        <>
          <ServiceWorkerRegistration />
          {householdSwitcherData ? (
            <RealtimeRefreshListener
              key={householdSwitcherData.context.household.id}
              currentUserId={householdSwitcherData.context.user.id}
              householdId={householdSwitcherData.context.household.id}
            />
          ) : null}
          <header className="border-b border-slate-200 bg-surface-warm">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-brand">Dog & Cat Manager</p>
                  <h1 className="text-2xl font-bold text-ink">犬・猫管理</h1>
                </div>
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3 text-sm text-slate-600">
                  {householdSwitcherData ? (
                    <HouseholdSwitcher
                      currentHouseholdId={householdSwitcherData.context.household.id}
                      households={householdSwitcherData.households}
                      action={switchCurrentHousehold}
                    />
                  ) : null}
                  {currentUserLabel ? <span className="font-medium text-ink">{currentUserLabel}</span> : null}
                  <form action={signOutAction}>
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <LogOut className="h-4 w-4" aria-hidden />
                      ログアウト
                    </button>
                  </form>
                </div>
              </div>
              <AppNav isAppAdmin={isAppAdmin} />
            </div>
          </header>
        </>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );

  return householdSwitcherData ? (
    <TutorialProvider
      onboardingVersion={onboardingVersion}
      canCreatePets={canEditHouseholdSharedData(householdSwitcherData.context.membership.role)}
      hasPets={hasActivePets}
    >
      {content}
    </TutorialProvider>
  ) : (
    content
  );
}
