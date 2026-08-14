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
    eventType: "PET_WEIGHT_CREATED",
    category: "CARE_RECORD",
    targetNameSnapshot: "こむぎ",
    details: { recordDate: "2026-08-12", weightKg: 5.25 },
    createdAt: new Date("2026-08-12T03:00:00.000Z"),
    ...overrides
  };
}

test("表示名snapshotはメールを使わず、未設定時は安全な名称にする", () => {
  assert.equal(activityActorName({ name: " 林 勇希 " }), "林 勇希");
  assert.equal(activityActorName({ name: null }), ACTOR_NAME_FALLBACK);
  assert.equal(activityActorName({ name: "" }), ACTOR_NAME_FALLBACK);
});

test("HouseholdとPetのお世話イベントを日本語表示し、不正detailsを安全に扱う", () => {
  assert.deepEqual(formatHouseholdActivity(item()), {
    summary: "林 勇希さんが「こむぎ」の体重を記録しました",
    detail: "5.25kg・2026年8月12日"
  });
  assert.equal(
    formatHouseholdActivity(item({ eventType: "HOUSEHOLD_NAME_UPDATED", details: null })).summary,
    "林 勇希さんが共有グループ名を変更しました"
  );
  assert.equal(
    formatHouseholdActivity(item({ eventType: "MEMBER_JOINED", details: null })).summary,
    "林 勇希さんが共有グループに参加しました"
  );
  assert.equal(
    formatHouseholdActivity(item({ eventType: "PET_FEEDING_CREATED", details: "invalid" })).detail,
    null
  );
  assert.equal(
    formatHouseholdActivity(item({
      eventType: "PET_WATER_UPDATED",
      details: { caredAt: "2026-08-12T00:30:00.000Z", action: "REFILLED" }
    })).detail,
    "2026/08/12 09:30・補充"
  );
});

test("Pet Records 15イベントをPet向け日本語とJST暦日で表示する", () => {
  const expected = [
    ["PET_HEALTH_RECORD_CREATED", "健康記録を追加しました"],
    ["PET_HEALTH_RECORD_UPDATED", "健康記録を更新しました"],
    ["PET_HEALTH_RECORD_DELETED", "健康記録を削除しました"],
    ["PET_MEDICAL_RECORD_CREATED", "通院記録を追加しました"],
    ["PET_MEDICAL_RECORD_UPDATED", "通院記録を更新しました"],
    ["PET_MEDICAL_RECORD_DELETED", "通院記録を削除しました"],
    ["PET_MEDICATION_RECORD_CREATED", "投薬記録を追加しました"],
    ["PET_MEDICATION_RECORD_UPDATED", "投薬記録を更新しました"],
    ["PET_MEDICATION_RECORD_DELETED", "投薬記録を削除しました"],
    ["PET_VACCINATION_RECORD_CREATED", "ワクチン記録を追加しました"],
    ["PET_VACCINATION_RECORD_UPDATED", "ワクチン記録を更新しました"],
    ["PET_VACCINATION_RECORD_DELETED", "ワクチン記録を削除しました"],
    ["PET_MEMORY_RECORD_CREATED", "思い出を追加しました"],
    ["PET_MEMORY_RECORD_UPDATED", "思い出を更新しました"],
    ["PET_MEMORY_RECORD_DELETED", "思い出を削除しました"]
  ] as const;

  for (const [eventType, operation] of expected) {
    assert.deepEqual(
      formatHouseholdActivity(item({
        eventType,
        details: { recordDate: "2026-08-12" }
      })),
      { summary: `林 勇希さんが「こむぎ」の${operation}`, detail: "2026年8月12日" }
    );
  }
});

test("Pet Records Activityは5 target・15 eventへ最小detailsだけを渡す", () => {
  const mutations = source("src/lib/pet-record-mutations.ts");
  for (const type of ["HEALTH", "MEDICAL", "MEDICATION", "VACCINATION", "MEMORY"]) {
    assert.match(mutations, new RegExp(`${type}: \\{[\\s\\S]*targetType: "PET_${type}_RECORD"`));
    for (const operation of ["CREATED", "UPDATED", "DELETED"]) {
      assert.match(mutations, new RegExp(`PET_${type}_RECORD_${operation}`));
    }
  }
  assert.match(mutations, /details: \{ recordDate: toDateInputValue\(record\.recordDate\) \}/);
  assert.doesNotMatch(
    mutations,
    /details: \{[^}]+(?:memo|diagnosis|symptoms|medication|content|tags|fileName)/i
  );
});

test("不正なカテゴリーとページ番号は安全な既定値へ補正する", () => {
  assert.equal(parseActivityCategory("CARE_RECORD"), "CARE_RECORD");
  assert.equal(parseActivityCategory("invalid"), null);
  assert.equal(parseActivityPage("3"), 3);
  assert.equal(parseActivityPage("0"), 1);
  assert.equal(parseActivityPage("abc"), 1);
});

test("業務更新・履歴・revisionは同じtransactionで確定し、履歴失敗時はrollbackする", async () => {
  const database = { value: 0, revision: 0, activities: 0, failActivity: false };
  const execute: TransactionExecutor = async (operation) => {
    const snapshot = { ...database };
    const tx = {
      householdActivity: {
        create: async () => {
          if (database.failActivity) throw new Error("activity failed");
          database.activities += 1;
          return { id: "activity-1" };
        }
      },
      household: {
        update: async () => {
          database.revision += 1;
          return { realtimeRevision: BigInt(database.revision) };
        }
      }
    } as unknown as Prisma.TransactionClient;
    try {
      return await operation(tx);
    } catch (error) {
      Object.assign(database, snapshot);
      throw error;
    }
  };

  const input = {
    householdId: "household-1",
    source: "petWeight" as const,
    actorUserId: "user-1",
    actorNameSnapshot: "林 勇希",
    mutate: async () => { database.value += 1; },
    activity: { eventType: "PET_WEIGHT_CREATED" as const, category: "CARE_RECORD" as const }
  };
  await commitHouseholdMutation(input, execute);
  assert.deepEqual(database, { value: 1, revision: 1, activities: 1, failActivity: false });

  database.failActivity = true;
  await assert.rejects(commitHouseholdMutation(input, execute), /activity failed/);
  assert.deepEqual(database, { value: 1, revision: 1, activities: 1, failActivity: true });
});

test("取得は現在所属Householdだけを絞り、安定順・20件ページング・最新5件を使う", () => {
  const queries = source("src/lib/household-activity-queries.ts");
  const membersPage = source("src/app/(app)/settings/members/page.tsx");
  assert.match(queries, /householdId: context\.household\.id/);
  assert.match(queries, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(queries, /HOUSEHOLD_ACTIVITY_PAGE_SIZE/);
  assert.match(queries, /take: Math\.min\(Math\.max\(limit, 1\), 5\)/);
  assert.match(membersPage, /HouseholdActivityList/);
});

test("操作履歴画面は自動削除と同じ保持日数設定を表示する", () => {
  const activityPage = source("src/app/(app)/settings/members/activity/page.tsx");
  const cleanupScript = source("scripts/cleanup-household-activities.ts");
  assert.match(activityPage, /getHouseholdActivityRetentionDays\(\)/);
  assert.match(cleanupScript, /getHouseholdActivityRetentionDays\(\)/);
  assert.doesNotMatch(activityPage, /NEXT_PUBLIC_|["']use client["']/);
});

test("現行Pet Mutationだけが対応する履歴イベントを同一transactionへ渡す", () => {
  for (const [path, events] of [
    ["src/app/actions/pet-weights.ts", ["PET_WEIGHT_CREATED", "PET_WEIGHT_UPDATED", "PET_WEIGHT_DELETED"]],
    ["src/app/actions/pet-feeding.ts", ["PET_FEEDING_CREATED", "PET_FEEDING_UPDATED", "PET_FEEDING_DELETED"]],
    ["src/app/actions/pet-water.ts", ["PET_WATER_CREATED", "PET_WATER_UPDATED", "PET_WATER_DELETED"]],
    ["src/app/actions/pet-walk.ts", ["PET_WALK_CREATED", "PET_WALK_UPDATED", "PET_WALK_DELETED"]],
    ["src/app/actions/pet-litter.ts", ["PET_LITTER_CREATED", "PET_LITTER_UPDATED", "PET_LITTER_DELETED"]]
  ] as const) {
    const mutation = source(path);
    for (const event of events) assert.match(mutation, new RegExp(event));
    assert.match(mutation, /commitHouseholdMutation/);
  }
});
