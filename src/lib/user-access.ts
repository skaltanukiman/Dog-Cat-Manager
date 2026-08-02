import { Prisma, type AppRole, type UserAccessActionType, type UserAccessStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  USER_RESTORE_NOTE_MAX_LENGTH,
  USER_SUSPENSION_REASON_MAX_LENGTH,
  USER_SUSPENSION_REASON_MIN_LENGTH
} from "@/lib/user-access-constants";

export {
  USER_RESTORE_NOTE_MAX_LENGTH,
  USER_SUSPENSION_REASON_MAX_LENGTH,
  USER_SUSPENSION_REASON_MIN_LENGTH
} from "@/lib/user-access-constants";

const suspensionReasonSchema = z
  .string()
  .trim()
  .min(USER_SUSPENSION_REASON_MIN_LENGTH)
  .max(USER_SUSPENSION_REASON_MAX_LENGTH);

const restoreNoteSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.union([z.string().trim().max(USER_RESTORE_NOTE_MAX_LENGTH), z.null()])
);

export function parseUserSuspensionReason(value: unknown) {
  const parsed = suspensionReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseUserRestoreNote(value: unknown) {
  const parsed = restoreNoteSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

type UserAccessIdentity = {
  id: string;
  name: string | null;
  email: string | null;
  appRole: AppRole;
  accessStatus: UserAccessStatus;
};

export type UserAccessMutationRepository = {
  lockSuperAdminState(): Promise<void>;
  findUser(userId: string): Promise<UserAccessIdentity | null>;
  countActiveSuperAdmins(): Promise<number>;
  updateAccessStatus(input: {
    userId: string;
    expectedStatus: UserAccessStatus;
    nextStatus: UserAccessStatus;
    suspendedAt: Date | null;
    suspendedByUserId: string | null;
    suspensionReason: string | null;
  }): Promise<boolean>;
  deleteSessions(userId: string): Promise<number>;
  createAction(input: {
    actionType: UserAccessActionType;
    actor: UserAccessIdentity;
    target: UserAccessIdentity;
    reason: string | null;
    createdAt: Date;
  }): Promise<void>;
};

export type UserAccessMutationExecutor = <T>(
  operation: (repository: UserAccessMutationRepository) => Promise<T>
) => Promise<T>;

function snapshotName(user: Pick<UserAccessIdentity, "name">) {
  return user.name?.trim() || "名前未設定";
}

const executePrismaUserAccessMutation: UserAccessMutationExecutor = (operation) =>
  prisma.$transaction(async (tx) =>
    operation({
      lockSuperAdminState: async () => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('hamster-manager-super-admin', 0))`;
      },
      findUser: (userId) =>
        tx.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, appRole: true, accessStatus: true }
        }),
      countActiveSuperAdmins: () =>
        tx.user.count({ where: { appRole: "SUPER_ADMIN", accessStatus: "ACTIVE" } }),
      updateAccessStatus: async ({ userId, expectedStatus, nextStatus, ...data }) => {
        const updated = await tx.user.updateMany({
          where: { id: userId, accessStatus: expectedStatus },
          data: { accessStatus: nextStatus, ...data }
        });
        return updated.count === 1;
      },
      deleteSessions: async (userId) => {
        const deleted = await tx.session.deleteMany({ where: { userId } });
        return deleted.count;
      },
      createAction: async ({ actionType, actor, target, reason, createdAt }) => {
        await tx.userAccessAction.create({
          data: {
            actionType,
            actorUserId: actor.id,
            actorUserIdSnapshot: actor.id,
            actorNameSnapshot: snapshotName(actor),
            targetUserId: target.id,
            targetUserIdSnapshot: target.id,
            targetNameSnapshot: snapshotName(target),
            reason,
            createdAt
          }
        });
      }
    })
  );

export type UserAccessMutationResult =
  | "suspended"
  | "restored"
  | "forbidden"
  | "notFound"
  | "cannotSuspendSelf"
  | "lastSuperAdmin"
  | "alreadySuspended"
  | "alreadyActive"
  | "stateChanged"
  | "invalidReason"
  | "invalidNote";

export async function suspendUserAccess(
  input: { actorUserId: string; targetUserId: string; reason: unknown },
  execute: UserAccessMutationExecutor = executePrismaUserAccessMutation
): Promise<UserAccessMutationResult> {
  const reason = parseUserSuspensionReason(input.reason);
  if (!reason) return "invalidReason";

  return execute(async (repository) => {
    // SUPER_ADMINの停止・権限変更・削除と同じlockで直列化し、同時操作でも最後の利用可能者を残す。
    await repository.lockSuperAdminState();
    const actor = await repository.findUser(input.actorUserId);
    if (!actor || actor.appRole !== "SUPER_ADMIN" || actor.accessStatus !== "ACTIVE") return "forbidden";

    const target = await repository.findUser(input.targetUserId);
    if (!target) return "notFound";
    if (target.accessStatus === "SUSPENDED") return "alreadySuspended";
    if (target.appRole === "SUPER_ADMIN" && (await repository.countActiveSuperAdmins()) <= 1) {
      return "lastSuperAdmin";
    }
    if (actor.id === target.id) return "cannotSuspendSelf";

    const now = new Date();
    const updated = await repository.updateAccessStatus({
      userId: target.id,
      expectedStatus: "ACTIVE",
      nextStatus: "SUSPENDED",
      suspendedAt: now,
      suspendedByUserId: actor.id,
      suspensionReason: reason
    });
    if (!updated) return "stateChanged";

    // 状態更新とSession失効を同じtransactionに含め、停止済みなのに既存Sessionだけ有効な状態を作らない。
    await repository.deleteSessions(target.id);
    await repository.createAction({ actionType: "SUSPENDED", actor, target, reason, createdAt: now });
    return "suspended";
  });
}

export async function restoreUserAccess(
  input: { actorUserId: string; targetUserId: string; note: unknown },
  execute: UserAccessMutationExecutor = executePrismaUserAccessMutation
): Promise<UserAccessMutationResult> {
  const note = parseUserRestoreNote(input.note);
  if (note === undefined) return "invalidNote";

  return execute(async (repository) => {
    await repository.lockSuperAdminState();
    const actor = await repository.findUser(input.actorUserId);
    if (!actor || actor.appRole !== "SUPER_ADMIN" || actor.accessStatus !== "ACTIVE") return "forbidden";

    const target = await repository.findUser(input.targetUserId);
    if (!target) return "notFound";
    if (target.accessStatus === "ACTIVE") return "alreadyActive";

    const now = new Date();
    const updated = await repository.updateAccessStatus({
      userId: target.id,
      expectedStatus: "SUSPENDED",
      nextStatus: "ACTIVE",
      suspendedAt: null,
      suspendedByUserId: null,
      suspensionReason: null
    });
    if (!updated) return "stateChanged";

    await repository.createAction({ actionType: "RESTORED", actor, target, reason: note, createdAt: now });
    return "restored";
  });
}

type SuspendedSignInReader = {
  findFirst(args: Prisma.UserFindFirstArgs): Promise<{ accessStatus: UserAccessStatus } | null>;
};

const suspendedSignInReader: SuspendedSignInReader = {
  findFirst: (args) => prisma.user.findFirst(args) as Promise<{ accessStatus: UserAccessStatus } | null>
};

export async function isSuspendedUserForSignIn(
  identity: { id?: string | null; email?: string | null },
  reader: SuspendedSignInReader = suspendedSignInReader
) {
  const identities: Prisma.UserWhereInput[] = [];
  // OAuth初回処理ではDB上のUser IDがまだ確定しない場合があるため、既存利用者はメールでも照合する。
  if (identity.id) identities.push({ id: identity.id });
  if (identity.email) identities.push({ email: identity.email });
  if (identities.length === 0) return false;

  const user = await reader.findFirst({
    where: { OR: identities },
    select: { accessStatus: true }
  });
  return user?.accessStatus === "SUSPENDED";
}
