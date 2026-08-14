"use server";

import { redirect } from "next/navigation";

import { HOUSEHOLD_AUDIT_EVENTS, writeHouseholdAuditLog } from "@/lib/audit-log";
import { activityActorName, createHouseholdActivity } from "@/lib/household-activity";
import {
  canManageHouseholdInvitations,
  canManageHouseholdMemberRoles,
  canRemoveHouseholdMembers,
  canUpdateHouseholdName,
  memberRemovalDenial,
  memberRoleUpdateDenial
} from "@/lib/authorization";
import {
  ensureUserHouseholdMembership,
  ensureUserHouseholdMembershipWithOutcome,
  getRequiredHouseholdContext,
  getRequiredSessionUser,
  setCurrentHouseholdCookie
} from "@/lib/auth-context";
import {
  buildHouseholdInvitationPreview,
  createInvitationToken,
  hashInvitationToken,
  invitationAcceptanceFailure,
  INVITATION_CREATION_COOLDOWN_MS,
  invitationExpiresAt,
  isValidInvitationToken,
  MAX_ACTIVE_HOUSEHOLD_INVITATIONS,
  type HouseholdInvitationPreview
} from "@/lib/invitations";
import {
  createRateLimitedHouseholdInvitation,
  revokeHouseholdInvitationMutation
} from "@/lib/invitation-mutations";
import { DEFAULT_DASHBOARD_BOARD_COUNT } from "@/lib/dashboard-settings";
import { prisma } from "@/lib/prisma";
import { leaveHouseholdMembership } from "@/lib/household-leave";
import { deleteSoleOwnerHousehold } from "@/lib/household-delete";
import { deleteHouseholdImageDirectoriesSafely } from "@/lib/household-delete-images";
import { updateHouseholdNameMutation } from "@/lib/household-name";
import {
  commitHouseholdMutation,
  getRealtimeActorId,
  publishHouseholdChangeSafely,
  updateHouseholdRevision
} from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { updateHouseholdNameSchema } from "@/lib/schemas";
import { handleServerActionError, logUnexpectedError } from "@/lib/server-errors";

type InvitationUnavailableStatus = "accepted" | "expired" | "revoked" | "invalid";

class InvitationUnavailableError extends Error {
  constructor(readonly status: InvitationUnavailableStatus) {
    super(`Invitation is unavailable: ${status}`);
  }
}

export type CreateHouseholdInvitationState = {
  inviteToken: string | null;
  errorCode: "cooldown" | "hourlyLimit" | "activeLimit" | null;
  errorMessage: string | null;
  retryAfterSeconds: number | null;
};

function redirectInvitationFailure(status: InvitationUnavailableStatus): never {
  if (status === "accepted") redirect("/invitations/accept?status=invitationUsed");
  if (status === "expired") redirect("/invitations/accept?status=invitationExpired");
  if (status === "revoked") redirect("/invitations/accept?status=invitationRevokedAccess");
  redirect("/invitations/accept?status=invalid");
}

function parseManageableMemberRole(value: FormDataEntryValue | null) {
  return value === "ADMIN" || value === "MEMBER" || value === "VIEWER" ? value : null;
}

function hasLeaveAcknowledgements(formData: FormData) {
  return ["acknowledgeAccessLoss", "acknowledgeDataRetention", "acknowledgeNewInvitation"].every(
    (field) => formData.get(field) === "confirmed"
  );
}

function hasHouseholdDeleteAcknowledgements(formData: FormData) {
  return [
    "acknowledgeHouseholdDataDeletion",
    "acknowledgeImageDeletion",
    "acknowledgeIrreversibleDeletion"
  ].every((field) => formData.get(field) === "confirmed");
}

export async function getHouseholdInvitationPreview(token: string): Promise<HouseholdInvitationPreview> {
  if (!isValidInvitationToken(token)) {
    return { status: "invalid" };
  }

  try {
    const invitation = await prisma.householdInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      select: {
        acceptedAt: true,
        revokedAt: true,
        expiresAt: true,
        household: {
          select: { name: true }
        }
      }
    });
    return buildHouseholdInvitationPreview(invitation);
  } catch (error) {
    logUnexpectedError(error, { operation: "members.getInvitationPreview" });
    return { status: "error" };
  }
}

export async function updateCurrentHouseholdName(formData: FormData) {
  try {
    const context = await getRequiredHouseholdContext();
    if (!canUpdateHouseholdName(context.membership.role)) {
      redirect("/settings/members?status=forbidden");
    }

    const expectedName = formData.get("currentName");
    if (typeof expectedName !== "string") {
      redirect("/settings/members?status=householdStateChanged");
    }
    const nameResult = updateHouseholdNameSchema.safeParse({ name: formData.get("name") });
    if (!nameResult.success) {
      const isNameTooLong = nameResult.error.issues.some(
        (issue) => issue.path[0] === "name" && issue.code === "too_big"
      );
      redirect(
        isNameTooLong
          ? "/settings/members?status=householdNameTooLong"
          : "/settings/members?status=invalid"
      );
    }

    const result = await updateHouseholdNameMutation({
      householdId: context.household.id,
      actorUserId: context.user.id,
      actorClientId: getRealtimeActorId(formData),
      expectedName,
      nextName: nameResult.data.name,
      actorNameSnapshot: activityActorName(context.user)
    });
    if (result.status === "forbidden") redirect("/settings/members?status=forbidden");
    if (result.status === "stateChanged") redirect("/settings/members?status=householdStateChanged");
    if (result.status === "unchanged") redirect("/settings/members?status=householdNameUnchanged");

    writeHouseholdAuditLog(HOUSEHOLD_AUDIT_EVENTS.householdNameUpdated, {
      actorUserId: context.user.id,
      actorHouseholdRole: result.actorHouseholdRole,
      householdId: context.household.id,
      result: "success"
    });
    publishHouseholdChangeSafely(result.change);
    revalidatePathsSafely(
      [
        { path: "/", type: "layout" },
        { path: "/settings/members" },
        { path: "/settings/members/leave" },
        { path: "/settings/members/activity" },
        { path: "/admin" }
      ],
      "members.updateHouseholdName.revalidate",
      { householdId: context.household.id }
    );
    redirect("/settings/members?status=householdNameUpdated");
  } catch (error) {
    handleServerActionError(error, {
      operation: "members.updateHouseholdName",
      pathname: "/settings/members"
    });
  }
}

export async function createHouseholdInvitation(
  _previousState: CreateHouseholdInvitationState,
  formData: FormData
): Promise<CreateHouseholdInvitationState> {
  try {
    const context = await getRequiredHouseholdContext();
    if (!canManageHouseholdInvitations(context.membership.role)) {
      redirect("/settings/members?status=forbidden");
    }

    const now = new Date();
    // 平文tokenは作成直後の応答だけに残し、DBには漏えい時に再利用できないhashだけを保存する。
    const token = createInvitationToken();
    const result = await createRateLimitedHouseholdInvitation({
      householdId: context.household.id,
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      tokenHash: hashInvitationToken(token),
      now,
      expiresAt: invitationExpiresAt(now),
      actorNameSnapshot: activityActorName(context.user)
    });
    if (result.status === "forbidden") redirect("/settings/members?status=forbidden");
    if (result.status === "activeLimit") {
      return {
        inviteToken: null,
        errorCode: "activeLimit",
        errorMessage: `有効な招待リンクが上限の${MAX_ACTIVE_HOUSEHOLD_INVITATIONS}件に達しています。不要なリンクを無効化してから再度作成してください。`,
        retryAfterSeconds: null
      };
    }
    if (result.status === "limited") {
      return {
        inviteToken: null,
        errorCode: result.code,
        errorMessage:
          result.code === "cooldown"
            ? "招待リンクを作成したばかりです。しばらくしてから再度お試しください。"
            : "短時間に作成できる招待リンクの上限に達しました。時間を空けて再度お試しください。",
        retryAfterSeconds: Math.max(1, Math.ceil((result.retryAt.getTime() - now.getTime()) / 1000))
      };
    }
    writeHouseholdAuditLog(HOUSEHOLD_AUDIT_EVENTS.invitationCreated, {
      actorUserId: context.user.id,
      actorHouseholdRole: context.membership.role,
      householdId: context.household.id,
      invitationId: result.invitation.id,
      expiresAt: result.invitation.expiresAt.toISOString()
    });
    publishHouseholdChangeSafely(result.change);
    revalidatePathsSafely([{ path: "/settings/members" }, { path: "/settings/members/activity" }], "members.createInvitation.revalidate", {
      householdId: context.household.id
    });
    return {
      inviteToken: token,
      errorCode: null,
      errorMessage: null,
      retryAfterSeconds: Math.ceil(INVITATION_CREATION_COOLDOWN_MS / 1000)
    };
  } catch (error) {
    handleServerActionError(error, { operation: "members.createInvitation", pathname: "/settings/members" });
  }
}

export async function revokeHouseholdInvitation(formData: FormData) {
  try {
    const invitationId = formData.get("invitationId");
    if (typeof invitationId !== "string" || !invitationId) redirect("/settings/members?status=invalid");

    const context = await getRequiredHouseholdContext();
    if (!canManageHouseholdInvitations(context.membership.role)) {
      redirect("/settings/members?status=forbidden");
    }

    const result = await revokeHouseholdInvitationMutation({
      householdId: context.household.id,
      actorUserId: context.user.id,
      actorClientId: getRealtimeActorId(formData),
      invitationId,
      now: new Date(),
      actorNameSnapshot: activityActorName(context.user)
    });
    if (result.status !== "revoked") {
      if (result.status === "forbidden") redirect("/settings/members?status=forbidden");
      if (result.status === "notFound") redirect("/settings/members?status=invalid");
      if (result.status === "accepted") redirect("/settings/members?status=invitationUsed");
      if (result.status === "expired") redirect("/settings/members?status=invitationExpired");
      redirect("/settings/members?status=invitationAlreadyRevoked");
    }

    writeHouseholdAuditLog(HOUSEHOLD_AUDIT_EVENTS.invitationRevoked, {
      actorUserId: context.user.id,
      actorHouseholdRole: context.membership.role,
      householdId: context.household.id,
      invitationId: result.invitationId
    });
    publishHouseholdChangeSafely(result.change);
    revalidatePathsSafely([{ path: "/settings/members" }, { path: "/settings/members/activity" }], "members.revokeInvitation.revalidate", {
      householdId: context.household.id
    });
    redirect("/settings/members?status=invitationRevoked");
  } catch (error) {
    handleServerActionError(error, { operation: "members.revokeInvitation", pathname: "/settings/members" });
  }
}

/**
 * fragmentから受け渡された招待tokenを消費し、Household参加を原子的に確定するServer Action。
 *
 * アカウント削除・Household削除と共通のlock内で招待の有効性を再確認し、membership、
 * 個人設定、操作履歴、revisionを更新する。現在Household cookieはcommit後の補助処理である。
 */
export async function acceptHouseholdInvitation(formData: FormData) {
  try {
    const token = formData.get("token");
    if (typeof token !== "string" || !isValidInvitationToken(token)) redirect("/invitations/accept?status=invalid");

    const user = await getRequiredSessionUser();
    const now = new Date();
    const invitation = await prisma.householdInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      select: { id: true, householdId: true, expiresAt: true, acceptedAt: true, revokedAt: true }
    });
    if (!invitation) redirect("/invitations/accept?status=invalid");
    const initialFailure = invitationAcceptanceFailure(invitation, now);
    if (initialFailure) redirectInvitationFailure(initialFailure);

    const change = await prisma.$transaction(async (tx) => {
      // アカウント削除と新規membership作成を直列化してから、Household削除とも直列化する。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${invitation.householdId}, 0))`;
      const updateResult = await tx.householdInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now }
        },
        data: { acceptedAt: now }
      });

      if (updateResult.count !== 1) {
        const current = await tx.householdInvitation.findUnique({
          where: { id: invitation.id },
          select: { acceptedAt: true, revokedAt: true, expiresAt: true }
        });
        throw new InvitationUnavailableError(
          current ? (invitationAcceptanceFailure(current, now) ?? "invalid") : "invalid"
        );
      }

      // 招待URLは共有され得るため、参加先HouseholdへのmembershipをDB側で一意に確定する。
      const existingMembership = await tx.householdMember.findUnique({
        where: { householdId_userId: { householdId: invitation.householdId, userId: user.id } },
        select: { id: true }
      });
      await tx.householdMember.upsert({
        where: {
          householdId_userId: {
            householdId: invitation.householdId,
            userId: user.id
          }
        },
        update: {},
        create: {
          householdId: invitation.householdId,
          userId: user.id,
          role: "MEMBER"
        }
      });

      await tx.appSetting.upsert({
        where: {
          userId_householdId: {
            userId: user.id,
            householdId: invitation.householdId
          }
        },
        update: {},
        create: {
          userId: user.id,
          householdId: invitation.householdId,
          dashboardBoardCount: DEFAULT_DASHBOARD_BOARD_COUNT
        }
      });
      if (!existingMembership) {
        await createHouseholdActivity(tx, {
          householdId: invitation.householdId,
          actorUserId: user.id,
          actorNameSnapshot: activityActorName(user),
          eventType: "MEMBER_JOINED",
          category: "MEMBER",
          targetType: "USER",
          targetId: user.id,
          targetNameSnapshot: activityActorName(user)
        });
      }
      return updateHouseholdRevision(
        tx,
        invitation.householdId,
        "member",
        getRealtimeActorId(formData),
        user.id
      );
    });

    publishHouseholdChangeSafely(change);
    try {
      // membershipはすでに確定済みなので、Cookie更新失敗だけで参加結果を失敗扱いにはしない。
      await setCurrentHouseholdCookie(invitation.householdId);
    } catch (cookieError) {
      logUnexpectedError(cookieError, {
        operation: "members.acceptInvitation.setCookie",
        context: { householdId: invitation.householdId, userId: user.id }
      });
    }
    revalidatePathsSafely([{ path: "/" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "members.acceptInvitation.revalidate", {
      householdId: invitation.householdId,
      userId: user.id
    });
    redirect("/settings/members?status=joined");
  } catch (error) {
    if (error instanceof InvitationUnavailableError) redirectInvitationFailure(error.status);
    handleServerActionError(error, { operation: "members.acceptInvitation", pathname: "/invitations/accept" });
  }
}

export async function removeHouseholdMember(formData: FormData) {
  try {
    const memberId = formData.get("memberId");
    if (typeof memberId !== "string" || !memberId) redirect("/settings/members?status=invalid");
    const context = await getRequiredHouseholdContext();
    if (!canRemoveHouseholdMembers(context.membership.role)) {
      redirect("/settings/members?status=forbidden");
    }

    const { change, result: removedMember } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "member",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      mutate: async (tx) => {
        // OWNER数の確認から削除までを直列化し、同時操作でOWNER不在になることを防ぐ。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.household.id}, 0))`;
        const targetMember = await tx.householdMember.findFirst({
          where: { id: memberId, householdId: context.household.id },
          select: { id: true, userId: true, role: true, user: { select: { name: true } } }
        });
        if (!targetMember) redirect("/settings/members?status=invalid");
        let ownerCount = Number.MAX_SAFE_INTEGER;
        if (targetMember.role === "OWNER") {
          ownerCount = await tx.householdMember.count({
            where: { householdId: context.household.id, role: "OWNER" }
          });
        }
        const denial = memberRemovalDenial({
          actorRole: context.membership.role,
          actorUserId: context.user.id,
          targetUserId: targetMember.userId,
          targetRole: targetMember.role,
          ownerCount
        });
        if (denial) redirect(`/settings/members?status=${denial}`);
        const deleted = await tx.householdMember.deleteMany({
          where: { id: targetMember.id, householdId: context.household.id }
        });
        if (deleted.count !== 1) redirect("/settings/members?status=invalid");
        return targetMember;
      },
      actorNameSnapshot: activityActorName(context.user),
      activity: (member) => ({
        eventType: "MEMBER_REMOVED",
        category: "MEMBER",
        targetType: "USER",
        targetId: member.userId,
        targetNameSnapshot: activityActorName(member.user)
      })
    });

    writeHouseholdAuditLog(HOUSEHOLD_AUDIT_EVENTS.memberRemoved, {
      actorUserId: context.user.id,
      actorHouseholdRole: context.membership.role,
      householdId: context.household.id,
      targetMemberId: removedMember.id,
      targetUserId: removedMember.userId,
      removedRole: removedMember.role
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/", type: "layout" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "members.remove.revalidate",
      { householdId: context.household.id, memberId }
    );
    redirect("/settings/members?status=memberRemoved");
  } catch (error) {
    handleServerActionError(error, { operation: "members.remove", pathname: "/settings/members" });
  }
}

export async function updateHouseholdMemberRole(formData: FormData) {
  try {
    const memberId = formData.get("memberId");
    const role = parseManageableMemberRole(formData.get("role"));
    if (typeof memberId !== "string" || !memberId || !role) redirect("/settings/members?status=invalid");
    const context = await getRequiredHouseholdContext();
    if (!canManageHouseholdMemberRoles(context.membership.role)) {
      redirect("/settings/members?status=forbidden");
    }

    const { change, result: updatedMember } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "member",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      mutate: async (tx) => {
        const targetMember = await tx.householdMember.findFirst({
          where: { id: memberId, householdId: context.household.id },
          select: { id: true, userId: true, role: true, user: { select: { name: true } } }
        });
        if (!targetMember) redirect("/settings/members?status=invalid");
        const denial = memberRoleUpdateDenial({
          actorRole: context.membership.role,
          actorUserId: context.user.id,
          targetUserId: targetMember.userId,
          currentRole: targetMember.role,
          newRole: role
        });
        if (denial) redirect(`/settings/members?status=${denial}`);
        const updated = await tx.householdMember.updateMany({
          where: { id: targetMember.id, householdId: context.household.id, role: targetMember.role },
          data: { role }
        });
        if (updated.count !== 1) redirect("/settings/members?status=invalid");
        return { ...targetMember, newRole: role };
      },
      actorNameSnapshot: activityActorName(context.user),
      activity: (member) => ({
        eventType: "MEMBER_ROLE_UPDATED",
        category: "MEMBER",
        targetType: "USER",
        targetId: member.userId,
        targetNameSnapshot: activityActorName(member.user),
        details: { previousRole: member.role, newRole: member.newRole }
      })
    });

    writeHouseholdAuditLog(HOUSEHOLD_AUDIT_EVENTS.memberRoleUpdated, {
      actorUserId: context.user.id,
      actorHouseholdRole: context.membership.role,
      householdId: context.household.id,
      targetMemberId: updatedMember.id,
      targetUserId: updatedMember.userId,
      previousRole: updatedMember.role,
      newRole: updatedMember.newRole
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [{ path: "/", type: "layout" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
      "members.updateRole.revalidate",
      { householdId: context.household.id, memberId }
    );
    redirect("/settings/members?status=roleUpdated");
  } catch (error) {
    handleServerActionError(error, { operation: "members.updateRole", pathname: "/settings/members" });
  }
}

export async function leaveCurrentHousehold(formData: FormData) {
  try {
    const householdId = formData.get("householdId");
    if (typeof householdId !== "string" || !householdId || !hasLeaveAcknowledgements(formData)) {
      redirect("/settings/members/leave?status=invalid");
    }

    const context = await getRequiredHouseholdContext();
    if (context.household.id !== householdId) {
      redirect("/settings/members?status=householdLeaveStateChanged");
    }
    const transferValue = formData.get("transferToUserId");
    const transferToUserId = typeof transferValue === "string" && transferValue ? transferValue : null;
    const result = await leaveHouseholdMembership({
      householdId,
      actorUserId: context.user.id,
      actorClientId: getRealtimeActorId(formData),
      transferToUserId,
      actorNameSnapshot: activityActorName(context.user)
    });

    if (result.status === "notMember") {
      redirect("/settings/members?status=householdAlreadyLeft");
    }
    if (result.status === "soleMember") {
      redirect("/settings/members/leave?status=cannotLeaveSoleMember");
    }
    if (result.status === "transferRequired") {
      redirect("/settings/members/leave?status=ownershipTransferRequired");
    }
    if (result.status === "invalidTransferTarget") {
      redirect("/settings/members/leave?status=invalidTransferTarget");
    }
    if (result.status === "transferTargetUnavailable") {
      redirect("/settings/members/leave?status=transferTargetUnavailable");
    }
    if (result.status === "stateChanged") {
      redirect("/settings/members/leave?status=householdLeaveStateChanged");
    }

    if (result.status === "transferredAndLeft") {
      writeHouseholdAuditLog(HOUSEHOLD_AUDIT_EVENTS.ownershipTransferredAndMemberLeft, {
        actorUserId: context.user.id,
        actorHouseholdRole: result.previousRole,
        householdId,
        previousRole: result.previousRole,
        transferTargetUserId: result.transferTargetUserId,
        transferTargetPreviousRole: result.transferTargetPreviousRole,
        result: "success"
      });
    } else {
      writeHouseholdAuditLog(HOUSEHOLD_AUDIT_EVENTS.memberLeft, {
        actorUserId: context.user.id,
        actorHouseholdRole: result.previousRole,
        householdId,
        previousRole: result.previousRole,
        result: "success"
      });
    }

    publishHouseholdChangeSafely(result.change);
    const nextMembership = await ensureUserHouseholdMembership(context.user);
    await setCurrentHouseholdCookie(nextMembership.householdId);
    revalidatePathsSafely(
      [{ path: "/", type: "layout" }, { path: "/settings/members" }, { path: "/settings/members/leave" }, { path: "/settings/members/activity" }],
      "members.leave.revalidate",
      { householdId, userId: context.user.id }
    );
    redirect(
      result.status === "transferredAndLeft"
        ? "/?status=ownershipTransferredAndLeft"
        : "/?status=householdLeft"
    );
  } catch (error) {
    handleServerActionError(error, { operation: "members.leave", pathname: "/settings/members/leave" });
  }
}

export async function deleteCurrentHousehold(formData: FormData) {
  try {
    const householdId = formData.get("householdId");
    const confirmationName = formData.get("confirmationName");
    if (
      typeof householdId !== "string" ||
      !householdId ||
      typeof confirmationName !== "string" ||
      !hasHouseholdDeleteAcknowledgements(formData)
    ) {
      redirect("/settings/members/delete?status=invalid");
    }

    const context = await getRequiredHouseholdContext();
    if (context.household.id !== householdId) {
      redirect("/settings/members?status=householdDeleteStateChanged");
    }

    const result = await deleteSoleOwnerHousehold({
      householdId,
      actorUserId: context.user.id,
      confirmationName
    });
    if (result.status === "notFound" || result.status === "notMember") {
      redirect("/settings/members?status=householdDeleteStateChanged");
    }
    if (result.status === "forbidden") {
      redirect("/settings/members/delete?status=forbidden");
    }
    if (result.status === "roleStateInvalid") {
      redirect("/settings/members/delete?status=householdRoleStateInvalid");
    }
    if (result.status === "nameMismatch") {
      redirect("/settings/members/delete?status=householdDeleteNameMismatch");
    }
    if (result.status === "stateChanged") {
      redirect("/settings/members/leave?status=householdDeleteStateChanged");
    }

    await deleteHouseholdImageDirectoriesSafely(householdId);
    const nextHousehold = await ensureUserHouseholdMembershipWithOutcome(context.user);
    await setCurrentHouseholdCookie(nextHousehold.membership.householdId);

    writeHouseholdAuditLog(HOUSEHOLD_AUDIT_EVENTS.householdDeleted, {
      actorUserId: context.user.id,
      actorHouseholdRole: result.actorHouseholdRole,
      householdId,
      result: "success",
      switchedToExistingHousehold: String(!nextHousehold.created),
      createdInitialHousehold: String(nextHousehold.created)
    });
    revalidatePathsSafely(
      [
        { path: "/", type: "layout" },
        { path: "/" },
        { path: "/settings/members" },
        { path: "/settings/members/leave" },
        { path: "/settings/members/delete" }
      ],
      "members.deleteHousehold.revalidate",
      { householdId, userId: context.user.id }
    );
    redirect(
      nextHousehold.created
        ? "/?status=householdDeletedAndCreated"
        : "/?status=householdDeletedAndSwitched"
    );
  } catch (error) {
    handleServerActionError(error, {
      operation: "members.deleteHousehold",
      pathname: "/settings/members/delete"
    });
  }
}
