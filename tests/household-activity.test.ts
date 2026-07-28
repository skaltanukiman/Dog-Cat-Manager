import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";

import {
  ACTOR_NAME_FALLBACK,
  activityActorName,
  formatHouseholdActivity,
  parseActivityCategory,
  parseActivityPage,
  type HouseholdActivityListItem
} from "../src/lib/household-activity";
import { commitHouseholdMutation, type TransactionExecutor } from "../src/lib/realtime";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

function item(overrides: Partial<HouseholdActivityListItem> = {}): HouseholdActivityListItem {
  return {
    id: "activity-1",
    actorNameSnapshot: "林 勇希",
    eventType: "HAMSTER_CREATED",
    category: "CARE_RECORD",
    targetNameSnapshot: "きなこ",
    details: null,
    createdAt: new Date("2026-07-21T03:00:00.000Z"),
    ...overrides
  };
}

test("表示名snapshotはメールを使わず、未設定時は安全な名称にする", () => {
  assert.equal(activityActorName({ name: " 林 勇希 " }), "林 勇希");
  assert.equal(activityActorName({ name: null }), ACTOR_NAME_FALLBACK);
  assert.equal(activityActorName({ name: "" }), ACTOR_NAME_FALLBACK);
});

test("主要イベントを日本語表示へ集約し、不正detailsでも例外にしない", () => {
  assert.deepEqual(formatHouseholdActivity(item()), { summary: "林 勇希さんが「きなこ」を登録しました", detail: null });
  assert.equal(formatHouseholdActivity(item({ eventType: "HAMSTER_DELETED" })).summary, "林 勇希さんが「きなこ」を削除しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "HOUSEHOLD_NAME_UPDATED" })).summary, "林 勇希さんが共有グループ名を変更しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "INVITATION_CREATED" })).summary, "林 勇希さんが招待リンクを作成しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "INVITATION_REVOKED" })).summary, "林 勇希さんが招待リンクを無効化しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "MEMBER_JOINED" })).summary, "林 勇希さんが共有グループに参加しました");
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "MEMBER_ROLE_UPDATED", targetNameSnapshot: "山田", details: { previousRole: "MEMBER", newRole: "ADMIN" } })), { summary: "林 勇希さんが山田さんの権限を変更しました", detail: "メンバー → 管理者" });
  assert.equal(formatHouseholdActivity(item({ eventType: "MEMBER_REMOVED", targetNameSnapshot: "山田" })).summary, "林 勇希さんが山田さんの参加を解除しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "MEMBER_LEFT" })).summary, "林 勇希さんが共有グループから退出しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "OWNERSHIP_TRANSFERRED_AND_LEFT", targetNameSnapshot: "山田" })).summary, "林 勇希さんが山田さんへ所有権を移譲して退出しました");
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "WEIGHT_CREATED", details: { recordDate: "2026-07-21", weightG: 128.4 } })), { summary: "林 勇希さんが「きなこ」の体重を記録しました", detail: "128.4g・2026年7月21日" });
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "WEIGHT_UPDATED", details: { previousWeightG: 127.8, newWeightG: 128.4 } })), { summary: "林 勇希さんが「きなこ」の体重を更新しました", detail: "127.8g → 128.4g" });
  assert.equal(formatHouseholdActivity(item({ eventType: "WEIGHT_DELETED", details: "invalid" })).detail, null);
  assert.equal(formatHouseholdActivity(item({ eventType: "WEIGHTS_BULK_DELETED", details: { count: 3 } })).summary, "林 勇希さんが体重記録を3件削除しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "WEIGHT_CSV_APP_IMPORTED", details: { createdCount: 10, updatedCount: 4, skippedCount: 2 } })).detail, "新規10件・更新4件・スキップ2件");
  assert.equal(formatHouseholdActivity(item({ eventType: "WEIGHT_CSV_GAS_IMPORTED", details: { createdCount: 2, updatedCount: 0, skippedCount: 1 } })).detail, "新規2件・更新0件・スキップ1件");
  assert.equal(formatHouseholdActivity(item({ eventType: "CLEANING_MONTH_SAVED", details: { yearMonth: "2026-07", changedDayCount: 3 } })).detail, "2026年7月・3日分");
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "FEEDING_MARKED", details: { recordDate: "2026-07-28" } })), { summary: "林 勇希さんが「きなこ」の食事を実施済みにしました", detail: "2026年7月28日" });
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "FEEDING_UNMARKED", details: { recordDate: "2026-07-28" } })), { summary: "林 勇希さんが「きなこ」の食事記録を取り消しました", detail: "2026年7月28日" });
});

test("第2段階イベントを最小限のdetailsから表示し、不正値は安全にフォールバックする", () => {
  const recordDate = { recordDate: "2026-07-22" };
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "HEALTH_RECORD_CREATED", details: recordDate })), { summary: "林 勇希さんが「きなこ」の健康記録を追加しました", detail: "2026年7月22日" });
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "HEALTH_RECORD_UPDATED", details: recordDate })), { summary: "林 勇希さんが「きなこ」の健康記録を更新しました", detail: "2026年7月22日" });
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "HEALTH_RECORD_DELETED", details: recordDate })), { summary: "林 勇希さんが「きなこ」の健康記録を削除しました", detail: "2026年7月22日" });
  assert.equal(formatHouseholdActivity(item({ eventType: "MEDICAL_RECORD_CREATED", details: recordDate })).summary, "林 勇希さんが「きなこ」の通院記録を追加しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "MEDICAL_RECORD_UPDATED", details: recordDate })).summary, "林 勇希さんが「きなこ」の通院記録を更新しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "MEDICAL_RECORD_DELETED", details: recordDate })).summary, "林 勇希さんが「きなこ」の通院記録を削除しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "MEMORY_RECORD_CREATED", details: recordDate })).summary, "林 勇希さんが「きなこ」の思い出を追加しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "MEMORY_RECORD_UPDATED", details: recordDate })).summary, "林 勇希さんが「きなこ」の思い出を更新しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "MEMORY_RECORD_DELETED", details: recordDate })).summary, "林 勇希さんが「きなこ」の思い出を削除しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "HEALTH_RECORD_CREATED", details: { recordDate: "invalid" } })).detail, null);

  assert.equal(formatHouseholdActivity(item({ eventType: "HAMSTER_PROFILE_IMAGE_UPDATED", details: { imageAction: "ADDED" } })).summary, "林 勇希さんが「きなこ」のプロフィール画像を登録しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "HAMSTER_PROFILE_IMAGE_UPDATED", details: { imageAction: "REPLACED" } })).summary, "林 勇希さんが「きなこ」のプロフィール画像を変更しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "HAMSTER_PROFILE_IMAGE_UPDATED", details: { imageAction: "REMOVED" } })).summary, "林 勇希さんが「きなこ」のプロフィール画像を削除しました");
  assert.equal(formatHouseholdActivity(item({ eventType: "HAMSTER_PROFILE_IMAGE_UPDATED", details: "invalid" })).summary, "林 勇希さんが「きなこ」のプロフィール画像を更新しました");

  assert.deepEqual(formatHouseholdActivity(item({ eventType: "HAMSTER_ACTIVE_STATUS_UPDATED", details: { previousIsActive: true, newIsActive: false } })), { summary: "林 勇希さんが「きなこ」を管理外に切り替えました", detail: "管理中 → 管理外" });
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "HAMSTER_ACTIVE_STATUS_UPDATED", details: { previousIsActive: false, newIsActive: true } })), { summary: "林 勇希さんが「きなこ」を管理中に戻しました", detail: "管理外 → 管理中" });
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "HAMSTER_ACTIVE_STATUS_UPDATED", details: { previousIsActive: true, newIsActive: true } })), { summary: "林 勇希さんが「きなこ」の管理状態を変更しました", detail: null });
  assert.deepEqual(formatHouseholdActivity(item({ eventType: "UNKNOWN_EVENT" as HouseholdActivityListItem["eventType"] })), { summary: "林 勇希さんが操作しました", detail: null });
});

test("不正なカテゴリーとページ番号は安全な既定値へ補正する", () => {
  assert.equal(parseActivityCategory("CARE_RECORD"), "CARE_RECORD");
  assert.equal(parseActivityCategory("invalid"), null);
  assert.equal(parseActivityPage("3"), 3);
  assert.equal(parseActivityPage("0"), 1);
  assert.equal(parseActivityPage("-1"), 1);
  assert.equal(parseActivityPage("abc"), 1);
});

test("業務更新・履歴・revisionは同じtransactionで確定し、履歴失敗時はrollbackする", async () => {
  const database = { value: 0, revision: 0, activities: 0, failActivity: false };
  const execute: TransactionExecutor = async (operation) => {
    const snapshot = { ...database };
    const tx = {
      householdActivity: { create: async () => {
        if (database.failActivity) throw new Error("activity failed");
        database.activities += 1;
        return { id: "activity-1" };
      } },
      household: { update: async () => {
        database.revision += 1;
        return { realtimeRevision: BigInt(database.revision) };
      } }
    } as unknown as Prisma.TransactionClient;
    try {
      return await operation(tx);
    } catch (error) {
      Object.assign(database, snapshot);
      throw error;
    }
  };

  await commitHouseholdMutation({ householdId: "household-1", source: "weight", actorUserId: "user-1", actorNameSnapshot: "林 勇希", mutate: async () => { database.value += 1; }, activity: { eventType: "WEIGHT_CREATED", category: "CARE_RECORD" } }, execute);
  assert.deepEqual(database, { value: 1, revision: 1, activities: 1, failActivity: false });

  await assert.rejects(commitHouseholdMutation({
    householdId: "household-1",
    source: "weight",
    actorUserId: "user-1",
    mutate: async () => { throw new Error("mutation failed"); },
    activity: { eventType: "WEIGHT_CREATED", category: "CARE_RECORD" }
  }, execute), /mutation failed/);
  assert.deepEqual(database, { value: 1, revision: 1, activities: 1, failActivity: false });

  database.failActivity = true;
  await assert.rejects(commitHouseholdMutation({ householdId: "household-1", source: "weight", actorUserId: "user-1", mutate: async () => { database.value += 1; }, activity: { eventType: "WEIGHT_CREATED", category: "CARE_RECORD" } }, execute), /activity failed/);
  assert.deepEqual(database, { value: 1, revision: 1, activities: 1, failActivity: true });
});

test("取得は現在所属HouseholdだけをDB側で絞り、安定順・20件ページング・最新5件を使う", () => {
  const queries = source("src/lib/household-activity-queries.ts");
  const membersPage = source("src/app/(app)/settings/members/page.tsx");
  const activityPage = source("src/app/(app)/settings/members/activity/page.tsx");
  assert.match(queries, /getRequiredHouseholdContext\(\)/);
  assert.match(queries, /householdId: context\.household\.id/);
  assert.match(queries, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(queries, /HOUSEHOLD_ACTIVITY_PAGE_SIZE/);
  assert.match(queries, /category: input\.category/);
  assert.match(queries, /take: Math\.min\(Math\.max\(limit, 1\), 5\)/);
  assert.match(membersPage, /HouseholdActivityList/);
  assert.match(activityPage, /const buildActivityPageHref = \(page: number\) => activityHref\(category, page\)/);
  assert.match(activityPage, /const renderPagination = \(ariaLabel: string\) => data\.pagination\.totalPages > 1/);
  assert.match(activityPage, /renderPagination\("操作履歴上部のページ"\)[\s\S]*?<HouseholdActivityList[\s\S]*?renderPagination\("操作履歴下部のページ"\)/);
  assert.match(activityPage, /visibleCount=\{data\.activities\.length\}/);
  assert.match(activityPage, /buildHref=\{buildActivityPageHref\}/);
  assert.match(activityPage, /scroll=\{false\}[\s\S]*?preserveScroll/);
});

test("操作履歴画面は自動削除と同じ保持日数設定をServer Componentで表示する", () => {
  const activityPage = source("src/app/(app)/settings/members/activity/page.tsx");
  const cleanupScript = source("scripts/cleanup-household-activities.ts");

  assert.match(activityPage, /from "@\/lib\/household-activity-cleanup"/);
  assert.match(activityPage, /getHouseholdActivityRetentionDays\(\)/);
  assert.match(cleanupScript, /getHouseholdActivityRetentionDays\(\)/);
  assert.match(activityPage, /`操作履歴は\$\{retentionDays\}日間保持され、期限を過ぎた履歴は定期的に自動削除されます。`/);
  assert.match(activityPage, /操作履歴の保持期間は設定不明です。保持期間が正しく設定されるまで自動削除は実行されません。/);
  assert.doesNotMatch(activityPage, /90日|NEXT_PUBLIC_|process\.env|["']use client["']/);
});

test("履歴入力へ機密本文を渡さず、対象イベントだけを記録する", () => {
  const activity = source("src/lib/household-activity.ts");
  const weights = source("src/app/actions/weights.ts");
  const cleaning = source("src/app/actions/cleaning.ts");
  assert.doesNotMatch(activity, /tokenHash|inviteToken|email|csvFile|\bmemo\b|Authorization|Cookie/i);
  assert.match(weights, /details: \{ createdCount: created\.count, updatedCount:/);
  assert.match(cleaning, /details: \{ yearMonth, changedDayCount \}/);
  assert.doesNotMatch(cleaning, /details: \{[^}]*memo/);
});

test("第2段階Mutationは最小限の履歴を同一transactionへ組み込む", () => {
  const records = source("src/app/actions/records.ts");
  const hamsters = source("src/app/actions/hamsters.ts");
  const recordEvents = [
    "HEALTH_RECORD_CREATED", "HEALTH_RECORD_UPDATED", "HEALTH_RECORD_DELETED",
    "MEDICAL_RECORD_CREATED", "MEDICAL_RECORD_UPDATED", "MEDICAL_RECORD_DELETED",
    "MEMORY_RECORD_CREATED", "MEMORY_RECORD_UPDATED", "MEMORY_RECORD_DELETED"
  ];
  for (const event of recordEvents) assert.match(records, new RegExp(event));
  assert.equal(records.match(/details: \{ recordDate: toDateInputValue\([^)]*\.recordDate\) \}/g)?.length, 7);
  assert.doesNotMatch(records, /details: \{[^}]+(?:hospitalName|diagnosis|medication|consultationFee|memo|title|tags|fileName|searchText)/);
  assert.match(records, /actorNameSnapshot: activityActorName\(context\.user\)/);
  assert.match(records, /where: \{ id: record\.id, updatedAt: record\.updatedAt \}/);
  assert.match(records, /\{ path: "\/settings\/members" \}[\s\S]*\{ path: "\/settings\/members\/activity" \}/);

  assert.match(hamsters, /HAMSTER_PROFILE_IMAGE_UPDATED/);
  assert.match(hamsters, /details: \{ imageAction \}/);
  assert.match(hamsters, /preparedImage[\s\S]+"REPLACED" : "ADDED"[\s\S]+"REMOVED" : null/);
  assert.doesNotMatch(hamsters, /details: \{[^}]+(?:profileImageFileName|fileName|path|mime|size)/i);
  assert.match(hamsters, /HAMSTER_ACTIVE_STATUS_UPDATED/);
  assert.match(hamsters, /details: \{ previousIsActive: hamster\.previousIsActive, newIsActive: hamster\.newIsActive \}/);
  assert.match(hamsters, /hamster\.isActive === result\.data\.isActive[\s\S]+HamsterActiveStatusResultError\("unchanged"\)/);
  assert.match(hamsters, /isActive: hamster\.isActive[\s\S]+updated\.count !== 1/);

  const createStart = hamsters.indexOf("export async function createHamster");
  const updateStart = hamsters.indexOf("export async function updateHamster", createStart);
  assert.doesNotMatch(hamsters.slice(createStart, updateStart), /HAMSTER_PROFILE_IMAGE_UPDATED/);
});

test("第2段階migrationは既存enumへ値だけを追加する", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20260721150000_extend_household_activity_history_phase2/migration.sql");
  for (const event of [
    "HEALTH_RECORD_CREATED", "HEALTH_RECORD_UPDATED", "HEALTH_RECORD_DELETED",
    "MEDICAL_RECORD_CREATED", "MEDICAL_RECORD_UPDATED", "MEDICAL_RECORD_DELETED",
    "MEMORY_RECORD_CREATED", "MEMORY_RECORD_UPDATED", "MEMORY_RECORD_DELETED",
    "HAMSTER_PROFILE_IMAGE_UPDATED", "HAMSTER_ACTIVE_STATUS_UPDATED"
  ]) {
    assert.match(schema, new RegExp(`\\b${event}\\b`));
    assert.match(migration, new RegExp(`ALTER TYPE "HouseholdActivityEvent" ADD VALUE '${event}'`));
  }
  assert.doesNotMatch(migration, /CREATE TABLE|DROP TABLE|CREATE TYPE|DROP TYPE|ALTER TABLE/i);
});

test("全対象Mutationが履歴イベントを持ち、変更なしではtransactionへ進まない", () => {
  const members = source("src/app/actions/members.ts");
  const hamsters = source("src/app/actions/hamsters.ts");
  const weights = source("src/app/actions/weights.ts");
  const cleaning = source("src/app/actions/cleaning.ts");
  const householdName = source("src/lib/household-name.ts");
  const invitations = source("src/lib/invitation-mutations.ts");
  const leave = source("src/lib/household-leave.ts");
  for (const event of ["MEMBER_JOINED", "MEMBER_ROLE_UPDATED", "MEMBER_REMOVED"]) assert.match(members, new RegExp(event));
  for (const event of ["HAMSTER_CREATED", "HAMSTER_DELETED"]) assert.match(hamsters, new RegExp(event));
  for (const event of ["WEIGHT_CREATED", "WEIGHT_UPDATED", "WEIGHT_DELETED", "WEIGHTS_BULK_DELETED", "WEIGHT_CSV_APP_IMPORTED", "WEIGHT_CSV_GAS_IMPORTED"]) assert.match(weights, new RegExp(event));
  assert.match(cleaning, /CLEANING_MONTH_SAVED/);
  assert.match(householdName, /HOUSEHOLD_NAME_UPDATED/);
  assert.match(invitations, /INVITATION_CREATED/);
  assert.match(invitations, /INVITATION_REVOKED/);
  assert.match(leave, /MEMBER_LEFT/);
  assert.match(leave, /OWNERSHIP_TRANSFERRED_AND_LEFT/);
  assert.match(weights, /weightRedirect\([^\n]+"unchanged"/);
  assert.match(weights, /changeCount > 0/);
  assert.match(cleaning, /operations\.length === 0/);
});

test("削除後もsnapshotを残すCascade・SetNull設計を持つ", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20260721120000_add_household_activity_history/migration.sql");
  assert.match(schema, /actorNameSnapshot\s+String/);
  assert.match(schema, /targetNameSnapshot\s+String\?/);
  assert.match(schema, /onDelete: Cascade/);
  assert.match(schema, /HouseholdActivityActor[\s\S]*onDelete: SetNull/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /ON DELETE SET NULL/);
});
