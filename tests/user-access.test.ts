import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AppRole, UserAccessActionType, UserAccessStatus } from "@prisma/client";

import {
  isSuspendedUserForSignIn,
  restoreUserAccess,
  suspendUserAccess,
  USER_SUSPENSION_REASON_MAX_LENGTH,
  type UserAccessMutationExecutor,
  type UserAccessMutationRepository
} from "../src/lib/user-access";

type FakeUser = {
  id: string;
  name: string | null;
  email: string | null;
  appRole: AppRole;
  accessStatus: UserAccessStatus;
  suspendedAt: Date | null;
  suspendedByUserId: string | null;
  suspensionReason: string | null;
};

type FakeAction = {
  actionType: UserAccessActionType;
  actorUserId: string;
  targetUserId: string;
  reason: string | null;
  createdAt: Date;
};

function fakeUser(id: string, appRole: AppRole = "USER"): FakeUser {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    appRole,
    accessStatus: "ACTIVE",
    suspendedAt: null,
    suspendedByUserId: null,
    suspensionReason: null
  };
}

function createDatabase() {
  return {
    users: new Map<string, FakeUser>([
      ["super-1", fakeUser("super-1", "SUPER_ADMIN")],
      ["user-1", fakeUser("user-1")]
    ]),
    sessions: new Map<string, string>([
      ["session-1", "user-1"],
      ["session-2", "user-1"],
      ["session-super", "super-1"]
    ]),
    memberships: new Set(["household-1:user-1"]),
    pets: new Set(["pet-1"]),
    records: new Set(["record-1"]),
    actions: [] as FakeAction[]
  };
}

type FakeDatabase = ReturnType<typeof createDatabase>;

function repositoryFor(database: FakeDatabase): UserAccessMutationRepository {
  return {
    lockSuperAdminState: async () => undefined,
    findUser: async (userId) => database.users.get(userId) ?? null,
    countActiveSuperAdmins: async () =>
      [...database.users.values()].filter(
        (user) => user.appRole === "SUPER_ADMIN" && user.accessStatus === "ACTIVE"
      ).length,
    updateAccessStatus: async ({ userId, expectedStatus, nextStatus, ...data }) => {
      const user = database.users.get(userId);
      if (!user || user.accessStatus !== expectedStatus) return false;
      Object.assign(user, { accessStatus: nextStatus, ...data });
      return true;
    },
    deleteSessions: async (userId) => {
      let deleted = 0;
      for (const [sessionId, ownerId] of database.sessions) {
        if (ownerId === userId) {
          database.sessions.delete(sessionId);
          deleted += 1;
        }
      }
      return deleted;
    },
    createAction: async ({ actionType, actor, target, reason, createdAt }) => {
      database.actions.push({
        actionType,
        actorUserId: actor.id,
        targetUserId: target.id,
        reason,
        createdAt
      });
    }
  };
}

function createSerialExecutor(database: FakeDatabase): UserAccessMutationExecutor {
  let tail: Promise<void> = Promise.resolve();
  return async <T>(operation: (repository: UserAccessMutationRepository) => Promise<T>) => {
    const run = tail.then(() => operation(repositoryFor(database)));
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

test("スーパー管理者はデータを削除せず一般ユーザーを停止し、全セッションと履歴を更新できる", async () => {
  const database = createDatabase();
  const before = {
    memberships: [...database.memberships],
    pets: [...database.pets],
    records: [...database.records]
  };

  const result = await suspendUserAccess(
    { actorUserId: "super-1", targetUserId: "user-1", reason: "  不正利用の調査対象  " },
    createSerialExecutor(database)
  );

  assert.equal(result, "suspended");
  assert.equal(database.users.get("user-1")?.accessStatus, "SUSPENDED");
  assert.equal(database.users.get("user-1")?.suspensionReason, "不正利用の調査対象");
  assert.equal(database.users.get("user-1")?.suspendedByUserId, "super-1");
  assert.ok(database.users.get("user-1")?.suspendedAt instanceof Date);
  assert.deepEqual([...database.sessions.values()], ["super-1"]);
  assert.deepEqual({
    memberships: [...database.memberships],
    pets: [...database.pets],
    records: [...database.records]
  }, before);
  assert.deepEqual(database.actions.map(({ actionType, actorUserId, targetUserId, reason }) => ({
    actionType,
    actorUserId,
    targetUserId,
    reason
  })), [{ actionType: "SUSPENDED", actorUserId: "super-1", targetUserId: "user-1", reason: "不正利用の調査対象" }]);
});

test("停止解除で通常状態へ戻り、現在の停止情報を消しても停止・解除履歴は残る", async () => {
  const database = createDatabase();
  const execute = createSerialExecutor(database);
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "運用上の確認が必要" }, execute),
    "suspended"
  );
  assert.equal(
    await restoreUserAccess({ actorUserId: "super-1", targetUserId: "user-1", note: "確認完了" }, execute),
    "restored"
  );

  const user = database.users.get("user-1");
  assert.equal(user?.accessStatus, "ACTIVE");
  assert.equal(user?.suspendedAt, null);
  assert.equal(user?.suspendedByUserId, null);
  assert.equal(user?.suspensionReason, null);
  assert.deepEqual(database.actions.map((action) => [action.actionType, action.reason]), [
    ["SUSPENDED", "運用上の確認が必要"],
    ["RESTORED", "確認完了"]
  ]);
  assert.equal(
    await isSuspendedUserForSignIn(
      { id: "user-1", email: "user-1@example.com" },
      { findFirst: async () => ({ accessStatus: user!.accessStatus }) }
    ),
    false
  );
});

test("一般ユーザーと管理者は停止・解除できない", async () => {
  for (const role of ["USER", "ADMIN"] as const) {
    const database = createDatabase();
    database.users.set("actor", fakeUser("actor", role));
    const execute = createSerialExecutor(database);
    assert.equal(
      await suspendUserAccess({ actorUserId: "actor", targetUserId: "user-1", reason: "権限外操作" }, execute),
      "forbidden"
    );
    database.users.get("user-1")!.accessStatus = "SUSPENDED";
    assert.equal(
      await restoreUserAccess({ actorUserId: "actor", targetUserId: "user-1", note: "" }, execute),
      "forbidden"
    );
  }
});

test("自己停止、最後の利用中スーパー管理者停止、存在しない対象を拒否する", async () => {
  const database = createDatabase();
  const execute = createSerialExecutor(database);
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "super-1", reason: "自己停止要求" }, execute),
    "lastSuperAdmin"
  );
  database.users.set("super-2", fakeUser("super-2", "SUPER_ADMIN"));
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "super-1", reason: "自己停止要求" }, execute),
    "cannotSuspendSelf"
  );
  database.users.get("super-2")!.accessStatus = "SUSPENDED";
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "super-2", reason: "停止中を再停止" }, execute),
    "alreadySuspended"
  );
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "missing", reason: "対象不存在" }, execute),
    "notFound"
  );
});

test("重複停止・重複解除と不正な理由を拒否する", async () => {
  const database = createDatabase();
  const execute = createSerialExecutor(database);
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "   " }, execute),
    "invalidReason"
  );
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "短" }, execute),
    "invalidReason"
  );
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "あ".repeat(USER_SUSPENSION_REASON_MAX_LENGTH + 1) }, execute),
    "invalidReason"
  );
  assert.equal(
    await restoreUserAccess({ actorUserId: "super-1", targetUserId: "user-1", note: "" }, execute),
    "alreadyActive"
  );
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "停止理由です" }, execute),
    "suspended"
  );
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "別の停止理由" }, execute),
    "alreadySuspended"
  );
});

test("同一ユーザーの同時停止は1件だけ成功する", async () => {
  const database = createDatabase();
  const execute = createSerialExecutor(database);
  const results = await Promise.all([
    suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "同時停止その一" }, execute),
    suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "同時停止その二" }, execute)
  ]);
  assert.deepEqual(results.sort(), ["alreadySuspended", "suspended"]);
  assert.equal(database.actions.length, 1);
});

test("停止と解除の競合は直列化され、履歴と最終状態が一致する", async () => {
  const database = createDatabase();
  const execute = createSerialExecutor(database);
  const results = await Promise.all([
    suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "競合確認の停止" }, execute),
    restoreUserAccess({ actorUserId: "super-1", targetUserId: "user-1", note: "競合確認の解除" }, execute)
  ]);
  assert.deepEqual(results, ["suspended", "restored"]);
  assert.equal(database.users.get("user-1")?.accessStatus, "ACTIVE");
  assert.deepEqual(database.actions.map((action) => action.actionType), ["SUSPENDED", "RESTORED"]);
});

test("複数スーパー管理者の同時停止でも利用中の最後の1人が残る", async () => {
  const database = createDatabase();
  database.users.set("super-2", fakeUser("super-2", "SUPER_ADMIN"));
  database.users.set("super-3", fakeUser("super-3", "SUPER_ADMIN"));
  database.users.set("super-4", fakeUser("super-4", "SUPER_ADMIN"));
  const execute = createSerialExecutor(database);
  const results = await Promise.all(
    ["super-2", "super-3", "super-4"].map((targetUserId) =>
      suspendUserAccess({ actorUserId: "super-1", targetUserId, reason: `管理者停止 ${targetUserId}` }, execute)
    )
  );
  assert.deepEqual(results.sort(), ["suspended", "suspended", "suspended"]);
  assert.equal(
    [...database.users.values()].filter((user) => user.appRole === "SUPER_ADMIN" && user.accessStatus === "ACTIVE").length,
    1
  );
  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "super-1", reason: "最後の管理者" }, execute),
    "lastSuperAdmin"
  );
});

test("条件付き更新時に状態が変わっていれば履歴とセッションを変更せず競合を返す", async () => {
  const database = createDatabase();
  const execute: UserAccessMutationExecutor = (operation) => {
    const repository = repositoryFor(database);
    return operation({
      ...repository,
      updateAccessStatus: async () => false
    });
  };

  assert.equal(
    await suspendUserAccess({ actorUserId: "super-1", targetUserId: "user-1", reason: "競合時の停止理由" }, execute),
    "stateChanged"
  );
  assert.equal(database.users.get("user-1")?.accessStatus, "ACTIVE");
  assert.equal(database.sessions.size, 3);
  assert.equal(database.actions.length, 0);
});

test("別々のスーパー管理者による相互停止は一方だけ成功し、最後の利用中管理者が残る", async () => {
  const database = createDatabase();
  database.users.set("super-2", fakeUser("super-2", "SUPER_ADMIN"));
  const execute = createSerialExecutor(database);

  const results = await Promise.all([
    suspendUserAccess({ actorUserId: "super-1", targetUserId: "super-2", reason: "相互停止その一" }, execute),
    suspendUserAccess({ actorUserId: "super-2", targetUserId: "super-1", reason: "相互停止その二" }, execute)
  ]);

  assert.deepEqual(results, ["suspended", "forbidden"]);
  assert.equal(
    [...database.users.values()].filter((user) => user.appRole === "SUPER_ADMIN" && user.accessStatus === "ACTIVE").length,
    1
  );
});

test("GoogleアカウントIDまたはメールが停止ユーザーに一致すればログインを拒否する", async () => {
  let capturedWhere: unknown;
  const suspendedReader = {
    findFirst: async (args: { where?: unknown }) => {
      capturedWhere = args.where;
      return { accessStatus: "SUSPENDED" as const };
    }
  };
  assert.equal(
    await isSuspendedUserForSignIn({ id: "user-1", email: "user-1@example.com" }, suspendedReader),
    true
  );
  assert.deepEqual(capturedWhere, { OR: [{ id: "user-1" }, { email: "user-1@example.com" }] });
  assert.equal(await isSuspendedUserForSignIn({}, suspendedReader), false);
});

test("本番実装は認証・セッション・履歴・確認UIを多層で保護する", async () => {
  const [authSource, authContext, proxySource, actionSource, controlsSource, loginSource, schema, migration] =
    await Promise.all([
      readFile("src/auth.ts", "utf8"),
      readFile("src/lib/auth-context.ts", "utf8"),
      readFile("src/proxy.ts", "utf8"),
      readFile("src/app/actions/admin.ts", "utf8"),
      readFile("src/components/admin-user-access-controls.tsx", "utf8"),
      readFile("src/app/(app)/login/page.tsx", "utf8"),
      readFile("prisma/schema.prisma", "utf8"),
      readFile("prisma/migrations/20260722130000_add_user_access_suspension/migration.sql", "utf8")
    ]);

  assert.match(authSource, /isSuspendedUserForSignIn/);
  assert.match(authSource, /getSessionAndUser/);
  assert.match(authSource, /prisma\.session\.deleteMany/);
  assert.match(authContext, /accessStatus === "SUSPENDED"/);
  assert.match(proxySource, /accountSuspended/);
  assert.match(actionSource, /getRequiredAppAdminUser\(\["SUPER_ADMIN"\]\)/);
  assert.match(actionSource, /actor\.appRole !== "SUPER_ADMIN" \|\| actor\.accessStatus !== "ACTIVE"/);
  assert.match(controlsSource, /アカウントや飼育データ、共有グループは削除されません/);
  assert.match(controlsSource, /現在の全セッションが無効化/);
  assert.match(controlsSource, /required/);
  assert.match(controlsSource, /role="dialog"/);
  assert.match(loginSource, /このアカウントは現在利用を停止されています/);
  assert.doesNotMatch(loginSource, /suspensionReason/);
  assert.match(schema, /enum UserAccessStatus[\s\S]*ACTIVE[\s\S]*SUSPENDED/);
  assert.match(schema, /model UserAccessAction/);
  assert.match(migration, /ON DELETE SET NULL/);
});
