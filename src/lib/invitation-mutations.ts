import type { HouseholdActivityEvent, HouseholdRole } from "@prisma/client";

import { canManageHouseholdInvitations } from "@/lib/authorization";
import { ACTOR_NAME_FALLBACK, createHouseholdActivity } from "@/lib/household-activity";
import {
  evaluateInvitationCreationLimit,
  invitationAcceptanceFailure,
  INVITATION_CREATION_WINDOW_LIMIT,
  INVITATION_CREATION_WINDOW_MS,
  MAX_ACTIVE_HOUSEHOLD_INVITATIONS,
  type InvitationCreationLimitCode
} from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import {
  updateHouseholdRevision,
  type CommittedHouseholdChange
} from "@/lib/realtime";

type InvitationLifecycle = {
  id: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

export type InvitationMutationRepository = {
  findMembershipRole(householdId: string, userId: string): Promise<HouseholdRole | null>;
  lockInvitationCreationByUser(userId: string): Promise<void>;
  lockInvitationCreationByHousehold(householdId: string): Promise<void>;
  countActiveInvitationsInHousehold(householdId: string, now: Date): Promise<number>;
  findLatestInvitationCreatedByUser(userId: string): Promise<Date | null>;
  countInvitationsCreatedByUserSince(userId: string, since: Date): Promise<number>;
  findOldestInvitationCreatedByUserSince(userId: string, since: Date): Promise<Date | null>;
  createInvitation(input: {
    householdId: string;
    createdByUserId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<{ id: string; expiresAt: Date }>;
  findInvitation(householdId: string, invitationId: string): Promise<InvitationLifecycle | null>;
  revokeInvitation(householdId: string, invitationId: string, now: Date): Promise<number>;
  commitChange(input: {
    householdId: string;
    actorClientId: string | null;
    actorUserId: string;
    actorNameSnapshot: string;
    eventType: HouseholdActivityEvent;
    targetId: string;
  }): Promise<CommittedHouseholdChange>;
};

export type InvitationMutationExecutor = <T>(
  operation: (repository: InvitationMutationRepository) => Promise<T>
) => Promise<T>;

const executePrismaInvitationMutation: InvitationMutationExecutor = (operation) =>
  prisma.$transaction(async (tx) =>
    operation({
      findMembershipRole: async (householdId, userId) => {
        const membership = await tx.householdMember.findUnique({
          where: { householdId_userId: { householdId, userId } },
          select: { role: true }
        });
        return membership?.role ?? null;
      },
      lockInvitationCreationByUser: async (userId) => {
        // 制限はHouseholdをまたぐユーザー単位。transaction終了まで同一ユーザーの作成を直列化する。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 731491))`;
      },
      lockInvitationCreationByHousehold: async (householdId) => {
        // 有効リンク上限はHousehold単位。異なる管理者からの同時作成も直列化する。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${householdId}, 731492))`;
      },
      countActiveInvitationsInHousehold: (householdId, now) =>
        tx.householdInvitation.count({
          where: {
            householdId,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now }
          }
        }),
      findLatestInvitationCreatedByUser: async (userId) => {
        const invitation = await tx.householdInvitation.findFirst({
          where: { createdByUserId: userId },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true }
        });
        return invitation?.createdAt ?? null;
      },
      countInvitationsCreatedByUserSince: (userId, since) =>
        tx.householdInvitation.count({
          where: { createdByUserId: userId, createdAt: { gte: since } }
        }),
      findOldestInvitationCreatedByUserSince: async (userId, since) => {
        const invitation = await tx.householdInvitation.findFirst({
          where: { createdByUserId: userId, createdAt: { gte: since } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true }
        });
        return invitation?.createdAt ?? null;
      },
      createInvitation: (input) =>
        tx.householdInvitation.create({
          data: input,
          select: { id: true, expiresAt: true }
        }),
      findInvitation: (householdId, invitationId) =>
        tx.householdInvitation.findFirst({
          where: { id: invitationId, householdId },
          select: { id: true, acceptedAt: true, revokedAt: true, expiresAt: true }
        }),
      revokeInvitation: async (householdId, invitationId, now) => {
        const result = await tx.householdInvitation.updateMany({
          where: {
            id: invitationId,
            householdId,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now }
          },
          data: { revokedAt: now }
        });
        return result.count;
      },
      commitChange: async ({ householdId, actorClientId, actorUserId, actorNameSnapshot, eventType, targetId }) => {
        await createHouseholdActivity(tx, {
          householdId,
          actorUserId,
          actorNameSnapshot,
          eventType,
          category: "GROUP_SETTING",
          targetType: "INVITATION",
          targetId
        });
        return updateHouseholdRevision(tx, householdId, "member", actorClientId, actorUserId);
      }
    })
  );

export type CreateInvitationMutationResult =
  | {
      status: "created";
      invitation: { id: string; expiresAt: Date };
      change: CommittedHouseholdChange;
    }
  | { status: "forbidden" }
  | { status: "limited"; code: InvitationCreationLimitCode; retryAt: Date }
  | { status: "activeLimit" };

/**
 * 招待作成を、権限・ユーザー頻度・Household内有効件数の制限付きで原子的に実行する。
 *
 * ユーザーlockの後にHousehold lockを取得し、待機後に権限を再確認する。
 * 成功時は招待・操作履歴・revisionを同時に確定し、`change`の公開は呼び出し側が行う。
 */
export async function createRateLimitedHouseholdInvitation(
  input: {
    householdId: string;
    actorUserId: string;
    actorClientId: string | null;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
    actorNameSnapshot?: string;
  },
  execute: InvitationMutationExecutor = executePrismaInvitationMutation
): Promise<CreateInvitationMutationResult> {
  return execute(async (repository) => {
    const initialRole = await repository.findMembershipRole(input.householdId, input.actorUserId);
    if (!initialRole || !canManageHouseholdInvitations(initialRole)) return { status: "forbidden" };

    await repository.lockInvitationCreationByUser(input.actorUserId);
    await repository.lockInvitationCreationByHousehold(input.householdId);

    // ロック待機中に権限が変わる可能性があるため、作成直前にもDBで再確認する。
    const lockedRole = await repository.findMembershipRole(input.householdId, input.actorUserId);
    if (!lockedRole || !canManageHouseholdInvitations(lockedRole)) return { status: "forbidden" };

    const activeInvitationCount = await repository.countActiveInvitationsInHousehold(
      input.householdId,
      input.now
    );
    if (activeInvitationCount >= MAX_ACTIVE_HOUSEHOLD_INVITATIONS) {
      return { status: "activeLimit" };
    }

    const latestCreatedAt = await repository.findLatestInvitationCreatedByUser(input.actorUserId);
    const cooldownLimit = evaluateInvitationCreationLimit({
      now: input.now,
      latestCreatedAt,
      createdWithinWindow: 0,
      oldestCreatedWithinWindowAt: null
    });
    if (cooldownLimit) return { status: "limited", ...cooldownLimit };

    const windowStart = new Date(input.now.getTime() - INVITATION_CREATION_WINDOW_MS);
    const createdWithinWindow = await repository.countInvitationsCreatedByUserSince(
      input.actorUserId,
      windowStart
    );
    const oldestCreatedWithinWindowAt =
      createdWithinWindow >= INVITATION_CREATION_WINDOW_LIMIT
        ? await repository.findOldestInvitationCreatedByUserSince(input.actorUserId, windowStart)
        : null;
    const hourlyLimit = evaluateInvitationCreationLimit({
      now: input.now,
      latestCreatedAt: null,
      createdWithinWindow,
      oldestCreatedWithinWindowAt
    });
    if (hourlyLimit) return { status: "limited", ...hourlyLimit };

    const invitation = await repository.createInvitation({
      householdId: input.householdId,
      createdByUserId: input.actorUserId,
      tokenHash: input.tokenHash,
      createdAt: input.now,
      expiresAt: input.expiresAt
    });
    const change = await repository.commitChange({
      householdId: input.householdId,
      actorClientId: input.actorClientId,
      actorUserId: input.actorUserId,
      actorNameSnapshot: input.actorNameSnapshot || ACTOR_NAME_FALLBACK,
      eventType: "INVITATION_CREATED",
      targetId: invitation.id
    });
    return { status: "created", invitation, change };
  });
}

export type RevokeInvitationMutationResult =
  | { status: "revoked"; invitationId: string; change: CommittedHouseholdChange }
  | { status: "forbidden" | "notFound" | "accepted" | "expired" | "alreadyRevoked" };

/**
 * 現在のHousehold内にある有効な招待だけを取消し、操作履歴とrevisionも確定する。
 *
 * 受諾・期限切れ・既取消との競合は最新状態を読み直し、例外ではなくstatusで返す。
 * 成功時の`change`はcommit後に呼び出し側が公開する。
 */
export async function revokeHouseholdInvitationMutation(
  input: {
    householdId: string;
    actorUserId: string;
    actorClientId: string | null;
    invitationId: string;
    now: Date;
    actorNameSnapshot?: string;
  },
  execute: InvitationMutationExecutor = executePrismaInvitationMutation
): Promise<RevokeInvitationMutationResult> {
  return execute(async (repository) => {
    const role = await repository.findMembershipRole(input.householdId, input.actorUserId);
    if (!role || !canManageHouseholdInvitations(role)) return { status: "forbidden" };

    const invitation = await repository.findInvitation(input.householdId, input.invitationId);
    if (!invitation) return { status: "notFound" };
    const failure = invitationAcceptanceFailure(invitation, input.now);
    if (failure === "accepted") return { status: "accepted" };
    if (failure === "expired") return { status: "expired" };
    if (failure === "revoked") return { status: "alreadyRevoked" };

    const updatedCount = await repository.revokeInvitation(
      input.householdId,
      input.invitationId,
      input.now
    );
    if (updatedCount !== 1) {
      const current = await repository.findInvitation(input.householdId, input.invitationId);
      if (!current) return { status: "notFound" };
      const currentFailure = invitationAcceptanceFailure(current, input.now);
      if (currentFailure === "accepted") return { status: "accepted" };
      if (currentFailure === "expired") return { status: "expired" };
      if (currentFailure === "revoked") return { status: "alreadyRevoked" };
      return { status: "notFound" };
    }

    const change = await repository.commitChange({
      householdId: input.householdId,
      actorClientId: input.actorClientId,
      actorUserId: input.actorUserId,
      actorNameSnapshot: input.actorNameSnapshot || ACTOR_NAME_FALLBACK,
      eventType: "INVITATION_REVOKED",
      targetId: invitation.id
    });
    return { status: "revoked", invitationId: invitation.id, change };
  });
}
