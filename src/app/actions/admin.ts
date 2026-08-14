"use server";

import { redirect } from "next/navigation";
import type { AppRole } from "@prisma/client";

import { appRoleUpdateDenial } from "@/lib/authorization";
import { getRequiredAppAdminUser } from "@/lib/auth-context";
import { buildAdminRoleStatusHref, normalizeAdminRoleReturnPath } from "@/lib/admin-users";
import { prisma } from "@/lib/prisma";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { handleServerActionError } from "@/lib/server-errors";
import {
  restoreUserAccess as restoreUserAccessMutation,
  suspendUserAccess as suspendUserAccessMutation,
  type UserAccessMutationResult
} from "@/lib/user-access";

const APP_ROLES: AppRole[] = ["USER", "ADMIN", "SUPER_ADMIN"];

function parseAppRole(value: FormDataEntryValue | null): AppRole | null {
  if (typeof value !== "string") {
    return null;
  }

  return APP_ROLES.includes(value as AppRole) ? (value as AppRole) : null;
}

export async function updateUserAppRole(formData: FormData) {
  const returnPath = normalizeAdminRoleReturnPath(formData.get("returnTo"));

  try {
    const currentUser = await getRequiredAppAdminUser(["SUPER_ADMIN"]);
    const targetUserId = formData.get("userId");
    const appRole = parseAppRole(formData.get("appRole"));
    if (typeof targetUserId !== "string" || !targetUserId || !appRole) {
      redirect(buildAdminRoleStatusHref(returnPath, "adminTargetInvalid"));
    }

    await prisma.$transaction(async (tx) => {
      // 最後のSUPER_ADMIN判定を同時更新同士で競合させないため、アプリ全体で直列化する。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('dog-cat-manager-super-admin', 0))`;
      const actor = await tx.user.findUnique({
        where: { id: currentUser.id },
        select: { id: true, appRole: true, accessStatus: true }
      });
      if (!actor || actor.appRole !== "SUPER_ADMIN" || actor.accessStatus !== "ACTIVE") {
        redirect("/?status=forbidden");
      }
      const targetUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, appRole: true, accessStatus: true }
      });
      if (!targetUser) redirect(buildAdminRoleStatusHref(returnPath, "adminTargetInvalid"));
      let superAdminCount = Number.MAX_SAFE_INTEGER;
      if (targetUser.appRole === "SUPER_ADMIN" && appRole !== "SUPER_ADMIN") {
        superAdminCount = await tx.user.count({
          where: { appRole: "SUPER_ADMIN", accessStatus: "ACTIVE" }
        });
      }
      const denial = appRoleUpdateDenial({
        actorRole: actor.appRole,
        actorUserId: actor.id,
        targetUserId: targetUser.id,
        currentRole: targetUser.appRole,
        newRole: appRole,
        superAdminCount,
        targetAccessStatus: targetUser.accessStatus
      });
      if (denial === "forbidden") redirect("/");
      if (denial) redirect(buildAdminRoleStatusHref(returnPath, denial));
      await tx.user.update({ where: { id: targetUser.id }, data: { appRole } });
    });

    revalidatePathsSafely(
      [{ path: "/admin" }, { path: "/admin/users" }, { path: "/", type: "layout" }],
      "admin.updateRole.revalidate",
      { targetUserId }
    );
    redirect(buildAdminRoleStatusHref(returnPath, "roleUpdated"));
  } catch (error) {
    handleServerActionError(error, { operation: "admin.updateRole", pathname: returnPath });
  }
}

const USER_ACCESS_STATUS: Record<UserAccessMutationResult, string> = {
  suspended: "userSuspended",
  restored: "userRestored",
  forbidden: "forbidden",
  notFound: "userAccessTargetNotFound",
  cannotSuspendSelf: "cannotSuspendSelf",
  lastSuperAdmin: "cannotSuspendLastSuperAdmin",
  alreadySuspended: "userAlreadySuspended",
  alreadyActive: "userAlreadyActive",
  stateChanged: "userAccessStateChanged",
  invalidReason: "suspensionReasonInvalid",
  invalidNote: "userRestoreNoteInvalid"
};

function redirectUserAccessResult(returnPath: ReturnType<typeof normalizeAdminRoleReturnPath>, result: UserAccessMutationResult): never {
  if (result === "forbidden") redirect("/?status=forbidden");
  redirect(buildAdminRoleStatusHref(returnPath, USER_ACCESS_STATUS[result]));
}

export async function suspendUserAccess(formData: FormData) {
  const returnPath = normalizeAdminRoleReturnPath(formData.get("returnTo"));

  try {
    const currentUser = await getRequiredAppAdminUser(["SUPER_ADMIN"]);
    const targetUserId = formData.get("userId");
    if (typeof targetUserId !== "string" || !targetUserId) {
      redirect(buildAdminRoleStatusHref(returnPath, "userAccessTargetNotFound"));
    }

    const result = await suspendUserAccessMutation({
      actorUserId: currentUser.id,
      targetUserId,
      reason: formData.get("reason")
    });
    if (result !== "suspended") redirectUserAccessResult(returnPath, result);

    revalidatePathsSafely(
      [{ path: "/admin" }, { path: "/admin/users" }, { path: "/", type: "layout" }],
      "admin.suspendUser.revalidate",
      { targetUserId }
    );
    redirect(buildAdminRoleStatusHref(returnPath, USER_ACCESS_STATUS[result]));
  } catch (error) {
    handleServerActionError(error, { operation: "admin.suspendUser", pathname: returnPath });
  }
}

export async function restoreUserAccess(formData: FormData) {
  const returnPath = normalizeAdminRoleReturnPath(formData.get("returnTo"));

  try {
    const currentUser = await getRequiredAppAdminUser(["SUPER_ADMIN"]);
    const targetUserId = formData.get("userId");
    if (typeof targetUserId !== "string" || !targetUserId) {
      redirect(buildAdminRoleStatusHref(returnPath, "userAccessTargetNotFound"));
    }

    const result = await restoreUserAccessMutation({
      actorUserId: currentUser.id,
      targetUserId,
      note: formData.get("note")
    });
    if (result !== "restored") redirectUserAccessResult(returnPath, result);

    revalidatePathsSafely(
      [{ path: "/admin" }, { path: "/admin/users" }, { path: "/", type: "layout" }],
      "admin.restoreUser.revalidate",
      { targetUserId }
    );
    redirect(buildAdminRoleStatusHref(returnPath, USER_ACCESS_STATUS[result]));
  } catch (error) {
    handleServerActionError(error, { operation: "admin.restoreUser", pathname: returnPath });
  }
}
