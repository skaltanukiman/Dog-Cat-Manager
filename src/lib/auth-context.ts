import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AppRole, HouseholdRole, UserAccessStatus } from "@prisma/client";

import { auth } from "@/auth";
import { DOG_CAT_AUTH_SESSION_COOKIE_NAMES } from "@/lib/auth-cookies";
import { canEditHouseholdSharedData, hasAuthenticatedUserId } from "@/lib/authorization";
import { DEFAULT_DASHBOARD_BOARD_COUNT, DEFAULT_HAMSTER_SELECTOR_MODE } from "@/lib/dashboard-settings";
import { prisma } from "@/lib/prisma";

export const CURRENT_HOUSEHOLD_COOKIE = "dog_cat_manager_current_household";
export const DEFAULT_HOUSEHOLD_NAME_SUFFIX = "の犬・猫管理";

export type SessionUser = {
  id: string;
  appRole: AppRole;
  accessStatus: UserAccessStatus;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export type CurrentHouseholdContext = {
  user: SessionUser;
  household: {
    id: string;
    name: string;
    careDayStartMinutes: number;
  };
  membership: {
    id: string;
    role: HouseholdRole;
    createdAt: Date;
  };
};

export type HouseholdOption = {
  id: string;
  name: string;
  role: HouseholdRole;
  memberCount: number;
  hamsterCount: number;
};

export function defaultHouseholdName(user: Pick<SessionUser, "name" | "email">) {
  const ownerName = user.name || user.email || "あなた";
  return `${ownerName}${DEFAULT_HOUSEHOLD_NAME_SUFFIX}`;
}

async function getPreferredHouseholdId() {
  const cookieStore = await cookies();
  return cookieStore.get(CURRENT_HOUSEHOLD_COOKIE)?.value;
}

/**
 * 認証済みかつ利用中のユーザーを、認可に使える最新DB状態で返す。
 *
 * Session内の権限は信用せずDBから再取得する。未認証・削除済み・停止中の場合は
 * loginへredirectし、Householdの自動作成は行わない。
 */
export async function getRequiredSessionUser(): Promise<SessionUser> {
  const session = await auth();
  const sessionUser = session?.user;

  if (!hasAuthenticatedUserId(sessionUser)) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, appRole: true, accessStatus: true, name: true, email: true, image: true }
  });
  if (!user) redirect("/login");
  if (user.accessStatus === "SUSPENDED") redirect("/login?status=accountSuspended");

  return user;
}

async function findMembership(userId: string, preferredHouseholdId?: string) {
  const memberships = await prisma.householdMember.findMany({
    where: { userId, household: { isDemo: false } },
    include: {
      household: {
        include: {
          _count: {
            select: {
              members: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  if (preferredHouseholdId) {
    const preferredMembership = memberships.find((membership) => membership.householdId === preferredHouseholdId);

    if (preferredMembership) {
      return preferredMembership;
    }
  }

  const invitedSharedMembership = memberships.find(
    (membership) => membership.role !== "OWNER" && membership.household._count.members > 1
  );
  const sharedMembership = memberships.find((membership) => membership.household._count.members > 1);

  // 招待されたユーザーは個人用Householdも持つため、cookie未設定時は共有中のHouseholdを優先する。
  return invitedSharedMembership ?? sharedMembership ?? memberships[0] ?? null;
}

async function createInitialHousehold(user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    // 初回ログイン直後は複数の Server Component が並行して初期化へ入るため、ユーザー単位で作成処理を直列化する。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;

    const existingMembership = await tx.householdMember.findFirst({
      where: { userId: user.id, household: { isDemo: false } },
      include: { household: true },
      orderBy: { createdAt: "asc" }
    });

    if (existingMembership) {
      return { membership: existingMembership, created: false as const };
    }

    const household = await tx.household.create({
      data: {
        name: defaultHouseholdName(user),
        members: {
          create: {
            userId: user.id,
            role: "OWNER"
          }
        },
        appSettings: {
          create: {
            userId: user.id,
            dashboardBoardCount: DEFAULT_DASHBOARD_BOARD_COUNT,
            hamsterSelectorMode: DEFAULT_HAMSTER_SELECTOR_MODE
          }
        }
      },
      include: {
        members: {
          where: { userId: user.id },
          include: { household: true }
        }
      }
    });

    return { membership: household.members[0], created: true as const };
  });
}

export async function ensureUserHouseholdMembershipWithOutcome(
  user: SessionUser,
  preferredHouseholdId?: string
) {
  const existingMembership = await findMembership(user.id, preferredHouseholdId);
  if (existingMembership) {
    return { membership: existingMembership, created: false as const };
  }
  return createInitialHousehold(user);
}

export async function ensureUserHouseholdMembership(user: SessionUser, preferredHouseholdId?: string) {
  return (await ensureUserHouseholdMembershipWithOutcome(user, preferredHouseholdId)).membership;
}

/**
 * 現在ユーザーのHousehold文脈を返し、所属がなければ初期Householdを原子的に作成する。
 *
 * 選択cookieは実在する所属に一致する場合だけ採用し、未設定時は共有Householdを優先する。
 */
export async function getRequiredHouseholdContext(): Promise<CurrentHouseholdContext> {
  const sessionUser = await getRequiredSessionUser();
  const membership = await ensureUserHouseholdMembership(sessionUser, await getPreferredHouseholdId());

  return {
    user: sessionUser,
    household: {
      id: membership.household.id,
      name: membership.household.name,
      careDayStartMinutes: membership.household.careDayStartMinutes
    },
    membership: {
      id: membership.id,
      role: membership.role,
      createdAt: membership.createdAt
    }
  };
}

/**
 * 共有データを変更するServer Action向けに、編集可能なHousehold文脈を返す。
 *
 * VIEWERは指定画面へredirectする。ただし権限は待機中に変わり得るため、重要な更新では
 * transaction内でもmembershipを再確認する必要がある。
 */
export async function getRequiredHouseholdMutationContext(pathname: string): Promise<CurrentHouseholdContext> {
  const context = await getRequiredHouseholdContext();
  if (!canEditHouseholdSharedData(context.membership.role)) {
    const separator = pathname.includes("?") ? "&" : "?";
    redirect(`${pathname}${separator}status=viewerForbidden`);
  }
  return context;
}

/**
 * Route Handler向けに、redirectや初期Household作成をせず現在の所属を取得する。
 *
 * 未認証・停止中・所属なしは`null`で返し、呼び出し側が401/404を選択できるようにする。
 */
export async function getHouseholdContextForRoute(): Promise<CurrentHouseholdContext | null> {
  const session = await auth();
  const user = session?.user;

  if (!hasAuthenticatedUserId(user) || user.accessStatus === "SUSPENDED") {
    return null;
  }

  const sessionUser: SessionUser = {
    id: user.id,
    appRole: user.appRole ?? "USER",
    accessStatus: user.accessStatus ?? "ACTIVE",
    name: user.name,
    email: user.email,
    image: user.image
  };
  const membership = await findMembership(sessionUser.id, await getPreferredHouseholdId());

  if (!membership) {
    return null;
  }

  return {
    user: sessionUser,
    household: {
      id: membership.household.id,
      name: membership.household.name,
      careDayStartMinutes: membership.household.careDayStartMinutes
    },
    membership: { id: membership.id, role: membership.role, createdAt: membership.createdAt }
  };
}

export async function getCurrentHouseholdSwitcherData() {
  const context = await getRequiredHouseholdContext();
  const memberships = await prisma.householdMember.findMany({
    where: { userId: context.user.id, household: { isDemo: false } },
    include: {
      household: {
        include: {
          _count: {
            select: {
              hamsters: true,
              members: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  return {
    context,
    households: memberships.map(
      (membership): HouseholdOption => ({
        id: membership.householdId,
        name: membership.household.name,
        role: membership.role,
        memberCount: membership.household._count.members,
        hamsterCount: membership.household._count.hamsters
      })
    )
  };
}

export async function setCurrentHouseholdCookie(householdId: string) {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
}

export async function clearDeletedAccountCookies() {
  const cookieStore = await cookies();
  const sessionCookieNames = new Set<string>(DOG_CAT_AUTH_SESSION_COOKIE_NAMES);

  cookieStore.delete(CURRENT_HOUSEHOLD_COOKIE);
  // DB SessionはUserのCascadeで消える。ブラウザー側も通常・Secure双方と分割cookieを破棄する。
  for (const cookie of cookieStore.getAll()) {
    if (
      sessionCookieNames.has(cookie.name) ||
      DOG_CAT_AUTH_SESSION_COOKIE_NAMES.some((name) => cookie.name.startsWith(`${name}.`))
    ) {
      cookieStore.delete(cookie.name);
    }
  }
}

export function hasHouseholdRole(role: HouseholdRole, allowedRoles: HouseholdRole[]) {
  return allowedRoles.includes(role);
}

export function hasAppRole(role: AppRole, allowedRoles: AppRole[]) {
  return allowedRoles.includes(role);
}

/**
 * 指定したアプリ管理者権限を、最新のDB状態で再確認して返す。
 *
 * 権限不足・停止中・削除済みの場合はトップへredirectする。
 */
export async function getRequiredAppAdminUser(allowedRoles: AppRole[] = ["ADMIN", "SUPER_ADMIN"]) {
  const sessionUser = await getRequiredSessionUser();
  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      appRole: true,
      accessStatus: true
    }
  });

  if (!user || user.accessStatus !== "ACTIVE" || !hasAppRole(user.appRole, allowedRoles)) {
    redirect("/");
  }

  return user;
}
