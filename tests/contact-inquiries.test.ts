import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  AppRole,
  ContactInquiryCategory,
  ContactInquiryStatus,
  ContactSenderType,
  UserAccessStatus
} from "@prisma/client";

import {
  CONTACT_BODY_MAX_LENGTH,
  CONTACT_CREATION_WINDOW_LIMIT,
  CONTACT_INQUIRY_PAGE_SIZE,
  CONTACT_OPEN_INQUIRY_LIMIT,
  canTransitionContactStatus,
  createContactInquirySchema,
  createContactPublicId,
  isSafeContactSourcePath,
  normalizeContactPage,
  parseAdminInquiryQuery,
  parseInitialErrorId,
  parseInitialSourcePath,
  isPublicContactId,
  statusAfterUserReply
} from "../src/lib/contact-inquiry-core";
import {
  addUserContactReply,
  createContactInquiry,
  updateContactInquiryByAdmin,
  type ContactInquiryMutationExecutor,
  type ContactInquiryMutationRepository
} from "../src/lib/contact-inquiry-mutations";
import {
  createAdminInquiryWhere,
  getAdminContactInquiryPage,
  getUserContactInquiryPage
} from "../src/lib/contact-inquiry-queries";
import {
  canViewContactInquiryRealtime,
  getContactRealtimeLookup
} from "../src/lib/contact-realtime-access";
import { decideContactRealtimeChange } from "../src/lib/contact-realtime-client";
import { publishContactInquiryChangeSafely } from "../src/lib/contact-realtime";

type FakeUser = {
  id: string;
  name: string | null;
  email: string | null;
  appRole: AppRole;
  accessStatus: UserAccessStatus;
};
type FakeMessage = {
  id: string;
  inquiryId: string;
  senderType: ContactSenderType;
  senderUserIdSnapshot: string;
  senderNameSnapshot: string;
  body: string;
  createdAt: Date;
};
type FakeInquiry = {
  id: string;
  publicId: string;
  userId: string | null;
  userIdSnapshot: string;
  userNameSnapshot: string;
  userEmailSnapshot: string | null;
  category: ContactInquiryCategory;
  subject: string;
  status: ContactInquiryStatus;
  assignedAdminUserId: string | null;
  assignedAdminNameSnapshot: string | null;
  realtimeRevision: number;
  realtimeActorClientId: string | null;
  realtimeActorUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
type FakeDatabase = {
  users: Map<string, FakeUser>;
  inquiries: FakeInquiry[];
  messages: FakeMessage[];
  lockTails: Map<string, Promise<void>>;
  nextId: number;
  failNextUpdate: boolean;
  failNextMessage: boolean;
  failNextRevision: boolean;
};

function createDatabase(): FakeDatabase {
  return {
    users: new Map([
      ["user-1", { id: "user-1", name: "利用者一", email: "user@example.com", appRole: "USER", accessStatus: "ACTIVE" }],
      ["user-2", { id: "user-2", name: "利用者二", email: "other@example.com", appRole: "USER", accessStatus: "ACTIVE" }],
      ["admin-1", { id: "admin-1", name: "管理者", email: "admin@example.com", appRole: "ADMIN", accessStatus: "ACTIVE" }],
      ["super-1", { id: "super-1", name: "スーパー管理者", email: null, appRole: "SUPER_ADMIN", accessStatus: "ACTIVE" }]
    ]),
    inquiries: [],
    messages: [],
    lockTails: new Map(),
    nextId: 1,
    failNextUpdate: false,
    failNextMessage: false,
    failNextRevision: false
  };
}

function createExecutor(database: FakeDatabase): ContactInquiryMutationExecutor {
  return async (operation) => {
    const inquirySnapshot = database.inquiries.map((inquiry) => ({ ...inquiry }));
    const messageSnapshot = database.messages.map((message) => ({ ...message }));
    const nextIdSnapshot = database.nextId;
    const releases: Array<() => void> = [];
    const repository: ContactInquiryMutationRepository = {
      lock: async (key) => {
        const previous = database.lockTails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
          release = resolve;
        });
        database.lockTails.set(key, previous.then(() => current));
        await previous;
        releases.push(release);
      },
      findUser: async (id) => database.users.get(id) ?? null,
      findLatestInquiryCreatedByUser: async (userId) =>
        database.inquiries
          .filter((inquiry) => inquiry.userId === userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdAt ?? null,
      countInquiriesCreatedByUserSince: async (userId, since) =>
        database.inquiries.filter(
          (inquiry) => inquiry.userId === userId && inquiry.createdAt >= since
        ).length,
      findOldestInquiryCreatedByUserSince: async (userId, since) =>
        database.inquiries
          .filter((inquiry) => inquiry.userId === userId && inquiry.createdAt >= since)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt ?? null,
      countOpenInquiriesByUser: async (userId) =>
        database.inquiries.filter((inquiry) => inquiry.userId === userId && inquiry.status !== "CLOSED").length,
      createInquiry: async (input) => {
        const inquiry: FakeInquiry = {
          id: `inquiry-${database.nextId++}`,
          publicId: input.publicId,
          userId: input.actor.id,
          userIdSnapshot: input.actor.id,
          userNameSnapshot: input.actor.name || input.actor.email || "名前未設定",
          userEmailSnapshot: input.actor.email,
          category: input.category,
          subject: input.subject,
          status: "OPEN",
          assignedAdminUserId: null,
          assignedAdminNameSnapshot: null,
          realtimeRevision: 0,
          realtimeActorClientId: null,
          realtimeActorUserId: null,
          createdAt: input.now,
          updatedAt: input.now
        };
        database.inquiries.push(inquiry);
        database.messages.push({
          id: `message-${database.nextId++}`,
          inquiryId: inquiry.id,
          senderType: "USER",
          senderUserIdSnapshot: input.actor.id,
          senderNameSnapshot: inquiry.userNameSnapshot,
          body: input.body,
          createdAt: input.now
        });
        return {
          publicId: inquiry.publicId,
          category: inquiry.category,
          subject: inquiry.subject,
          status: inquiry.status,
          createdAt: inquiry.createdAt
        };
      },
      findInquiryForUser: async (publicId, userId) => {
        const inquiry = database.inquiries.find((item) => item.publicId === publicId && item.userId === userId);
        return inquiry
          ? {
              id: inquiry.id,
              publicId: inquiry.publicId,
              userId: inquiry.userId,
              status: inquiry.status,
              assignedAdminUserId: inquiry.assignedAdminUserId,
              assignedAdminNameSnapshot: inquiry.assignedAdminNameSnapshot
            }
          : null;
      },
      findInquiryForAdmin: async (publicId) => {
        const inquiry = database.inquiries.find((item) => item.publicId === publicId);
        return inquiry
          ? {
              id: inquiry.id,
              publicId: inquiry.publicId,
              userId: inquiry.userId,
              status: inquiry.status,
              assignedAdminUserId: inquiry.assignedAdminUserId,
              assignedAdminNameSnapshot: inquiry.assignedAdminNameSnapshot
            }
          : null;
      },
      findLatestMessageAt: async (inquiryId, senderType) =>
        database.messages
          .filter((message) => message.inquiryId === inquiryId && message.senderType === senderType)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdAt ?? null,
      createMessage: async ({ inquiryId, senderType, actor, body, now }) => {
        if (database.failNextMessage) {
          database.failNextMessage = false;
          throw new Error("message create failed");
        }
        database.messages.push({
          id: `message-${database.nextId++}`,
          inquiryId,
          senderType,
          senderUserIdSnapshot: actor.id,
          senderNameSnapshot: actor.name || actor.email || "名前未設定",
          body,
          createdAt: now
        });
      },
      updateInquiry: async ({ inquiry, status, assignedAdminUserId, assignedAdminNameSnapshot, now }) => {
        if (database.failNextUpdate) {
          database.failNextUpdate = false;
          return false;
        }
        const stored = database.inquiries.find((item) => item.id === inquiry.id && item.status === inquiry.status);
        if (!stored) return false;
        stored.status = status;
        stored.assignedAdminUserId = assignedAdminUserId;
        stored.assignedAdminNameSnapshot = assignedAdminNameSnapshot;
        stored.updatedAt = now;
        return true;
      },
      updateRealtimeRevision: async ({
        inquiry,
        source,
        actorClientId,
        actorUserId,
        now
      }) => {
        if (database.failNextRevision) {
          database.failNextRevision = false;
          throw new Error("revision update failed");
        }
        const stored = database.inquiries.find((item) => item.id === inquiry.id);
        if (!stored) throw new Error("inquiry not found");
        stored.realtimeRevision += 1;
        stored.realtimeActorClientId = actorClientId;
        stored.realtimeActorUserId = actorUserId;
        stored.updatedAt = now;
        return {
          publicId: stored.publicId,
          source,
          actorClientId,
          actorUserId,
          revision: String(stored.realtimeRevision)
        };
      }
    };
    try {
      return await operation(repository);
    } catch (error) {
      database.inquiries.splice(
        0,
        database.inquiries.length,
        ...inquirySnapshot.map((inquiry) => ({ ...inquiry }))
      );
      database.messages.splice(
        0,
        database.messages.length,
        ...messageSnapshot.map((message) => ({ ...message }))
      );
      database.nextId = nextIdSnapshot;
      throw error;
    } finally {
      for (const release of releases.reverse()) release();
    }
  };
}

async function seedInquiry(database: FakeDatabase, now = new Date("2026-07-24T00:00:00Z")) {
  const result = await createContactInquiry(
    {
      actorUserId: "user-1",
      category: "BUG",
      subject: "保存できません",
      body: "保存ボタンを押しても完了しません。",
      errorId: null,
      sourcePath: "/settings",
      now
    },
    createExecutor(database)
  );
  assert.equal(result.status, "created");
  if (result.status !== "created") throw new Error("seed failed");
  return database.inquiries[0];
}

test("問い合わせ作成入力はtrim、文字数、enum、内部パスを検証する", () => {
  const valid = createContactInquirySchema.safeParse({
    category: "HOW_TO",
    subject: "  使い方  ",
    body: "  これは十分な長さの問い合わせ本文です。  ",
    errorId: "CLIENT-abc_123",
    sourcePath: "/settings?tab=profile"
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.subject, "使い方");
    assert.equal(valid.data.sourcePath, "/settings?tab=profile");
  }
  assert.equal(createContactInquirySchema.safeParse({ category: "INVALID", subject: "件名", body: "十分な長さの本文です。", errorId: "", sourcePath: "" }).success, false);
  assert.equal(createContactInquirySchema.safeParse({ category: "BUG", subject: "   ", body: "十分な長さの本文です。", errorId: "", sourcePath: "" }).success, false);
  assert.equal(createContactInquirySchema.safeParse({ category: "BUG", subject: "件名", body: "短い", errorId: "", sourcePath: "" }).success, false);
  assert.equal(createContactInquirySchema.safeParse({ category: "BUG", subject: "件名", body: "あ".repeat(CONTACT_BODY_MAX_LENGTH + 1), errorId: "", sourcePath: "" }).success, false);
  assert.equal(createContactInquirySchema.safeParse({ category: "BUG", subject: "あ".repeat(101), body: "十分な長さの本文です。", errorId: "", sourcePath: "" }).success, false);
});

test("発生画面はアプリ内相対パスだけを許可し、URL初期値もサーバー検証する", () => {
  for (const value of ["/", "/contact/abc", "/settings?tab=x#part"]) assert.equal(isSafeContactSourcePath(value), true);
  for (const value of ["https://example.com", "//example.com", "\\\\example.com", "settings", "/path\nnext"]) {
    assert.equal(isSafeContactSourcePath(value), false);
  }
  assert.equal(parseInitialSourcePath("https://example.com"), "");
  assert.equal(parseInitialSourcePath("/records"), "/records");
  assert.equal(parseInitialErrorId("<script>"), "");
  assert.equal(parseInitialErrorId("CLIENT-123456"), "CLIENT-123456");
});

test("公開問い合わせ番号はJST日付と安全なランダム値で内部IDを露出しない", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => createContactPublicId(new Date("2026-07-23T15:00:00Z"))));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^HMB-20260724-[A-F0-9]{10}$/);
});

test("本体と初回メッセージを同じmutation executor内で作成し、フォーム由来User IDを使わない", async () => {
  const database = createDatabase();
  const inquiry = await seedInquiry(database);
  assert.equal(database.inquiries.length, 1);
  assert.equal(database.messages.length, 1);
  assert.equal(inquiry.userId, "user-1");
  assert.equal(inquiry.userIdSnapshot, "user-1");
  assert.equal(inquiry.userNameSnapshot, "利用者一");
  assert.equal(inquiry.userEmailSnapshot, "user@example.com");
  assert.equal(database.messages[0].senderUserIdSnapshot, "user-1");
});

test("停止・削除済み相当のセッション利用者は問い合わせを作成できない", async () => {
  const database = createDatabase();
  database.users.get("user-1")!.accessStatus = "SUSPENDED";
  const result = await createContactInquiry(
    { actorUserId: "user-1", category: "BUG", subject: "件名", body: "十分な長さの問い合わせ本文です。", errorId: null, sourcePath: null },
    createExecutor(database)
  );
  assert.equal(result.status, "forbidden");
  assert.equal(database.inquiries.length, 0);
});

test("30秒制限、1時間5件、未終了10件の作成上限が動作する", async () => {
  const cooldownDb = createDatabase();
  await seedInquiry(cooldownDb, new Date("2026-07-24T00:00:00Z"));
  const cooldown = await createContactInquiry(
    { actorUserId: "user-1", category: "BUG", subject: "二件目", body: "二件目の十分な長さの本文です。", errorId: null, sourcePath: null, now: new Date("2026-07-24T00:00:29Z") },
    createExecutor(cooldownDb)
  );
  assert.deepEqual(cooldown.status === "limited" ? cooldown.code : null, "cooldown");

  const hourlyDb = createDatabase();
  for (let i = 0; i < CONTACT_CREATION_WINDOW_LIMIT; i += 1) {
    const inquiry = await seedInquiry(hourlyDb, new Date(Date.UTC(2026, 6, 24, 1, i * 2)));
    inquiry.status = "CLOSED";
  }
  const hourly = await createContactInquiry(
    { actorUserId: "user-1", category: "BUG", subject: "上限", body: "上限確認用の十分な本文です。", errorId: null, sourcePath: null, now: new Date("2026-07-24T01:20:00Z") },
    createExecutor(hourlyDb)
  );
  assert.deepEqual(hourly.status === "limited" ? hourly.code : null, "hourlyLimit");

  const openDb = createDatabase();
  for (let i = 0; i < CONTACT_OPEN_INQUIRY_LIMIT; i += 1) {
    await seedInquiry(openDb, new Date(Date.UTC(2026, 6, 23, i, 0)));
  }
  const openLimit = await createContactInquiry(
    { actorUserId: "user-1", category: "BUG", subject: "未終了上限", body: "未終了上限を確認する本文です。", errorId: null, sourcePath: null, now: new Date("2026-07-24T12:00:00Z") },
    createExecutor(openDb)
  );
  assert.deepEqual(openLimit.status === "limited" ? openLimit.code : null, "openLimit");
});

test("同時作成でもユーザーadvisory lock相当で上限を突破しない", async () => {
  const database = createDatabase();
  const execute = createExecutor(database);
  const now = new Date("2026-07-24T05:00:00Z");
  const results = await Promise.all([
    createContactInquiry({ actorUserId: "user-1", category: "BUG", subject: "同時1", body: "同時送信を確認する十分な本文です。", errorId: null, sourcePath: null, now }, execute),
    createContactInquiry({ actorUserId: "user-1", category: "BUG", subject: "同時2", body: "同時送信を確認する十分な本文です。", errorId: null, sourcePath: null, now }, execute)
  ]);
  assert.equal(results.filter((result) => result.status === "created").length, 1);
  assert.equal(results.filter((result) => result.status === "limited").length, 1);
  assert.equal(database.inquiries.length, 1);
  assert.equal(database.messages.length, 1);
});

test("利用者は自分の問い合わせだけへ返信し、回答待ち・対応済みから確認中へ戻す", async () => {
  const database = createDatabase();
  const inquiry = await seedInquiry(database);
  inquiry.status = "WAITING_FOR_USER";
  const result = await addUserContactReply(
    {
      actorUserId: "user-1",
      actorClientId: "client-user-tab-1",
      publicId: inquiry.publicId,
      body: "追加情報を返信します。",
      now: new Date("2026-07-24T00:00:11Z")
    },
    createExecutor(database)
  );
  assert.equal(result.status, "replied");
  if (result.status !== "replied") throw new Error("reply failed");
  assert.equal(result.nextStatus, "IN_PROGRESS");
  assert.equal(result.change.revision, "1");
  assert.equal(result.change.actorClientId, "client-user-tab-1");
  assert.equal(inquiry.status, "IN_PROGRESS");
  assert.equal(inquiry.realtimeRevision, 1);
  assert.equal(inquiry.realtimeActorClientId, "client-user-tab-1");
  assert.equal(inquiry.realtimeActorUserId, "user-1");
  assert.equal(database.messages.at(-1)?.senderType, "USER");

  const other = await addUserContactReply(
    { actorUserId: "user-2", publicId: inquiry.publicId, body: "他人からの返信です。", now: new Date("2026-07-24T00:00:30Z") },
    createExecutor(database)
  );
  assert.equal(other.status, "notFound");
});

test("終了済みと連続10秒未満の利用者返信を拒否する", async () => {
  const database = createDatabase();
  const inquiry = await seedInquiry(database);
  const limited = await addUserContactReply(
    { actorUserId: "user-1", publicId: inquiry.publicId, body: "早すぎる追加返信です。", now: new Date("2026-07-24T00:00:09Z") },
    createExecutor(database)
  );
  assert.equal(limited.status, "limited");
  inquiry.status = "CLOSED";
  const closed = await addUserContactReply(
    { actorUserId: "user-1", publicId: inquiry.publicId, body: "終了後の返信です。", now: new Date("2026-07-24T00:01:00Z") },
    createExecutor(database)
  );
  assert.equal(closed.status, "closed");
});

test("状態更新に失敗した場合は返信メッセージを作成しない", async () => {
  const database = createDatabase();
  const inquiry = await seedInquiry(database);
  database.failNextUpdate = true;
  const before = database.messages.length;
  const result = await addUserContactReply(
    { actorUserId: "user-1", publicId: inquiry.publicId, body: "競合時の返信本文です。", now: new Date("2026-07-24T00:00:11Z") },
    createExecutor(database)
  );
  assert.equal(result.status, "stateChanged");
  assert.equal(database.messages.length, before);
});

test("管理者とスーパー管理者は返信・状態・担当者を同時更新し、通常ユーザーは拒否する", async () => {
  const database = createDatabase();
  const inquiry = await seedInquiry(database);
  const updated = await updateContactInquiryByAdmin(
    {
      actorUserId: "admin-1",
      actorClientId: "client-admin-tab-1",
      publicId: inquiry.publicId,
      body: "サポート担当からの返信です。",
      nextStatus: "WAITING_FOR_USER",
      assignedAdminUserId: null,
      now: new Date("2026-07-24T00:01:00Z")
    },
    createExecutor(database)
  );
  assert.equal(updated.status, "updated");
  if (updated.status !== "updated") throw new Error("admin update failed");
  assert.equal(updated.nextStatus, "WAITING_FOR_USER");
  assert.equal(updated.change.revision, "1");
  assert.equal(updated.change.actorClientId, "client-admin-tab-1");
  assert.equal(inquiry.assignedAdminUserId, "admin-1");
  assert.equal(inquiry.assignedAdminNameSnapshot, "管理者");
  assert.equal(inquiry.realtimeRevision, 1);
  assert.equal(database.messages.at(-1)?.senderType, "ADMIN");

  const forbidden = await updateContactInquiryByAdmin(
    { actorUserId: "user-1", publicId: inquiry.publicId, body: null, nextStatus: "RESOLVED", assignedAdminUserId: null },
    createExecutor(database)
  );
  assert.equal(forbidden.status, "forbidden");
});

test("通常ユーザー・停止管理者を担当者にできず、不正な状態遷移と終了後更新を拒否する", async () => {
  const database = createDatabase();
  const inquiry = await seedInquiry(database);
  assert.equal(
    (await updateContactInquiryByAdmin(
      { actorUserId: "admin-1", publicId: inquiry.publicId, body: null, nextStatus: "IN_PROGRESS", assignedAdminUserId: "user-2" },
      createExecutor(database)
    )).status,
    "invalidAssignee"
  );
  inquiry.status = "RESOLVED";
  assert.equal(
    (await updateContactInquiryByAdmin(
      { actorUserId: "admin-1", publicId: inquiry.publicId, body: null, nextStatus: "WAITING_FOR_USER", assignedAdminUserId: null },
      createExecutor(database)
    )).status,
    "invalidTransition"
  );
  inquiry.status = "CLOSED";
  assert.equal(
    (await updateContactInquiryByAdmin(
      { actorUserId: "super-1", publicId: inquiry.publicId, body: "終了後返信", nextStatus: "CLOSED", assignedAdminUserId: null },
      createExecutor(database)
    )).status,
    "closed"
  );
});

test("管理者の状態だけ・担当者だけの変更でも問い合わせrevisionを増加する", async () => {
  const statusDatabase = createDatabase();
  const statusInquiry = await seedInquiry(statusDatabase);
  const statusResult = await updateContactInquiryByAdmin(
    {
      actorUserId: "admin-1",
      actorClientId: "client-admin-status",
      publicId: statusInquiry.publicId,
      body: null,
      nextStatus: "IN_PROGRESS",
      assignedAdminUserId: null,
      now: new Date("2026-07-24T00:01:00Z")
    },
    createExecutor(statusDatabase)
  );
  assert.equal(statusResult.status, "updated");
  if (statusResult.status !== "updated") throw new Error("status update failed");
  assert.equal(statusResult.change.source, "status");
  assert.equal(statusResult.change.revision, "1");
  assert.equal(statusDatabase.inquiries[0].realtimeRevision, 1);

  const assigneeDatabase = createDatabase();
  const assigneeInquiry = await seedInquiry(assigneeDatabase);
  assigneeInquiry.status = "IN_PROGRESS";
  const assigneeResult = await updateContactInquiryByAdmin(
    {
      actorUserId: "admin-1",
      actorClientId: "client-admin-assignee",
      publicId: assigneeInquiry.publicId,
      body: null,
      nextStatus: "IN_PROGRESS",
      assignedAdminUserId: "super-1",
      now: new Date("2026-07-24T00:01:00Z")
    },
    createExecutor(assigneeDatabase)
  );
  assert.equal(assigneeResult.status, "updated");
  if (assigneeResult.status !== "updated") throw new Error("assignee update failed");
  assert.equal(assigneeResult.change.source, "assignee");
  assert.equal(assigneeResult.change.revision, "1");
  assert.equal(assigneeDatabase.inquiries[0].assignedAdminUserId, "super-1");
  assert.equal(assigneeDatabase.inquiries[0].realtimeRevision, 1);
});

test("メッセージ保存またはrevision更新失敗時は同一transactionの変更を残さない", async () => {
  const messageDatabase = createDatabase();
  const messageInquiry = await seedInquiry(messageDatabase);
  const messageCount = messageDatabase.messages.length;
  messageDatabase.failNextMessage = true;
  await assert.rejects(
    addUserContactReply(
      {
        actorUserId: "user-1",
        actorClientId: "client-user-failure",
        publicId: messageInquiry.publicId,
        body: "保存失敗を確認する返信です。",
        now: new Date("2026-07-24T00:00:11Z")
      },
      createExecutor(messageDatabase)
    ),
    /message create failed/
  );
  assert.equal(messageDatabase.messages.length, messageCount);
  assert.equal(messageDatabase.inquiries[0].realtimeRevision, 0);
  assert.equal(messageDatabase.inquiries[0].status, "OPEN");

  const revisionDatabase = createDatabase();
  const revisionInquiry = await seedInquiry(revisionDatabase);
  const revisionMessageCount = revisionDatabase.messages.length;
  revisionDatabase.failNextRevision = true;
  await assert.rejects(
    addUserContactReply(
      {
        actorUserId: "user-1",
        actorClientId: "client-user-revision-failure",
        publicId: revisionInquiry.publicId,
        body: "revision失敗を確認する返信です。",
        now: new Date("2026-07-24T00:00:11Z")
      },
      createExecutor(revisionDatabase)
    ),
    /revision update failed/
  );
  assert.equal(revisionDatabase.messages.length, revisionMessageCount);
  assert.equal(revisionDatabase.inquiries[0].realtimeRevision, 0);
  assert.equal(revisionDatabase.inquiries[0].status, "OPEN");
});

test("問い合わせSSE通知失敗はcommit済みの業務結果を失敗扱いにしない", () => {
  const result = publishContactInquiryChangeSafely(
    {
      publicId: "HMB-20260724-A000000001",
      source: "user-reply",
      actorClientId: "client-user-1",
      actorUserId: "user-1",
      revision: "1"
    },
    () => {
      throw new Error("SSE failed");
    },
    () => "00000000-0000-4000-8000-000000000000"
  );
  assert.equal(result, false);
});

test("問い合わせリアルタイム認可は所有者と管理者だけを許可し不正な公開番号を拒否する", () => {
  const publicId = "HMB-20260724-A000000001";
  const user = { id: "user-1", appRole: "USER", accessStatus: "ACTIVE" } as const;
  const otherUser = { id: "user-2", appRole: "USER", accessStatus: "ACTIVE" } as const;
  const admin = { id: "admin-1", appRole: "ADMIN", accessStatus: "ACTIVE" } as const;
  const suspendedAdmin = {
    id: "admin-1",
    appRole: "ADMIN",
    accessStatus: "SUSPENDED"
  } as const;

  assert.equal(isPublicContactId(publicId), true);
  assert.equal(isPublicContactId("HMB-invalid"), false);
  assert.equal(canViewContactInquiryRealtime(user, { userId: "user-1" }), true);
  assert.equal(canViewContactInquiryRealtime(otherUser, { userId: "user-1" }), false);
  assert.equal(canViewContactInquiryRealtime(admin, { userId: "user-1" }), true);
  assert.equal(canViewContactInquiryRealtime(suspendedAdmin, { userId: "user-1" }), false);
  assert.deepEqual(getContactRealtimeLookup(publicId, user), {
    publicId,
    userId: "user-1"
  });
  assert.deepEqual(getContactRealtimeLookup(publicId, admin), { publicId });
  assert.equal(getContactRealtimeLookup("invalid", admin), null);
  assert.equal(getContactRealtimeLookup(publicId, suspendedAdmin), null);
});

test("問い合わせ更新はクライアントIDで自己更新と別タブ更新を区別する", () => {
  assert.equal(
    decideContactRealtimeChange({
      currentRevision: "1",
      nextRevision: "2",
      actorClientId: "tab-1",
      currentClientId: "tab-1"
    }),
    "self"
  );
  assert.equal(
    decideContactRealtimeChange({
      currentRevision: "1",
      nextRevision: "2",
      actorClientId: "tab-1",
      currentClientId: "tab-2"
    }),
    "remote"
  );
  assert.equal(
    decideContactRealtimeChange({
      currentRevision: "2",
      nextRevision: "2",
      actorClientId: "tab-1",
      currentClientId: "tab-2"
    }),
    "stale"
  );
  assert.equal(
    decideContactRealtimeChange({
      currentRevision: "2",
      nextRevision: "not-a-number",
      actorClientId: null,
      currentClientId: "tab-2"
    }),
    "invalid"
  );
});

test("状態遷移ルールを一箇所で管理する", () => {
  assert.equal(canTransitionContactStatus("OPEN", "IN_PROGRESS"), true);
  assert.equal(canTransitionContactStatus("RESOLVED", "WAITING_FOR_USER"), false);
  assert.equal(canTransitionContactStatus("CLOSED", "IN_PROGRESS"), false);
  assert.equal(statusAfterUserReply("WAITING_FOR_USER"), "IN_PROGRESS");
  assert.equal(statusAfterUserReply("RESOLVED"), "IN_PROGRESS");
  assert.equal(statusAfterUserReply("CLOSED"), null);
});

test("利用者一覧はUser条件、DB側20件ページング、更新日時とIDの安定順を使う", async () => {
  let countArgs: Record<string, unknown> | undefined;
  let findArgs: Record<string, unknown> | undefined;
  const result = await getUserContactInquiryPage("user-1", 99, {
    count: async (args) => {
      countArgs = args;
      return 45;
    },
    findMany: async (args) => {
      findArgs = args;
      return [];
    }
  });
  assert.equal(CONTACT_INQUIRY_PAGE_SIZE, 20);
  assert.deepEqual(countArgs?.where, { userId: "user-1" });
  assert.deepEqual(findArgs?.where, { userId: "user-1" });
  assert.equal(findArgs?.skip, 40);
  assert.equal(findArgs?.take, 20);
  assert.deepEqual(findArgs?.orderBy, [{ updatedAt: "desc" }, { id: "desc" }]);
  assert.equal(result.pagination.currentPage, 3);
});

test("管理一覧は状態・種類・正規化検索をDB条件へ入れてページングする", async () => {
  const query = parseAdminInquiryQuery({
    page: "999",
    status: "waiting",
    category: "BUG",
    search: " ＴＥＳＴ　カタカナ "
  });
  assert.equal(query.search, "test かたかな");
  assert.deepEqual(createAdminInquiryWhere(query), {
    status: { in: ["WAITING_FOR_USER"] },
    category: "BUG",
    searchText: { contains: "test かたかな" }
  });
  let findArgs: Record<string, unknown> | undefined;
  const result = await getAdminContactInquiryPage(query, {
    count: async () => 21,
    findMany: async (args) => {
      findArgs = args;
      return [];
    }
  });
  assert.equal(result.pagination.currentPage, 2);
  assert.equal(findArgs?.skip, 20);
  assert.equal(findArgs?.take, 20);
});

test("ページ番号・フィルターの不正値を安全に補正する", () => {
  assert.equal(normalizeContactPage("-1"), 1);
  assert.equal(normalizeContactPage("1.5"), 1);
  assert.equal(normalizeContactPage("3"), 3);
  assert.deepEqual(parseAdminInquiryQuery({ status: "bad", category: "bad", search: "x" }), {
    page: 1,
    status: "all",
    category: "all",
    search: "x"
  });
});

test("PrismaとmigrationはUser削除SetNull、message Cascade、snapshot、indexを保持する", async () => {
  const [schema, migration, realtimeMigration] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile("prisma/migrations/20260724190000_add_contact_inquiries/migration.sql", "utf8"),
    readFile(
      "prisma/migrations/20260726030000_add_contact_realtime_revision/migration.sql",
      "utf8"
    )
  ]);
  assert.match(schema, /model ContactInquiry \{/);
  assert.match(schema, /user\s+User\?\s+@relation\("ContactInquiryUser"[^\n]+onDelete: SetNull\)/);
  assert.match(schema, /assignedAdmin\s+User\?\s+@relation\("ContactInquiryAssignedAdmin"[^\n]+onDelete: SetNull\)/);
  assert.match(schema, /senderUser\s+User\?\s+@relation\("ContactInquiryMessageSender"[^\n]+onDelete: SetNull\)/);
  assert.match(schema, /inquiry\s+ContactInquiry\s+@relation\([^\n]+onDelete: Cascade\)/);
  for (const field of ["userIdSnapshot", "userNameSnapshot", "userEmailSnapshot", "senderUserIdSnapshot", "senderNameSnapshot"]) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /contact_inquiries_user_id_updated_at_id_idx/);
  assert.match(schema, /realtimeRevision\s+BigInt\s+@default\(0\)/);
  assert.match(schema, /realtimeActorClientId\s+String\?/);
  assert.match(schema, /realtimeActorUserId\s+String\?/);
  assert.match(realtimeMigration, /"realtime_revision" BIGINT NOT NULL DEFAULT 0/);
  assert.match(realtimeMigration, /"realtime_actor_client_id" VARCHAR\(128\)/);
  assert.match(realtimeMigration, /"realtime_actor_user_id" TEXT/);
});

test("ページとActionは認可、所有者条件、二重送信防止、終了時フォーム非表示を備える", async () => {
  const [
    contactPage,
    detailPage,
    adminPage,
    adminDetail,
    action,
    form,
    replyForm,
    list,
    errorPanel,
    settings,
    realtimeListener,
    realtimeSseRoute,
    realtimeRevisionRoute
  ] =
    await Promise.all([
      readFile("src/app/(app)/contact/page.tsx", "utf8"),
      readFile("src/app/(app)/contact/[publicId]/page.tsx", "utf8"),
      readFile("src/app/(app)/admin/inquiries/page.tsx", "utf8"),
      readFile("src/app/(app)/admin/inquiries/[publicId]/page.tsx", "utf8"),
      readFile("src/app/actions/contact.ts", "utf8"),
      readFile("src/components/contact-inquiry-form.tsx", "utf8"),
      readFile("src/components/contact-reply-form.tsx", "utf8"),
      readFile("src/components/contact-inquiry-list.tsx", "utf8"),
      readFile("src/components/unexpected-error-panel.tsx", "utf8"),
      readFile("src/app/(app)/settings/page.tsx", "utf8"),
      readFile("src/components/contact-realtime-refresh-listener.tsx", "utf8"),
      readFile("src/app/api/realtime/contact/route.ts", "utf8"),
      readFile("src/app/api/realtime/contact/revision/route.ts", "utf8")
    ]);
  assert.match(contactPage, /getRequiredSessionUser\(\)/);
  assert.match(detailPage, /getUserContactInquiryDetail\(user\.id, publicId\)/);
  assert.match(detailPage, /if \(!inquiry\) notFound\(\)/);
  assert.match(adminPage, /getRequiredAppAdminUser\(\)/);
  assert.match(adminDetail, /getRequiredAppAdminUser\(\)/);
  assert.doesNotMatch(action, /formData\.get\("userId"\)/);
  assert.doesNotMatch(action, /export const INITIAL_CONTACT_(?:FORM|REPLY)_STATE/);
  assert.match(form, /const INITIAL_CONTACT_FORM_STATE: ContactFormState/);
  assert.match(replyForm, /const INITIAL_CONTACT_REPLY_STATE: ContactReplyState/);
  assert.match(form, /disabled=\{pending\}/);
  assert.match(form, /送信中\.\.\./);
  assert.match(replyForm, /disabled=\{isPending\}/);
  assert.match(replyForm, /if \(!state\.success\) return;[\s\S]*?router\.refresh\(\)/);
  assert.match(replyForm, /data-dirty-watch/);
  assert.match(replyForm, /onSubmit=\{handleSubmit\}/);
  assert.match(
    replyForm,
    /event\.preventDefault\(\);[\s\S]*?new FormData\(event\.currentTarget\)[\s\S]*?startTransition\(\(\) => \{[\s\S]*?action\(formData\)/
  );
  assert.match(replyForm, /const \[replyBody, setReplyBody\] = useState\(""\)/);
  assert.match(replyForm, /value=\{replyBody\}[\s\S]*?onChange=\{\(event\) => setReplyBody\(event\.target\.value\)\}/);
  assert.match(replyForm, /useState<ContactStatus>\(defaultStatus\)/);
  assert.match(replyForm, /setNextStatus\(event\.target\.value as ContactStatus\);[\s\S]*?setConfirmClosed\(false\)/);
  assert.match(
    replyForm,
    /value=\{selectedAdminUserId\}[\s\S]*?onChange=\{\(event\) => setSelectedAdminUserId\(event\.target\.value\)\}/
  );
  assert.match(replyForm, /nextStatus === "CLOSED" \? \(/);
  assert.match(replyForm, /checked=\{confirmClosed\}/);
  assert.match(
    replyForm,
    /if \(nextState\.success\) \{[\s\S]*?setReplyBody\(""\);[\s\S]*?setConfirmClosed\(false\);[\s\S]*?router\.refresh\(\)/
  );
  assert.match(replyForm, /<ReplySubmitButton label="返信・変更を保存" pending=\{pending\} \/>/);
  assert.match(replyForm, /className="mt-0\.5 h-4 w-4 shrink-0"/);
  assert.match(replyForm, /className="leading-5"/);
  assert.match(
    replyForm,
    /状態を「終了」にすると、利用者は追加返信できなくなります。内容を確認しました。/
  );
  assert.match(
    action,
    /rawStatus === "CLOSED" && formData\.get\("confirmClosed"\) !== "yes"/
  );
  assert.equal((replyForm.match(/useFormDirtyById\(formId\)/g) ?? []).length, 2);
  assert.match(action, /actorClientId: getRealtimeActorId\(formData\)/);
  assert.equal(
    (action.match(/publishContactInquiryChangeSafely\(result\.change\)/g) ?? []).length,
    2
  );
  assert.match(detailPage, /inquiry\.status === "CLOSED"/);
  assert.match(adminDetail, /inquiry\.status === "CLOSED"/);
  assert.match(detailPage, /<ContactRealtimeRefreshListener/);
  assert.match(adminDetail, /<ContactRealtimeRefreshListener/);
  assert.match(realtimeListener, /\/api\/realtime\/contact\?/);
  assert.match(realtimeListener, /\/api\/realtime\/contact\/revision\?/);
  assert.match(realtimeListener, /hasDirtyForms\(\)/);
  assert.match(realtimeListener, /setHasPendingChange\(true\)/);
  assert.match(realtimeListener, /decideContactRealtimeChange/);
  assert.match(realtimeListener, /window\.addEventListener\("focus"/);
  assert.match(realtimeSseRoute, /await auth\(\)/);
  assert.match(realtimeSseRoute, /getContactRealtimeLookup\(publicId, viewer\)/);
  assert.match(realtimeRevisionRoute, /await auth\(\)/);
  assert.match(realtimeRevisionRoute, /realtimeRevision: true/);
  assert.match(list, /hidden overflow-x-auto[\s\S]*?lg:block/);
  assert.match(list, /className="grid gap-3 lg:hidden"/);
  assert.match(errorPanel, /このエラーについて問い合わせる/);
  assert.match(errorPanel, /\/contact\?errorId=/);
  assert.match(settings, /<ContactSupportEntry \/>[\s\S]*?<AccountDeleteEntryForm \/>/);
});

test("問い合わせ本文・メールをServer Actionのログcontextへ渡さない", async () => {
  const source = await readFile("src/app/actions/contact.ts", "utf8");
  assert.doesNotMatch(source, /context:\s*\{[^}]*body/);
  assert.doesNotMatch(source, /context:\s*\{[^}]*email/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:body|email)/);
});

test("問い合わせ補助入力は同じ高さ・補足文・上揃えで表示する", async () => {
  const form = await readFile("src/components/contact-inquiry-form.tsx", "utf8");
  assert.match(form, /className="grid items-start gap-4 md:grid-cols-2"/);
  assert.match(form, /name="errorId"[\s\S]*?className="h-11 min-w-0"/);
  assert.match(form, /name="sourcePath"[\s\S]*?className="h-11 min-w-0"/);
  assert.match(form, /エラー画面に表示されたIDがある場合に入力してください。/);
  assert.match(form, /<label className="grid min-w-0 content-start gap-1\.5 text-sm font-semibold text-slate-700">[\s\S]*?name="errorId"/);
  assert.match(form, /<label className="grid min-w-0 content-start gap-1\.5 text-sm font-semibold text-slate-700">[\s\S]*?name="sourcePath"/);
  assert.match(form, /defaultValue=\{initialErrorId\}/);
  assert.match(form, /defaultValue=\{initialSourcePath\}/);
  assert.match(form, /placeholder="\/settings"/);
});

test("問い合わせ送信ボタンは補助入力欄と同じmd境界で幅を切り替える", async () => {
  const form = await readFile("src/components/contact-inquiry-form.tsx", "utf8");
  assert.match(form, /grid items-start gap-4 md:grid-cols-2/);
  assert.match(form, /w-full[\s\S]*?md:w-auto/);
});

test("admin inquiry list uses compact status badges", async () => {
  const [badge, list, core] = await Promise.all([
    readFile("src/components/contact-status-badge.tsx", "utf8"),
    readFile("src/components/contact-inquiry-list.tsx", "utf8"),
    readFile("src/lib/contact-inquiry-core.ts", "utf8")
  ]);
  assert.match(badge, /WAITING_FOR_USER:\s*"\\u56de\\u7b54\\u5f85\\u3061"/);
  assert.match(badge, /compact \? "whitespace-nowrap " : ""/);
  assert.match(badge, /aria-label=\{compact \? CONTACT_STATUS_LABELS\[status\] : undefined\}/);
  assert.match(badge, /const label = compact \? compactStatusLabels\[status\] : CONTACT_STATUS_LABELS\[status\]/);
  assert.match(core, /WAITING_FOR_USER:/);
  assert.match(list, /flex flex-col items-start gap-1\.5[\s\S]*?<ContactStatusBadge status=\{inquiry\.status\} compact \/>/);
  assert.match(list, /flex flex-wrap items-center gap-2[\s\S]*?<ContactStatusBadge status=\{inquiry\.status\} compact \/>/);
  assert.equal((list.match(/<ContactStatusBadge status=\{inquiry\.status\} compact \/>/g) ?? []).length, 2);
  assert.match(list, /min-w-\[78rem\] table-fixed/);
  assert.match(list, /<col className="w-\[14%\]" \/>/);
});
