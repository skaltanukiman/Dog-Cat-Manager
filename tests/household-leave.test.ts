import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { HouseholdRole } from "@prisma/client";

import {
  leaveHouseholdMembership,
  type HouseholdLeaveExecutor,
  type HouseholdLeaveRepository
} from "../src/lib/household-leave";

type StoredMembership = {
  id: string;
  householdId: string;
  userId: string;
  role: HouseholdRole;
};

type FakeDatabase = {
  memberships: Map<string, StoredMembership>;
  appSettings: Set<string>;
  sharedData: { hamsters: string[]; records: string[]; otherUserSettings: string[] };
  lockTails: Map<string, Promise<void>>;
  revision: number;
  transactionCount: number;
  operationLog: string[];
  failMembershipDeletion: boolean;
};

function key(householdId: string, userId: string) {
  return `${householdId}:${userId}`;
}

function membership(userId: string, role: HouseholdRole, householdId = "household-1"): StoredMembership {
  return { id: `member-${userId}`, householdId, userId, role };
}

function createDatabase(members: StoredMembership[]): FakeDatabase {
  return {
    memberships: new Map(members.map((member) => [key(member.householdId, member.userId), member])),
    appSettings: new Set(members.map((member) => key(member.householdId, member.userId))),
    sharedData: {
      hamsters: ["hamster-1"],
      records: ["record-by-leaving-user", "record-by-other-user"],
      otherUserSettings: ["household-1:user-2"]
    },
    lockTails: new Map(),
    revision: 0,
    transactionCount: 0,
    operationLog: [],
    failMembershipDeletion: false
  };
}

function createExecutor(database: FakeDatabase): HouseholdLeaveExecutor {
  return async (operation) => {
    database.transactionCount += 1;
    const transactionState: {
      releaseLock?: () => void;
      snapshot?: {
        memberships: Map<string, StoredMembership>;
        appSettings: Set<string>;
        revision: number;
        operationLogLength: number;
      };
    } = {};

    async function lockHousehold(householdId: string) {
      const previousTail = database.lockTails.get(householdId) ?? Promise.resolve();
      let releaseCurrent!: () => void;
      const current = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
      });
      database.lockTails.set(householdId, previousTail.then(() => current));
      await previousTail;
      transactionState.releaseLock = releaseCurrent;
      transactionState.snapshot = {
        memberships: new Map(
          [...database.memberships].map(([membershipKey, stored]) => [membershipKey, { ...stored }])
        ),
        appSettings: new Set(database.appSettings),
        revision: database.revision,
        operationLogLength: database.operationLog.length
      };
      database.operationLog.push("lock");
    }

    const repository: HouseholdLeaveRepository = {
      lockHousehold,
      findMembership: async (householdId, userId) => {
        const found = database.memberships.get(key(householdId, userId));
        return found ? { ...found } : null;
      },
      countMembers: async (householdId) =>
        [...database.memberships.values()].filter((member) => member.householdId === householdId).length,
      countOwners: async (householdId) =>
        [...database.memberships.values()].filter(
          (member) => member.householdId === householdId && member.role === "OWNER"
        ).length,
      promoteToOwner: async (target) => {
        const stored = database.memberships.get(key(target.householdId, target.userId));
        if (!stored || stored.id !== target.id || stored.role !== target.role) return 0;
        database.operationLog.push("promoteTarget");
        stored.role = "OWNER";
        return 1;
      },
      deleteAppSetting: async (householdId, userId) => {
        database.operationLog.push("deleteAppSetting");
        return database.appSettings.delete(key(householdId, userId)) ? 1 : 0;
      },
      deleteMembership: async (target) => {
        if (database.failMembershipDeletion) return 0;
        const stored = database.memberships.get(key(target.householdId, target.userId));
        if (!stored || stored.id !== target.id || stored.role !== target.role) return 0;
        database.operationLog.push("deleteMembership");
        database.memberships.delete(key(target.householdId, target.userId));
        return 1;
      },
      commitChange: async ({ householdId, actorClientId, actorUserId }) => {
        database.operationLog.push("updateRevision");
        database.revision += 1;
        return {
          householdId,
          source: "member",
          actorClientId,
          actorUserId,
          revision: String(database.revision)
        };
      }
    };

    try {
      return await operation(repository);
    } catch (error) {
      if (transactionState.snapshot) {
        database.memberships = transactionState.snapshot.memberships;
        database.appSettings = transactionState.snapshot.appSettings;
        database.revision = transactionState.snapshot.revision;
        database.operationLog.splice(transactionState.snapshot.operationLogLength);
      }
      throw error;
    } finally {
      transactionState.releaseLock?.();
    }
  };
}

function leaveInput(actorUserId: string, transferToUserId: string | null = null) {
  return {
    householdId: "household-1",
    actorUserId,
    actorClientId: "client-1",
    transferToUserId
  };
}

test("自己退出は自分のmembershipと対象Household用設定だけを削除し、共有データを保持する", async () => {
  const database = createDatabase([membership("user-1", "MEMBER"), membership("user-2", "OWNER")]);
  const sharedBefore = structuredClone(database.sharedData);
  const result = await leaveHouseholdMembership(leaveInput("user-1"), createExecutor(database));

  assert.equal(result.status, "left");
  assert.equal(database.memberships.has(key("household-1", "user-1")), false);
  assert.equal(database.memberships.get(key("household-1", "user-2"))?.role, "OWNER");
  assert.equal(database.appSettings.has(key("household-1", "user-1")), false);
  assert.equal(database.appSettings.has(key("household-1", "user-2")), true);
  assert.deepEqual(database.sharedData, sharedBefore);
  assert.equal(database.revision, 1);
});

test("唯一のOWNERは移譲先なしでは退出できず、自分だけのHouseholdも退出できない", async () => {
  const shared = createDatabase([membership("user-1", "OWNER"), membership("user-2", "MEMBER")]);
  assert.equal(
    (await leaveHouseholdMembership(leaveInput("user-1"), createExecutor(shared))).status,
    "transferRequired"
  );
  assert.equal(shared.memberships.get(key("household-1", "user-1"))?.role, "OWNER");

  const personal = createDatabase([membership("user-1", "OWNER")]);
  assert.equal(
    (await leaveHouseholdMembership(leaveInput("user-1"), createExecutor(personal))).status,
    "soleMember"
  );
  assert.equal(personal.memberships.size, 1);
});

test("唯一のOWNERはVIEWERを先にOWNERへ昇格してから同じトランザクションで退出する", async () => {
  const database = createDatabase([membership("user-1", "OWNER"), membership("user-2", "VIEWER")]);
  const result = await leaveHouseholdMembership(leaveInput("user-1", "user-2"), createExecutor(database));

  assert.equal(result.status, "transferredAndLeft");
  if (result.status === "transferredAndLeft") {
    assert.equal(result.transferTargetPreviousRole, "VIEWER");
  }
  assert.equal(database.transactionCount, 1);
  assert.equal(database.memberships.has(key("household-1", "user-1")), false);
  assert.equal(database.memberships.get(key("household-1", "user-2"))?.role, "OWNER");
  assert.ok(database.operationLog.indexOf("promoteTarget") < database.operationLog.indexOf("deleteMembership"));
  assert.equal(
    [...database.memberships.values()].filter((member) => member.role === "OWNER").length,
    1
  );
});

test("自分自身またはHousehold外・退出済みユーザーへの所有権移譲を拒否する", async () => {
  for (const transferToUserId of ["user-1", "outsider"] as const) {
    const database = createDatabase([membership("user-1", "OWNER"), membership("user-2", "MEMBER")]);
    const result = await leaveHouseholdMembership(
      leaveInput("user-1", transferToUserId),
      createExecutor(database)
    );
    assert.equal(result.status, transferToUserId === "user-1" ? "invalidTransferTarget" : "transferTargetUnavailable");
    assert.equal(database.memberships.get(key("household-1", "user-1"))?.role, "OWNER");
  }
});

test("移譲後のmembership削除が競合した場合は移譲と設定削除もロールバックする", async () => {
  const database = createDatabase([membership("user-1", "OWNER"), membership("user-2", "MEMBER")]);
  database.failMembershipDeletion = true;
  const result = await leaveHouseholdMembership(leaveInput("user-1", "user-2"), createExecutor(database));

  assert.equal(result.status, "stateChanged");
  assert.equal(database.memberships.get(key("household-1", "user-1"))?.role, "OWNER");
  assert.equal(database.memberships.get(key("household-1", "user-2"))?.role, "MEMBER");
  assert.equal(database.appSettings.has(key("household-1", "user-1")), true);
  assert.equal(database.revision, 0);
});

test("同じユーザーの同時退出は直列化され、membershipを二重削除しない", async () => {
  const database = createDatabase([membership("user-1", "MEMBER"), membership("user-2", "OWNER")]);
  const execute = createExecutor(database);
  const results = await Promise.all([
    leaveHouseholdMembership(leaveInput("user-1"), execute),
    leaveHouseholdMembership(leaveInput("user-1"), execute)
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), ["left", "notMember"]);
  assert.equal(database.revision, 1);
  assert.equal(database.memberships.size, 1);
});

test("複数OWNERが同時退出しても、最後のOWNERは移譲なしで退出できない", async () => {
  const database = createDatabase([
    membership("user-1", "OWNER"),
    membership("user-2", "OWNER"),
    membership("user-3", "MEMBER")
  ]);
  const execute = createExecutor(database);
  const results = await Promise.all([
    leaveHouseholdMembership(leaveInput("user-1"), execute),
    leaveHouseholdMembership(leaveInput("user-2"), execute)
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), ["left", "transferRequired"]);
  assert.equal(
    [...database.memberships.values()].filter((member) => member.role === "OWNER").length,
    1
  );
});

test("本番処理はHousehold lock・AppSetting削除・revision更新を同一Prisma transactionで行う", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/household-leave.ts"), "utf8");
  assert.match(source, /prisma\.\$transaction/);
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$\{householdId\}, 0\)\)/);
  assert.match(source, /tx\.appSetting\.deleteMany/);
  assert.match(source, /updateHouseholdRevision\(tx, householdId, "member"/);
});

test("退出Actionは次のHouseholdを共通選択ロジックで確保してCookieを更新し、安全に通知する", () => {
  const actionSource = readFileSync(join(process.cwd(), "src/app/actions/members.ts"), "utf8");
  const authSource = readFileSync(join(process.cwd(), "src/lib/auth-context.ts"), "utf8");
  assert.match(actionSource, /ensureUserHouseholdMembership\(context\.user\)/);
  assert.match(actionSource, /setCurrentHouseholdCookie\(nextMembership\.householdId\)/);
  assert.match(actionSource, /publishHouseholdChangeSafely\(result\.change\)/);
  assert.match(authSource, /ensureUserHouseholdMembership/);
  assert.match(authSource, /findMembership\(user\.id, preferredHouseholdId\)[\s\S]*createInitialHousehold\(user\)/);
});

test("共有画面と専用画面は唯一のOWNERでも手続きを開け、移譲先と最終確認を画面内に表示する", () => {
  const membersPage = readFileSync(join(process.cwd(), "src/app/(app)/settings/members/page.tsx"), "utf8");
  const leavePage = readFileSync(join(process.cwd(), "src/app/(app)/settings/members/leave/page.tsx"), "utf8");
  const leaveForm = readFileSync(join(process.cwd(), "src/components/household-leave-form.tsx"), "utf8");

  assert.match(membersPage, /href="\/settings\/members\/leave"/);
  assert.doesNotMatch(membersPage, /href="\/settings\/members\/leave"[\s\S]{0,200}disabled/);
  assert.match(membersPage, /共有グループからの退出/);
  assert.match(membersPage, /現在参加している共有グループから退出する手続きです。/);
  assert.match(membersPage, /現在の共有グループ/);
  assert.match(membersPage, /このグループのハムスターや記録/);
  assert.match(leavePage, /requirement === "soleMember"/);
  assert.match(leavePage, /requiresTransfer={requirement === "transferOwnership"}/);
  assert.match(leavePage, /共有グループからの退出/);
  assert.match(leavePage, /現在の共有グループ/);
  assert.match(leavePage, /このグループには、あなた以外のメンバーがいません/);
  assert.match(leavePage, /href="\/settings\/members\/delete"/);
  assert.match(leavePage, /共有グループの削除手続きへ/);
  assert.match(leaveForm, /name="transferToUserId"/);
  assert.match(leaveForm, /!requiresTransfer \|\| Boolean\(selectedCandidate\)/);
  assert.match(leaveForm, /disabled={!canSubmit \|\| pending}/);
  assert.match(leaveForm, /この共有グループから退出する/);
  assert.match(leaveForm, /このグループで唯一のオーナーです。/);
  assert.match(leaveForm, /このグループへアクセスできなくなることを確認しました/);
  assert.match(leaveForm, /グループ内のハムスターや共有記録は削除されず/);
  assert.match(leavePage, /sm:grid-cols-2/);
  assert.doesNotMatch(leaveForm, /window\.confirm/);
});

test("退出ステータスメッセージは共有グループという利用者向け用語を使う", () => {
  const statusMessage = readFileSync(join(process.cwd(), "src/components/status-message.tsx"), "utf8");

  assert.match(statusMessage, /共有グループから退出しました。/);
  assert.match(statusMessage, /所有権を移譲し、共有グループから退出しました。/);
  assert.match(statusMessage, /共有グループの状態が変更されています。/);
  assert.match(statusMessage, /この共有グループに所属していません。/);
});
