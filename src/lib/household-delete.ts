import { Prisma, type HouseholdRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { writeServerLog } from "@/lib/logger";

type DeleteMembership = {
  id: string;
  householdId: string;
  userId: string;
  role: HouseholdRole;
};

type DeleteHousehold = {
  id: string;
  name: string;
};

export type HouseholdDeleteRepository = {
  lockHousehold(householdId: string): Promise<void>;
  findHousehold(householdId: string): Promise<DeleteHousehold | null>;
  findMembership(householdId: string, userId: string): Promise<DeleteMembership | null>;
  countMembers(householdId: string): Promise<number>;
  countOwners(householdId: string): Promise<number>;
  deleteHousehold(householdId: string): Promise<number>;
};

export type HouseholdDeleteExecutor = <T>(
  operation: (repository: HouseholdDeleteRepository) => Promise<T>
) => Promise<T>;

export type HouseholdDeleteWarning = (context: {
  householdId: string;
  actorUserId: string;
  currentRole: HouseholdRole;
  memberCount: number;
  ownerCount: number;
}) => void;

export function createPrismaHouseholdDeleteRepository(
  tx: Prisma.TransactionClient
): HouseholdDeleteRepository {
  return {
    lockHousehold: async (householdId) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${householdId}, 0))`;
    },
    findHousehold: (householdId) =>
      tx.household.findUnique({
        where: { id: householdId },
        select: { id: true, name: true }
      }),
    findMembership: (householdId, userId) =>
      tx.householdMember.findUnique({
        where: { householdId_userId: { householdId, userId } },
        select: { id: true, householdId: true, userId: true, role: true }
      }),
    countMembers: (householdId) => tx.householdMember.count({ where: { householdId } }),
    countOwners: (householdId) =>
      tx.householdMember.count({ where: { householdId, role: "OWNER" } }),
    deleteHousehold: async (householdId) => {
      await tx.household.delete({ where: { id: householdId } });
      return 1;
    }
  };
}

const executePrismaHouseholdDelete: HouseholdDeleteExecutor = (operation) =>
  prisma.$transaction(async (tx) => operation(createPrismaHouseholdDeleteRepository(tx)));

export function warnHouseholdDeleteRoleStateInvalid({
  householdId,
  actorUserId,
  currentRole,
  memberCount,
  ownerCount
}: {
  householdId: string;
  actorUserId: string;
  currentRole: HouseholdRole;
  memberCount: number;
  ownerCount: number;
}) {
  writeServerLog("warn", {
    event: "household_delete_role_state_invalid",
    message: "Household削除を権限状態の不整合により拒否しました。",
    operation: "householdDelete.authorize",
    context: {
      householdId,
      actorUserId,
      currentRole,
      memberCount,
      ownerCount,
      deletionRejected: true
    }
  });
}

type HouseholdDeleteFailureStatus =
  | "notFound"
  | "notMember"
  | "forbidden"
  | "roleStateInvalid"
  | "nameMismatch"
  | "stateChanged";

export type HouseholdDeleteMutationResult =
  | { status: "deleted"; actorHouseholdRole: "OWNER" }
  | { [Status in HouseholdDeleteFailureStatus]: { status: Status } }[HouseholdDeleteFailureStatus];

/**
 * 単独OWNERだけが、名前による再確認を経てHouseholdを削除する。
 *
 * 退出・招待受諾と共通のHousehold lock内で所属数とOWNER数を再確認する。
 * 不整合や競合は削除せずstatusで返し、画像などDB外の資産は呼び出し側がcommit後に削除する。
 */
export async function deleteSoleOwnerHousehold(
  input: {
    householdId: string;
    actorUserId: string;
    confirmationName: string;
  },
  execute: HouseholdDeleteExecutor = executePrismaHouseholdDelete,
  warnRoleStateInvalid: HouseholdDeleteWarning = warnHouseholdDeleteRoleStateInvalid
): Promise<HouseholdDeleteMutationResult> {
  try {
    return await execute(async (repository) => {
      // OWNER数・メンバー数の確認から削除までを、退出や招待受諾と同じHousehold単位で直列化する。
      await repository.lockHousehold(input.householdId);

      const household = await repository.findHousehold(input.householdId);
      if (!household) return { status: "notFound" };

      const membership = await repository.findMembership(input.householdId, input.actorUserId);
      if (!membership) return { status: "notMember" };

      const [memberCount, ownerCount] = await Promise.all([
        repository.countMembers(input.householdId),
        repository.countOwners(input.householdId)
      ]);

      // 単独メンバーなのにOWNERでない状態は通常操作では作れないため、削除せず監査可能な警告を残す。
      if (memberCount === 1 && (membership.role !== "OWNER" || ownerCount !== 1)) {
        warnRoleStateInvalid({
          householdId: input.householdId,
          actorUserId: input.actorUserId,
          currentRole: membership.role,
          memberCount,
          ownerCount
        });
        return { status: "roleStateInvalid" };
      }
      if (membership.role !== "OWNER") return { status: "forbidden" };
      if (memberCount !== 1 || ownerCount !== 1) return { status: "stateChanged" };
      if (household.name !== input.confirmationName) return { status: "nameMismatch" };

      if ((await repository.deleteHousehold(input.householdId)) !== 1) {
        return { status: "stateChanged" };
      }
      return { status: "deleted", actorHouseholdRole: "OWNER" };
    });
  } catch (error) {
    // 確認後に対象が消えた競合も、利用者には一貫して状態変更として返す。
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { status: "stateChanged" };
    }
    throw error;
  }
}
