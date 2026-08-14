import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppRole, HouseholdRole } from "@prisma/client";

import {
  ACCOUNT_DELETE_CONFIRMATION,
  createAccountDeleteStateToken,
  deleteUserAccount,
  type AccountDeleteExecutor,
  type AccountDeleteHouseholdState,
  type AccountDeleteRepository
} from "../src/lib/account-delete";
import type { HouseholdDeleteRepository } from "../src/lib/household-delete";
import { deleteHouseholdImageDirectoriesSafely } from "../src/lib/household-delete-images";
import type { HouseholdLeaveRepository } from "../src/lib/household-leave";
import { deletePetImageHouseholdDirectory } from "../src/lib/pet-image";
import { deletePetRecordImageHouseholdDirectory } from "../src/lib/pet-record-image";
import {
  requiresAccountDeleteAttention,
  type AccountDeleteDisposition
} from "../src/lib/account-delete-shared";

type StoredUser = { id: string; appRole: AppRole; name: string; email: string };
type StoredMembership = {
  id: string;
  householdId: string;
  userId: string;
  role: HouseholdRole;
};
type StoredHousehold = { id: string; name: string; data: Set<string> };
type StoredRecord = { id: string; householdId: string; createdByUserId: string | null };

type FakeDatabase = {
  users: Map<string, StoredUser>;
  households: Map<string, StoredHousehold>;
  memberships: Map<string, StoredMembership>;
  appSettings: Set<string>;
  dashboardSettings: Set<string>;
  accounts: Set<string>;
  sessions: Set<string>;
  records: Map<string, StoredRecord>;
  revision: number;
  operationLog: string[];
  lockTails: Map<string, Promise<void>>;
};

function membershipKey(householdId: string, userId: string) {
  return `${householdId}:${userId}`;
}

function createDatabase(targetRole: AppRole = "USER"): FakeDatabase {
  return {
    users: new Map([
      ["user-1", { id: "user-1", appRole: targetRole, name: "削除対象", email: "target@example.com" }]
    ]),
    households: new Map(),
    memberships: new Map(),
    appSettings: new Set(),
    dashboardSettings: new Set(),
    accounts: new Set(["user-1"]),
    sessions: new Set(["user-1"]),
    records: new Map(),
    revision: 0,
    operationLog: [],
    lockTails: new Map()
  };
}

function ensureUser(database: FakeDatabase, userId: string, appRole: AppRole = "USER") {
  if (!database.users.has(userId)) {
    database.users.set(userId, {
      id: userId,
      appRole,
      name: userId,
      email: `${userId}@example.com`
    });
  }
}

function addHousehold(
  database: FakeDatabase,
  householdId: string,
  members: Array<{ userId: string; role: HouseholdRole }>,
  data = ["pet", "petWeight", "petCare", "petRecord", "savedTag", "invitation"]
) {
  database.households.set(householdId, {
    id: householdId,
    name: `共有 ${householdId}`,
    data: new Set(data)
  });
  for (const member of members) {
    ensureUser(database, member.userId);
    const key = membershipKey(householdId, member.userId);
    database.memberships.set(key, {
      id: `member-${key}`,
      householdId,
      userId: member.userId,
      role: member.role
    });
    database.appSettings.add(key);
    database.dashboardSettings.add(key);
  }
}

function findHouseholdStates(database: FakeDatabase, userId: string): AccountDeleteHouseholdState[] {
  return [...database.memberships.values()]
    .filter((membership) => membership.userId === userId)
    .sort((left, right) => left.householdId.localeCompare(right.householdId))
    .map((membership) => {
      const household = database.households.get(membership.householdId);
      assert.ok(household);
      const members = [...database.memberships.values()]
        .filter((member) => member.householdId === membership.householdId)
        .sort((left, right) => left.userId.localeCompare(right.userId))
        .map((member) => {
          const user = database.users.get(member.userId);
          return {
            membershipId: member.id,
            userId: member.userId,
            role: member.role,
            name: user?.name ?? null,
            email: user?.email ?? null
          };
        });
      return {
        membershipId: membership.id,
        householdId: membership.householdId,
        householdName: household.name,
        currentRole: membership.role,
        memberCount: members.length,
        ownerCount: members.filter((member) => member.role === "OWNER").length,
        members
      };
    });
}

type DatabaseSnapshot = Omit<FakeDatabase, "operationLog" | "lockTails">;

function takeSnapshot(database: FakeDatabase): DatabaseSnapshot {
  return {
    users: structuredClone(database.users),
    households: structuredClone(database.households),
    memberships: structuredClone(database.memberships),
    appSettings: structuredClone(database.appSettings),
    dashboardSettings: structuredClone(database.dashboardSettings),
    accounts: structuredClone(database.accounts),
    sessions: structuredClone(database.sessions),
    records: structuredClone(database.records),
    revision: database.revision
  };
}

function restoreSnapshot(database: FakeDatabase, snapshot: DatabaseSnapshot) {
  database.users = snapshot.users;
  database.households = snapshot.households;
  database.memberships = snapshot.memberships;
  database.appSettings = snapshot.appSettings;
  database.dashboardSettings = snapshot.dashboardSettings;
  database.accounts = snapshot.accounts;
  database.sessions = snapshot.sessions;
  database.records = snapshot.records;
  database.revision = snapshot.revision;
}

function createExecutor(database: FakeDatabase): AccountDeleteExecutor {
  return async (operation) => {
    const heldLocks = new Set<string>();
    const releases: Array<() => void> = [];
    let snapshot: DatabaseSnapshot | null = null;

    async function acquireLock(lockName: string) {
      if (heldLocks.has(lockName)) return;
      const previous = database.lockTails.get(lockName) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      database.lockTails.set(lockName, previous.then(() => current));
      await previous;
      if (!snapshot) snapshot = takeSnapshot(database);
      heldLocks.add(lockName);
      releases.push(release);
      database.operationLog.push(`lock:${lockName}`);
    }

    const lockHousehold = (householdId: string) => acquireLock(`household:${householdId}`);
    const leaveRepository: HouseholdLeaveRepository = {
      lockHousehold,
      findMembership: async (householdId, userId) =>
        database.memberships.get(membershipKey(householdId, userId)) ?? null,
      countMembers: async (householdId) =>
        [...database.memberships.values()].filter((member) => member.householdId === householdId).length,
      countOwners: async (householdId) =>
        [...database.memberships.values()].filter(
          (member) => member.householdId === householdId && member.role === "OWNER"
        ).length,
      promoteToOwner: async (target) => {
        const stored = database.memberships.get(membershipKey(target.householdId, target.userId));
        if (!stored || stored.id !== target.id || stored.role !== target.role) return 0;
        database.operationLog.push(`promote:${target.householdId}:${target.userId}`);
        stored.role = "OWNER";
        return 1;
      },
      deleteAppSetting: async (householdId, userId) => {
        const key = membershipKey(householdId, userId);
        database.dashboardSettings.delete(key);
        return database.appSettings.delete(key) ? 1 : 0;
      },
      deleteMembership: async (target) => {
        const key = membershipKey(target.householdId, target.userId);
        const stored = database.memberships.get(key);
        if (!stored || stored.id !== target.id || stored.role !== target.role) return 0;
        database.operationLog.push(`leave:${target.householdId}:${target.userId}`);
        database.memberships.delete(key);
        return 1;
      },
      commitChange: async ({ householdId, actorClientId, actorUserId }) => {
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
    const deleteRepository: HouseholdDeleteRepository = {
      lockHousehold,
      findHousehold: async (householdId) => database.households.get(householdId) ?? null,
      findMembership: async (householdId, userId) =>
        database.memberships.get(membershipKey(householdId, userId)) ?? null,
      countMembers: leaveRepository.countMembers,
      countOwners: leaveRepository.countOwners,
      deleteHousehold: async (householdId) => {
        if (!database.households.has(householdId)) return 0;
        database.operationLog.push(`deleteHousehold:${householdId}`);
        database.households.delete(householdId);
        for (const [key, member] of database.memberships) {
          if (member.householdId === householdId) database.memberships.delete(key);
        }
        for (const key of database.appSettings) {
          if (key.startsWith(`${householdId}:`)) database.appSettings.delete(key);
        }
        for (const key of database.dashboardSettings) {
          if (key.startsWith(`${householdId}:`)) database.dashboardSettings.delete(key);
        }
        for (const [recordId, record] of database.records) {
          if (record.householdId === householdId) database.records.delete(recordId);
        }
        return 1;
      }
    };
    const repository: AccountDeleteRepository = {
      lockUser: (userId) => acquireLock(`user:${userId}`),
      lockSuperAdminState: () => acquireLock("super-admin"),
      findUser: async (userId) => {
        const user = database.users.get(userId);
        return user ? { id: user.id, appRole: user.appRole } : null;
      },
      countOtherSuperAdmins: async (userId) =>
        [...database.users.values()].filter(
          (user) => user.id !== userId && user.appRole === "SUPER_ADMIN"
        ).length,
      findHouseholds: async (userId) => findHouseholdStates(database, userId),
      lockHousehold,
      executeHouseholdLeave: (leaveOperation) => leaveOperation(leaveRepository),
      executeHouseholdDelete: (deleteOperation) => deleteOperation(deleteRepository),
      countMemberships: async (userId) =>
        [...database.memberships.values()].filter((member) => member.userId === userId).length,
      deleteUser: async (userId) => {
        if (!database.users.has(userId)) return 0;
        database.operationLog.push(`deleteUser:${userId}`);
        database.users.delete(userId);
        database.accounts.delete(userId);
        database.sessions.delete(userId);
        for (const [key, member] of database.memberships) {
          if (member.userId === userId) database.memberships.delete(key);
        }
        for (const key of database.appSettings) {
          if (key.endsWith(`:${userId}`)) database.appSettings.delete(key);
        }
        for (const key of database.dashboardSettings) {
          if (key.endsWith(`:${userId}`)) database.dashboardSettings.delete(key);
        }
        for (const record of database.records.values()) {
          if (record.createdByUserId === userId) record.createdByUserId = null;
        }
        return 1;
      }
    };

    try {
      return await operation(repository);
    } catch (error) {
      if (snapshot) restoreSnapshot(database, snapshot);
      throw error;
    } finally {
      for (const release of releases.reverse()) release();
    }
  };
}

function deleteInput(
  database: FakeDatabase,
  overrides: Partial<Parameters<typeof deleteUserAccount>[0]> = {}
) {
  return {
    actorUserId: "user-1",
    actorClientId: "client-1",
    confirmationText: ACCOUNT_DELETE_CONFIRMATION,
    expectedStateToken: createAccountDeleteStateToken(findHouseholdStates(database, "user-1")),
    transferTargets: {},
    ...overrides
  };
}

test("単独OWNERのグループはCascade相当で全データを削除してからUser・Account・Sessionを削除する", async () => {
  const database = createDatabase();
  addHousehold(database, "household-solo", [{ userId: "user-1", role: "OWNER" }]);
  database.records.set("record-solo", {
    id: "record-solo",
    householdId: "household-solo",
    createdByUserId: "user-1"
  });

  const result = await deleteUserAccount(deleteInput(database), createExecutor(database));
  assert.equal(result.status, "deleted");
  assert.equal(database.households.has("household-solo"), false);
  assert.equal(database.records.has("record-solo"), false);
  assert.equal(database.users.has("user-1"), false);
  assert.equal(database.accounts.has("user-1"), false);
  assert.equal(database.sessions.has("user-1"), false);
  assert.equal(database.appSettings.size, 0);
  assert.equal(database.dashboardSettings.size, 0);
});

test("ほかのOWNERがいる共有グループは対象ユーザーのmembershipと個人設定だけを削除する", async () => {
  const database = createDatabase();
  addHousehold(database, "household-shared", [
    { userId: "user-1", role: "OWNER" },
    { userId: "user-2", role: "OWNER" },
    { userId: "user-3", role: "MEMBER" }
  ]);
  const sharedDataBefore = structuredClone(database.households.get("household-shared")?.data);

  const result = await deleteUserAccount(deleteInput(database), createExecutor(database));
  assert.equal(result.status, "deleted");
  assert.deepEqual(database.households.get("household-shared")?.data, sharedDataBefore);
  assert.equal(database.memberships.has(membershipKey("household-shared", "user-1")), false);
  assert.equal(database.memberships.has(membershipKey("household-shared", "user-2")), true);
  assert.equal(database.memberships.has(membershipKey("household-shared", "user-3")), true);
  assert.equal(database.appSettings.has(membershipKey("household-shared", "user-1")), false);
});

test("唯一OWNERの共有グループは移譲先なしで全体を中断し、指定時は昇格後に退出する", async () => {
  const blocked = createDatabase();
  addHousehold(blocked, "household-transfer", [
    { userId: "user-1", role: "OWNER" },
    { userId: "user-2", role: "VIEWER" }
  ]);
  assert.equal(
    (await deleteUserAccount(deleteInput(blocked), createExecutor(blocked))).status,
    "transferRequired"
  );
  assert.equal(blocked.memberships.get(membershipKey("household-transfer", "user-1"))?.role, "OWNER");

  const database = createDatabase();
  addHousehold(database, "household-transfer", [
    { userId: "user-1", role: "OWNER" },
    { userId: "user-2", role: "VIEWER" }
  ]);
  const result = await deleteUserAccount(
    deleteInput(database, { transferTargets: { "household-transfer": "user-2" } }),
    createExecutor(database)
  );
  assert.equal(result.status, "deleted");
  assert.equal(database.memberships.get(membershipKey("household-transfer", "user-2"))?.role, "OWNER");
  assert.ok(
    database.operationLog.indexOf("promote:household-transfer:user-2") <
      database.operationLog.indexOf("leave:household-transfer:user-1")
  );
  assert.equal(database.households.has("household-transfer"), true);
});

test("複数グループはID順にlockし、単独削除・共有退出・所有権移譲を1回の削除で完了する", async () => {
  const database = createDatabase();
  addHousehold(database, "household-c", [
    { userId: "user-1", role: "OWNER" },
    { userId: "user-4", role: "MEMBER" }
  ]);
  addHousehold(database, "household-a", [{ userId: "user-1", role: "OWNER" }]);
  addHousehold(database, "household-b", [
    { userId: "user-1", role: "MEMBER" },
    { userId: "user-2", role: "OWNER" }
  ]);

  const result = await deleteUserAccount(
    deleteInput(database, { transferTargets: { "household-c": "user-4" } }),
    createExecutor(database)
  );
  assert.equal(result.status, "deleted");
  if (result.status === "deleted") {
    assert.deepEqual(result.deletedHouseholdIds, ["household-a"]);
    assert.equal(result.leftHouseholdCount, 2);
    assert.equal(result.transferredHouseholdCount, 1);
  }
  assert.equal(database.households.has("household-a"), false);
  assert.equal(database.households.has("household-b"), true);
  assert.equal(database.households.has("household-c"), true);
  assert.deepEqual(
    database.operationLog.filter((entry) => entry.startsWith("lock:household:")),
    ["lock:household:household-a", "lock:household:household-b", "lock:household:household-c"]
  );
  assert.ok(database.operationLog.indexOf("lock:user:user-1") < database.operationLog.indexOf("lock:household:household-a"));
  assert.ok(database.operationLog.lastIndexOf("deleteUser:user-1") > database.operationLog.lastIndexOf("leave:"));
});

test("確認文字列が完全一致しなければtransactionへ入らず何も削除しない", async () => {
  const database = createDatabase();
  addHousehold(database, "household-solo", [{ userId: "user-1", role: "OWNER" }]);
  const result = await deleteUserAccount(
    deleteInput(database, { confirmationText: "アカウントを削除 " }),
    createExecutor(database)
  );
  assert.equal(result.status, "confirmationMismatch");
  assert.equal(database.users.has("user-1"), true);
  assert.equal(database.households.has("household-solo"), true);
  assert.deepEqual(database.operationLog, []);
});

test("画面表示後に所属・権限状態が変わると削除全体をロールバックする", async () => {
  const database = createDatabase();
  addHousehold(database, "household-a", [{ userId: "user-1", role: "OWNER" }]);
  addHousehold(database, "household-b", [
    { userId: "user-1", role: "MEMBER" },
    { userId: "user-2", role: "OWNER" }
  ]);
  const staleInput = deleteInput(database);
  database.memberships.get(membershipKey("household-b", "user-2"))!.role = "ADMIN";
  ensureUser(database, "user-3");
  database.memberships.set(membershipKey("household-b", "user-3"), {
    id: "member-household-b:user-3",
    householdId: "household-b",
    userId: "user-3",
    role: "OWNER"
  });

  const result = await deleteUserAccount(staleInput, createExecutor(database));
  assert.equal(result.status, "stateChanged");
  assert.equal(database.households.has("household-a"), true);
  assert.equal(database.users.has("user-1"), true);
  assert.equal(
    [...database.memberships.values()].filter(
      (member) => member.householdId === "household-b" && member.role === "OWNER"
    ).length,
    1
  );
});

test("選択した移譲先が退出済みまたは別グループなら全体を中断する", async () => {
  const database = createDatabase();
  addHousehold(database, "household-transfer", [
    { userId: "user-1", role: "OWNER" },
    { userId: "user-2", role: "MEMBER" },
    { userId: "user-3", role: "MEMBER" }
  ]);
  const staleInput = deleteInput(database, { transferTargets: { "household-transfer": "user-2" } });
  database.memberships.delete(membershipKey("household-transfer", "user-2"));

  const result = await deleteUserAccount(staleInput, createExecutor(database));
  assert.equal(result.status, "transferTargetUnavailable");
  assert.equal(database.users.has("user-1"), true);
  assert.equal(database.memberships.get(membershipKey("household-transfer", "user-1"))?.role, "OWNER");

  const outsiderResult = await deleteUserAccount(
    deleteInput(database, { transferTargets: { "household-transfer": "outsider" } }),
    createExecutor(database)
  );
  assert.equal(outsiderResult.status, "transferTargetUnavailable");
});

test("最後のSUPER_ADMINは拒否し、ほかにSUPER_ADMINがいれば削除できる", async () => {
  const lastAdmin = createDatabase("SUPER_ADMIN");
  assert.equal(
    (await deleteUserAccount(deleteInput(lastAdmin), createExecutor(lastAdmin))).status,
    "lastSuperAdmin"
  );
  assert.equal(lastAdmin.users.has("user-1"), true);

  const database = createDatabase("SUPER_ADMIN");
  ensureUser(database, "user-2", "SUPER_ADMIN");
  assert.equal(
    (await deleteUserAccount(deleteInput(database), createExecutor(database))).status,
    "deleted"
  );
  assert.equal(database.users.has("user-2"), true);
});

test("同じアカウントの二重送信はユーザーlockで直列化され、二重削除しない", async () => {
  const database = createDatabase();
  addHousehold(database, "household-solo", [{ userId: "user-1", role: "OWNER" }]);
  const input = deleteInput(database);
  const execute = createExecutor(database);
  const results = await Promise.all([
    deleteUserAccount(input, execute),
    deleteUserAccount(input, execute)
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["alreadyDeleted", "deleted"]);
  assert.equal(database.operationLog.filter((entry) => entry === "deleteUser:user-1").length, 1);
});

test("単独グループの画像だけをcommit後の削除対象にし、安全性違反と削除失敗を許容する", async () => {
  const database = createDatabase();
  addHousehold(database, "household-solo", [{ userId: "user-1", role: "OWNER" }]);
  addHousehold(database, "household-shared", [
    { userId: "user-1", role: "MEMBER" },
    { userId: "user-2", role: "OWNER" }
  ]);
  const result = await deleteUserAccount(deleteInput(database), createExecutor(database));
  assert.equal(result.status, "deleted");
  if (result.status !== "deleted") return;

  const petRoot = await mkdtemp(join(tmpdir(), "account-delete-pets-"));
  const petRecordRoot = await mkdtemp(join(tmpdir(), "account-delete-pet-records-"));
  for (const householdId of ["household-solo", "household-shared"]) {
    await mkdir(join(petRoot, householdId));
    await mkdir(join(petRecordRoot, householdId));
    await writeFile(join(petRoot, householdId, "image.webp"), householdId);
    await writeFile(join(petRecordRoot, householdId, "image.webp"), householdId);
  }
  for (const householdId of result.deletedHouseholdIds) {
    await deleteHouseholdImageDirectoriesSafely(householdId, {
      deletePetDirectory: (id) => deletePetImageHouseholdDirectory(id, petRoot),
      deletePetRecordDirectory: (id) => deletePetRecordImageHouseholdDirectory(id, petRecordRoot)
    });
  }

  await assert.rejects(readFile(join(petRoot, "household-solo", "image.webp")));
  await assert.rejects(readFile(join(petRecordRoot, "household-solo", "image.webp")));
  assert.equal(await readFile(join(petRoot, "household-shared", "image.webp"), "utf8"), "household-shared");
  assert.equal(await readFile(join(petRecordRoot, "household-shared", "image.webp"), "utf8"), "household-shared");
  await assert.rejects(deletePetImageHouseholdDirectory("../household-shared", petRoot));

  const warnings: string[] = [];
  const cleanup = await deleteHouseholdImageDirectoriesSafely("household-solo", {
    deletePetDirectory: async () => {
      throw new Error("filesystem failure");
    },
    deletePetRecordDirectory: async () => undefined,
    warn: (kind) => warnings.push(kind)
  });
  assert.deepEqual(cleanup.failedKinds, ["pet"]);
  assert.deepEqual(warnings, ["pet"]);
});

test("共有グループの作成者参照はSetNull相当になり、記録自体は残る", async () => {
  const database = createDatabase();
  addHousehold(database, "household-shared", [
    { userId: "user-1", role: "MEMBER" },
    { userId: "user-2", role: "OWNER" }
  ]);
  database.records.set("shared-record", {
    id: "shared-record",
    householdId: "household-shared",
    createdByUserId: "user-1"
  });

  assert.equal(
    (await deleteUserAccount(deleteInput(database), createExecutor(database))).status,
    "deleted"
  );
  assert.equal(database.records.has("shared-record"), true);
  assert.equal(database.records.get("shared-record")?.createdByUserId, null);

  const schema = await readFile(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert.match(schema, /createdBy\s+User\?\s+@relation\("PetRecordCreator"[^\n]+onDelete: SetNull\)/);
  assert.match(schema, /createdBy\s+User\?\s+@relation\("HouseholdInvitationCreator"[^\n]+onDelete: SetNull\)/);
  assert.match(schema, /accounts\s+Account\[\]/);
  assert.match(schema, /sessions\s+Session\[\]/);
  assert.match(schema, /user\s+User\s+@relation\([^\n]+onDelete: Cascade\)/);
});

test("本番処理はユーザーlock、ID順Household lock、既存退出・完全削除、User削除を1 transactionで行う", async () => {
  const accountSource = await readFile(join(process.cwd(), "src/lib/account-delete.ts"), "utf8");
  const actionSource = await readFile(join(process.cwd(), "src/app/actions/account.ts"), "utf8");
  const memberAction = await readFile(join(process.cwd(), "src/app/actions/members.ts"), "utf8");
  assert.match(accountSource, /prisma\.\$transaction/);
  assert.match(accountSource, /lockUser\(input\.actorUserId\)/);
  assert.match(accountSource, /\.sort\(compareIds\)/);
  assert.match(accountSource, /for \(const householdId of householdIds\)/);
  assert.match(accountSource, /deleteSoleOwnerHousehold\(/);
  assert.match(accountSource, /leaveHouseholdMembership\(/);
  assert.match(accountSource, /repository\.deleteUser\(user\.id\)/);
  assert.match(actionSource, /getRequiredSessionUser\(\)/);
  assert.doesNotMatch(actionSource, /formData\.get\("userId"\)/);
  assert.doesNotMatch(actionSource, /getRequiredHouseholdContext/);
  const userLockIndex = memberAction.indexOf("hashtextextended(${user.id}, 0)");
  const householdLockIndex = memberAction.indexOf("hashtextextended(${invitation.householdId}, 0)");
  assert.ok(userLockIndex >= 0 && userLockIndex < householdLockIndex);
});

test("設定・確認UIは確認導線、件数サマリー、グループ別表示、移譲選択、キャンセルを備える", async () => {
  const settingsPage = await readFile(join(process.cwd(), "src/app/(app)/settings/page.tsx"), "utf8");
  const entryForm = await readFile(join(process.cwd(), "src/components/account-delete-entry-form.tsx"), "utf8");
  const deletePage = await readFile(join(process.cwd(), "src/app/(app)/settings/account/delete/page.tsx"), "utf8");
  const deleteForm = await readFile(join(process.cwd(), "src/components/account-delete-form.tsx"), "utf8");
  const loginPage = await readFile(join(process.cwd(), "src/app/(app)/login/page.tsx"), "utf8");
  const authContext = await readFile(join(process.cwd(), "src/lib/auth-context.ts"), "utf8");

  assert.match(settingsPage, /<DashboardSettingsForm[\s\S]+<AccountDeleteEntryForm/);
  assert.match(entryForm, /アカウントの削除/);
  assert.match(entryForm, /取り消しできない操作/);
  assert.match(entryForm, /<form[\s\S]+action="\/settings\/account\/delete"[\s\S]+method="get"/);
  assert.match(entryForm, /削除内容を確認する/);
  assert.doesNotMatch(entryForm, /deleteCurrentUserAccount/);
  assert.match(deletePage, /getRequiredSessionUser\(\)/);
  assert.doesNotMatch(deletePage, /import[^\n]+getRequiredHouseholdContext/);
  assert.match(deleteForm, /削除内容の確認/);
  assert.match(deleteForm, /グループごと削除/);
  assert.match(deleteForm, /グループから退出/);
  assert.match(deleteForm, /オーナー移譲が必要/);
  assert.match(deleteForm, /transferHouseholds\.length > 0/);
  assert.match(deleteForm, /新しいオーナーを選択/);
  assert.match(deleteForm, /（現在：/);
  assert.match(deleteForm, /name={`transferToUserId:\$\{household\.householdId\}`}/);
  assert.match(deleteForm, /confirmationText === ACCOUNT_DELETE_CONFIRMATION/);
  assert.match(deleteForm, /disabled={!enabled \|\| pending}/);
  assert.match(deleteForm, /placeholder={ACCOUNT_DELETE_CONFIRMATION}/);
  assert.match(deleteForm, /表示されている文字と完全に一致した場合のみ削除できます/);
  assert.match(deleteForm, /href="\/settings"/);
  assert.match(deleteForm, /削除をやめる/);
  assert.match(deletePage, /preview\.isLastSuperAdmin\s*\? undefined/);
  assert.match(deletePage, /このアカウントは現在削除できません/);
  assert.equal(deletePage.match(/最後のスーパー管理者/g)?.length, 1);
  assert.match(loginPage, /アカウントの削除が完了しました/);
  assert.match(loginPage, /同じGoogleアカウントで再度ログインした場合は、新しいアカウントとして開始されます/);
  assert.match(authContext, /cookieStore\.delete\(CURRENT_HOUSEHOLD_COOKIE\)/);
  assert.match(authContext, /DOG_CAT_AUTH_SESSION_COOKIE_NAMES/);
});

test("アカウント削除の対応要否は移譲とblockedだけを対象にする", () => {
  const dispositions: AccountDeleteDisposition[] = [
    "deleteHousehold",
    "leaveHousehold",
    "transferOwnership",
    "blocked"
  ];

  assert.deepEqual(dispositions.filter(requiresAccountDeleteAttention), [
    "transferOwnership",
    "blocked"
  ]);
});

test("対応要否フィルターは必要・不要の両方がある場合だけ表示内容を変えられる", () => {
  const canShowFilter = (dispositions: AccountDeleteDisposition[]) => {
    const attentionRequiredCount = dispositions.filter(requiresAccountDeleteAttention).length;
    return attentionRequiredCount > 0 && attentionRequiredCount < dispositions.length;
  };
  const case1: AccountDeleteDisposition[] = [
    "deleteHousehold",
    "deleteHousehold",
    "leaveHousehold",
    "leaveHousehold",
    "leaveHousehold",
    "transferOwnership",
    "transferOwnership"
  ];
  const case2: AccountDeleteDisposition[] = [
    "transferOwnership",
    "blocked",
    "leaveHousehold",
    "leaveHousehold"
  ];

  assert.equal(case1.length, 7);
  assert.equal(case1.filter(requiresAccountDeleteAttention).length, 2);
  assert.equal(canShowFilter(case1), true);
  assert.deepEqual(case2.filter(requiresAccountDeleteAttention), ["transferOwnership", "blocked"]);
  assert.equal(canShowFilter(case2), true);
  assert.equal(canShowFilter(["deleteHousehold", "leaveHousehold"]), false);
  assert.equal(canShowFilter(["transferOwnership", "blocked"]), false);
});

test("確認UIの絞り込みは表示配列だけを切り替え、移譲先と送信項目を保持する", async () => {
  const deleteForm = await readFile(
    join(process.cwd(), "src/components/account-delete-form.tsx"),
    "utf8"
  );

  assert.match(deleteForm, /useState\(false\)/);
  assert.match(deleteForm, /attentionRequiredCount > 0 && attentionRequiredCount < households\.length/);
  assert.match(
    deleteForm,
    /visibleHouseholds = showOnlyAttentionRequired \? attentionRequiredHouseholds : households/
  );
  assert.match(deleteForm, /visibleHouseholds\.map\(\(household\) =>/);
  assert.match(deleteForm, /対応が必要なグループのみ表示（\{attentionRequiredCount\}件）/);
  assert.match(deleteForm, /name={`transferToUserId:\$\{household\.householdId\}`}/);
  assert.doesNotMatch(deleteForm, /setTransferTargets\([^)]*showOnlyAttentionRequired/);
  assert.doesNotMatch(deleteForm, /name="account-delete-attention-filter"/);
});

test("多数のHouseholdがあっても共通ヘッダーが横幅を押し広げない", async () => {
  const appLayout = await readFile(join(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");
  const householdSwitcher = await readFile(
    join(process.cwd(), "src/components/household-switcher.tsx"),
    "utf8"
  );
  const globals = await readFile(join(process.cwd(), "src/app/globals.css"), "utf8");

  assert.match(
    appLayout,
    /className="flex min-w-0 max-w-full flex-wrap items-center gap-3 text-sm text-slate-600"/
  );
  assert.match(householdSwitcher, /className="flex min-w-0 flex-wrap items-center gap-2"/);
  assert.match(householdSwitcher, /max-w-\[min\(100%,18rem\)\]/);
  assert.doesNotMatch(globals, /(?:html|body)[^{]*\{[^}]*overflow-x\s*:\s*hidden/);
});
