import { createHash } from "node:crypto";

import { Prisma, type AppRole, type HouseholdRole } from "@prisma/client";

import {
  ACCOUNT_DELETE_CONFIRMATION,
  type AccountDeleteDisposition
} from "@/lib/account-delete-shared";
import {
  createPrismaHouseholdDeleteRepository,
  deleteSoleOwnerHousehold,
  type HouseholdDeleteExecutor
} from "@/lib/household-delete";
import {
  createPrismaHouseholdLeaveRepository,
  leaveHouseholdMembership,
  type HouseholdLeaveExecutor
} from "@/lib/household-leave";
import { prisma } from "@/lib/prisma";
import { activityActorName } from "@/lib/household-activity";
import type { CommittedHouseholdChange } from "@/lib/realtime";

export { ACCOUNT_DELETE_CONFIRMATION, type AccountDeleteDisposition } from "@/lib/account-delete-shared";

export type AccountDeleteHouseholdMember = {
  membershipId: string;
  userId: string;
  role: HouseholdRole;
  name: string | null;
  email: string | null;
};

export type AccountDeleteHouseholdState = {
  membershipId: string;
  householdId: string;
  householdName: string;
  currentRole: HouseholdRole;
  memberCount: number;
  ownerCount: number;
  members: AccountDeleteHouseholdMember[];
};

export type AccountDeletePreview = {
  stateToken: string;
  isLastSuperAdmin: boolean;
  households: Array<
    AccountDeleteHouseholdState & {
      disposition: AccountDeleteDisposition;
      transferCandidates: AccountDeleteHouseholdMember[];
    }
  >;
};

type AccountDeletePrismaClient = Pick<Prisma.TransactionClient, "householdMember">;

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function getAccountDeleteDisposition({
  currentRole,
  memberCount,
  ownerCount
}: Pick<AccountDeleteHouseholdState, "currentRole" | "memberCount" | "ownerCount">): AccountDeleteDisposition {
  if (memberCount === 1) {
    return currentRole === "OWNER" && ownerCount === 1 ? "deleteHousehold" : "blocked";
  }
  if (memberCount < 1 || ownerCount < 1 || ownerCount > memberCount) return "blocked";
  if (currentRole === "OWNER" && ownerCount === 1) return "transferOwnership";
  return "leaveHousehold";
}

/**
 * 削除確認画面で取得した全Household状態を、順序に依存しない検証tokenへ変換する。
 *
 * 実行時に再計算して一致を確認することで、画面表示後の所属・権限変更を検出する。
 * tokenは認証情報ではなく、最新状態の再検証と必ず組み合わせる。
 */
export function createAccountDeleteStateToken(states: AccountDeleteHouseholdState[]) {
  const canonicalState = states
    .map((state) => ({
      membershipId: state.membershipId,
      householdId: state.householdId,
      householdName: state.householdName,
      currentRole: state.currentRole,
      memberCount: state.memberCount,
      ownerCount: state.ownerCount,
      members: state.members
        .map((member) => ({
          membershipId: member.membershipId,
          userId: member.userId,
          role: member.role
        }))
        .sort((left, right) =>
          compareIds(`${left.userId}:${left.membershipId}`, `${right.userId}:${right.membershipId}`)
        )
    }))
    .sort((left, right) => compareIds(left.householdId, right.householdId));

  return createHash("sha256").update(JSON.stringify(canonicalState)).digest("hex");
}

async function findAccountDeleteHouseholdStates(
  client: AccountDeletePrismaClient,
  userId: string
): Promise<AccountDeleteHouseholdState[]> {
  const memberships = await client.householdMember.findMany({
    where: { userId },
    orderBy: { householdId: "asc" },
    select: {
      id: true,
      householdId: true,
      role: true,
      household: {
        select: {
          name: true,
          members: {
            orderBy: [{ userId: "asc" }, { id: "asc" }],
            select: {
              id: true,
              userId: true,
              role: true,
              user: { select: { name: true, email: true } }
            }
          }
        }
      }
    }
  });

  return memberships.map((membership) => {
    const members = membership.household.members.map((member) => ({
      membershipId: member.id,
      userId: member.userId,
      role: member.role,
      name: member.user.name,
      email: member.user.email
    }));
    return {
      membershipId: membership.id,
      householdId: membership.householdId,
      householdName: membership.household.name,
      currentRole: membership.role,
      memberCount: members.length,
      ownerCount: members.filter((member) => member.role === "OWNER").length,
      members
    };
  });
}

/**
 * アカウント削除前に、Householdごとの退出・移譲・削除要件と状態tokenを返す。
 *
 * 表示用の事前確認であり、実行時の認可・競合検証は`deleteUserAccount`が改めて行う。
 * @returns ユーザーが既に存在しない場合は`null`
 */
export async function getAccountDeletePreview(userId: string): Promise<AccountDeletePreview | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, appRole: true }
  });
  if (!user) return null;

  const [states, otherSuperAdminCount] = await Promise.all([
    findAccountDeleteHouseholdStates(prisma, userId),
    user.appRole === "SUPER_ADMIN"
      ? prisma.user.count({
          where: { id: { not: userId }, appRole: "SUPER_ADMIN", accessStatus: "ACTIVE" }
        })
      : Promise.resolve(1)
  ]);

  return {
    stateToken: createAccountDeleteStateToken(states),
    isLastSuperAdmin: user.appRole === "SUPER_ADMIN" && otherSuperAdminCount < 1,
    households: states.map((state) => ({
      ...state,
      disposition: getAccountDeleteDisposition(state),
      transferCandidates: state.members.filter((member) => member.userId !== userId)
    }))
  };
}

type AccountDeleteUser = {
  id: string;
  appRole: AppRole;
  name?: string | null;
};

export type AccountDeleteRepository = {
  lockUser(userId: string): Promise<void>;
  lockSuperAdminState(): Promise<void>;
  findUser(userId: string): Promise<AccountDeleteUser | null>;
  countOtherSuperAdmins(userId: string): Promise<number>;
  findHouseholds(userId: string): Promise<AccountDeleteHouseholdState[]>;
  lockHousehold(householdId: string): Promise<void>;
  executeHouseholdLeave: HouseholdLeaveExecutor;
  executeHouseholdDelete: HouseholdDeleteExecutor;
  countMemberships(userId: string): Promise<number>;
  deleteUser(userId: string): Promise<number>;
};

export type AccountDeleteExecutor = <T>(
  operation: (repository: AccountDeleteRepository) => Promise<T>
) => Promise<T>;

const executePrismaAccountDelete: AccountDeleteExecutor = (operation) =>
  prisma.$transaction(
    async (tx) =>
      operation({
        lockUser: async (userId) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
        },
        lockSuperAdminState: async () => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('hamster-manager-super-admin', 0))`;
        },
        findUser: (userId) =>
          tx.user.findUnique({ where: { id: userId }, select: { id: true, appRole: true, name: true } }),
        countOtherSuperAdmins: (userId) =>
          tx.user.count({
            where: { id: { not: userId }, appRole: "SUPER_ADMIN", accessStatus: "ACTIVE" }
          }),
        findHouseholds: (userId) => findAccountDeleteHouseholdStates(tx, userId),
        lockHousehold: async (householdId) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${householdId}, 0))`;
        },
        executeHouseholdLeave: (leaveOperation) =>
          leaveOperation(createPrismaHouseholdLeaveRepository(tx)),
        executeHouseholdDelete: (deleteOperation) =>
          deleteOperation(createPrismaHouseholdDeleteRepository(tx)),
        countMemberships: (userId) => tx.householdMember.count({ where: { userId } }),
        deleteUser: async (userId) => {
          const deleted = await tx.user.deleteMany({ where: { id: userId } });
          return deleted.count;
        }
      }),
    { maxWait: 5_000, timeout: 30_000 }
  );

type AccountDeleteFailureStatus =
  | "confirmationMismatch"
  | "alreadyDeleted"
  | "lastSuperAdmin"
  | "transferRequired"
  | "invalidTransferTarget"
  | "transferTargetUnavailable"
  | "stateChanged";

export type AccountDeleteMutationResult =
  | {
      status: "deleted";
      deletedHouseholdIds: string[];
      leftHouseholdCount: number;
      transferredHouseholdCount: number;
      changes: CommittedHouseholdChange[];
    }
  | { [Status in AccountDeleteFailureStatus]: { status: Status } }[AccountDeleteFailureStatus];

class AccountDeleteAbortError extends Error {
  constructor(readonly status: Exclude<AccountDeleteFailureStatus, "confirmationMismatch">) {
    super(`Account deletion aborted: ${status}`);
  }
}

function abortAccountDelete(status: Exclude<AccountDeleteFailureStatus, "confirmationMismatch">): never {
  throw new AccountDeleteAbortError(status);
}

function mapLeaveFailure(
  status: Exclude<
    Awaited<ReturnType<typeof leaveHouseholdMembership>>["status"],
    "left" | "transferredAndLeft"
  >
): never {
  if (status === "transferRequired") return abortAccountDelete("transferRequired");
  if (status === "invalidTransferTarget") return abortAccountDelete("invalidTransferTarget");
  if (status === "transferTargetUnavailable") return abortAccountDelete("transferTargetUnavailable");
  return abortAccountDelete("stateChanged");
}

/**
 * 全所属Householdからの退出・必要なOWNER移譲・単独Household削除・User削除を原子的に行う。
 *
 * User、SUPER_ADMIN状態、対象Householdを一定順でlockし、最後のSUPER_ADMINや画面表示後の
 * 状態変化を拒否する。成功後の画像削除・リアルタイム通知・Cookie削除は呼び出し側の責務。
 * 業務上の拒否・既知の競合は例外ではなくstatusで返す。
 */
export async function deleteUserAccount(
  input: {
    actorUserId: string;
    actorClientId: string | null;
    confirmationText: string;
    expectedStateToken: string;
    transferTargets: Readonly<Record<string, string | undefined>>;
  },
  execute: AccountDeleteExecutor = executePrismaAccountDelete
): Promise<AccountDeleteMutationResult> {
  if (input.confirmationText !== ACCOUNT_DELETE_CONFIRMATION) {
    return { status: "confirmationMismatch" };
  }

  try {
    return await execute(async (repository) => {
      // 初期Household作成と二重削除を同じユーザー単位で直列化する。
      await repository.lockUser(input.actorUserId);
      // SUPER_ADMINの変更・削除を直列化し、同時削除でも最後の1人を残す。
      await repository.lockSuperAdminState();

      const user = await repository.findUser(input.actorUserId);
      if (!user) abortAccountDelete("alreadyDeleted");
      if (user.appRole === "SUPER_ADMIN" && (await repository.countOtherSuperAdmins(user.id)) < 1) {
        abortAccountDelete("lastSuperAdmin");
      }

      const beforeLockStates = await repository.findHouseholds(user.id);
      const householdIds = [...new Set(beforeLockStates.map((state) => state.householdId))].sort(compareIds);
      // 複数ユーザーの削除対象が重なっても循環待ちにならないよう、全員が同じID順でlockする。
      for (const householdId of householdIds) {
        await repository.lockHousehold(householdId);
      }

      // ロック待機中の退出・権限変更を反映した最新状態だけを以降の認可に使用する。
      const states = await repository.findHouseholds(user.id);
      const blockedState = states.some((state) => getAccountDeleteDisposition(state) === "blocked");
      if (blockedState) abortAccountDelete("stateChanged");

      for (const state of states) {
        if (getAccountDeleteDisposition(state) !== "transferOwnership") continue;
        const transferTargetUserId = input.transferTargets[state.householdId];
        if (!transferTargetUserId) abortAccountDelete("transferRequired");
        if (transferTargetUserId === user.id) abortAccountDelete("invalidTransferTarget");
        if (!state.members.some((member) => member.userId === transferTargetUserId)) {
          abortAccountDelete("transferTargetUnavailable");
        }
      }

      if (createAccountDeleteStateToken(states) !== input.expectedStateToken) {
        abortAccountDelete("stateChanged");
      }

      const deletedHouseholdIds: string[] = [];
      const changes: CommittedHouseholdChange[] = [];
      let leftHouseholdCount = 0;
      let transferredHouseholdCount = 0;

      for (const state of states) {
        const disposition = getAccountDeleteDisposition(state);
        if (disposition === "deleteHousehold") {
          const result = await deleteSoleOwnerHousehold(
            {
              householdId: state.householdId,
              actorUserId: user.id,
              confirmationName: state.householdName
            },
            repository.executeHouseholdDelete
          );
          if (result.status !== "deleted") abortAccountDelete("stateChanged");
          deletedHouseholdIds.push(state.householdId);
          continue;
        }

        const result = await leaveHouseholdMembership(
          {
            householdId: state.householdId,
            actorUserId: user.id,
            actorClientId: input.actorClientId,
            actorNameSnapshot: activityActorName(user),
            transferToUserId:
              disposition === "transferOwnership"
                ? (input.transferTargets[state.householdId] ?? null)
                : null
          },
          repository.executeHouseholdLeave
        );
        if (result.status !== "left" && result.status !== "transferredAndLeft") {
          mapLeaveFailure(result.status);
        }
        leftHouseholdCount += 1;
        changes.push(result.change);
        if (result.status === "transferredAndLeft") transferredHouseholdCount += 1;
      }

      // 招待受諾も同じユーザーlockを取る。念のためmembershipが残っていればUser削除へ進まない。
      if ((await repository.countMemberships(user.id)) !== 0) abortAccountDelete("stateChanged");
      if ((await repository.deleteUser(user.id)) !== 1) abortAccountDelete("stateChanged");

      return {
        status: "deleted",
        deletedHouseholdIds,
        leftHouseholdCount,
        transferredHouseholdCount,
        changes
      };
    });
  } catch (error) {
    if (error instanceof AccountDeleteAbortError) return { status: error.status };
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2025" || error.code === "P2034")
    ) {
      return { status: "stateChanged" };
    }
    throw error;
  }
}
