import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";

import { FeedingToggle } from "../src/components/feeding-toggle";
import { toDateInputValue } from "../src/lib/date";
import {
  getTodayFeedingRecordDate,
  setTodayFeedingState,
  todayFeedingRecordsByHamster
} from "../src/lib/feeding";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

type FakeFeedingRow = {
  id: string;
  hamsterId: string;
  recordDate: Date;
  fedAt: Date;
  createdByUserId: string | null;
};

function createFakeTransaction() {
  const rows = new Map<string, FakeFeedingRow>();
  let nextId = 1;
  const key = (hamsterId: string, recordDate: Date) => `${hamsterId}:${toDateInputValue(recordDate)}`;
  const feedingRecord = {
    async createMany({
      data
    }: {
      data: Omit<FakeFeedingRow, "id">;
      skipDuplicates: boolean;
    }) {
      const rowKey = key(data.hamsterId, data.recordDate);
      if (rows.has(rowKey)) return { count: 0 };
      rows.set(rowKey, { id: `feeding-${nextId++}`, ...data });
      return { count: 1 };
    },
    async findUnique({
      where
    }: {
      where: { hamsterId_recordDate: { hamsterId: string; recordDate: Date } };
    }) {
      const { hamsterId, recordDate } = where.hamsterId_recordDate;
      return rows.get(key(hamsterId, recordDate)) ?? null;
    },
    async deleteMany({
      where
    }: {
      where: { hamsterId: string; recordDate: Date };
    }) {
      return { count: rows.delete(key(where.hamsterId, where.recordDate)) ? 1 : 0 };
    }
  };

  return {
    rows,
    tx: { feedingRecord } as unknown as Pick<Prisma.TransactionClient, "feedingRecord">
  };
}

test("本日の記録だけをハムスターごとの実施済み状態へ対応付ける", () => {
  const now = new Date("2026-07-28T10:00:00.000Z");
  const records = [
    {
      hamsterId: "hamster-1",
      recordDate: new Date("2026-07-27T00:00:00.000Z"),
      fedAt: new Date("2026-07-27T10:00:00.000Z")
    },
    {
      hamsterId: "hamster-2",
      recordDate: new Date("2026-07-28T00:00:00.000Z"),
      fedAt: new Date("2026-07-28T10:05:00.000Z")
    }
  ];

  const byHamster = todayFeedingRecordsByHamster(records, now);
  assert.equal(byHamster.has("hamster-1"), false);
  assert.equal(byHamster.get("hamster-2")?.fedAt.toISOString(), "2026-07-28T10:05:00.000Z");
  assert.equal(todayFeedingRecordsByHamster([], now).size, 0);
});

test("本日の食事日付はUTCではなくJSTの日付境界で切り替わる", () => {
  assert.equal(toDateInputValue(getTodayFeedingRecordDate(new Date("2026-07-28T14:59:59.999Z"))), "2026-07-28");
  assert.equal(toDateInputValue(getTodayFeedingRecordDate(new Date("2026-07-28T15:00:00.000Z"))), "2026-07-29");
});

test("8時境界の直前は前日、8時ちょうどは当日のお世話日へ食事を登録・取消する", async () => {
  const database = createFakeTransaction();
  const common = { hamsterId: "hamster-1", createdByUserId: "user-1", careDayStartMinutes: 480 };
  const beforeBoundary = new Date("2026-08-01T22:59:59.999Z");
  const atBoundary = new Date("2026-08-01T23:00:00.000Z");

  const previousDay = await setTodayFeedingState(database.tx, {
    ...common,
    state: "marked",
    now: beforeBoundary
  });
  assert.equal(toDateInputValue(previousDay.recordDate), "2026-08-01");
  assert.equal(previousDay.record?.fedAt.toISOString(), beforeBoundary.toISOString());
  const cancelled = await setTodayFeedingState(database.tx, {
    ...common,
    state: "unmarked",
    now: beforeBoundary
  });
  assert.equal(cancelled.changed, true);
  assert.equal(database.rows.size, 0);

  const currentDay = await setTodayFeedingState(database.tx, {
    ...common,
    state: "marked",
    now: atBoundary
  });
  assert.equal(toDateInputValue(currentDay.recordDate), "2026-08-02");
});

test("実施済み化と取消を冪等に処理し、同日レコードを重複作成しない", async () => {
  const database = createFakeTransaction();
  const input = {
    hamsterId: "hamster-1",
    createdByUserId: null,
    now: new Date("2026-07-28T10:05:00.000Z")
  };

  const firstMark = await setTodayFeedingState(database.tx, { ...input, state: "marked" });
  const duplicateMark = await setTodayFeedingState(database.tx, { ...input, state: "marked" });
  assert.equal(firstMark.changed, true);
  assert.equal(duplicateMark.changed, false);
  assert.equal(database.rows.size, 1);
  assert.equal([...database.rows.values()][0]?.createdByUserId, null);

  const firstUnmark = await setTodayFeedingState(database.tx, { ...input, state: "unmarked" });
  const duplicateUnmark = await setTodayFeedingState(database.tx, { ...input, state: "unmarked" });
  assert.equal(firstUnmark.changed, true);
  assert.equal(duplicateUnmark.changed, false);
  assert.equal(database.rows.size, 0);
});

test("Prismaモデルとmigrationが日単位の一意性、実施日時、操作者を保持する", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20260728090000_add_feeding_records/migration.sql");

  assert.match(schema, /model FeedingRecord[\s\S]*recordDate\s+DateTime[\s\S]*fedAt\s+DateTime/);
  assert.match(schema, /createdByUserId\s+String\?/);
  assert.match(schema, /@@unique\(\[hamsterId, recordDate\]\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "feeding_records_hamster_id_record_date_key"/);
  assert.match(migration, /ADD VALUE 'FEEDING_MARKED'/);
  assert.match(migration, /ADD VALUE 'FEEDING_UNMARKED'/);
});

test("Server Actionは共通認可、所属・管理状態確認、履歴、revision、安全な副作用を再利用する", () => {
  const action = source("src/app/actions/feeding.ts");
  const feeding = source("src/lib/feeding.ts");

  assert.match(action, /getRequiredHouseholdMutationContext\("\/"\)/);
  assert.match(action, /tx\.hamster\.findUnique/);
  assert.match(action, /tx\.householdMember\.findUnique/);
  assert.match(action, /careDayStartMinutes: membership\.household\.careDayStartMinutes/);
  assert.match(action, /belongsToCurrentHousehold\(hamster\.householdId, context\.household\.id\)/);
  assert.match(action, /if \(!hamster\.isActive\) redirect\("\/\?status=locked"\)/);
  assert.match(action, /commitHouseholdMutation\(\{/);
  assert.match(action, /source: "feeding"/);
  assert.match(action, /FEEDING_MARKED/);
  assert.match(action, /FEEDING_UNMARKED/);
  assert.match(action, /category: "CARE_RECORD"/);
  assert.match(action, /details: \{ recordDate: toDateInputValue\(result\.recordDate\) \}/);
  assert.match(action, /publishHouseholdChangeSafely\(change\)/);
  assert.match(action, /revalidatePathsSafely\(/);
  assert.match(action, /redirect\("\/"\)/);
  assert.doesNotMatch(action, /feedingMarked|feedingUnmarked/);
  assert.match(action, /redirect\("\/\?status=invalid"\)/);
  assert.match(action, /redirect\("\/\?status=locked"\)/);
  assert.match(action, /handleServerActionError\(/);
  assert.match(feeding, /createMany\([\s\S]*skipDuplicates: true/);
  assert.match(feeding, /deleteMany\(/);
});

test("食事変更の成功メッセージ定義を残さず、エラー用ステータスは維持する", () => {
  const statusMessage = source("src/components/status-message.tsx");

  assert.doesNotMatch(statusMessage, /feedingMarked|feedingUnmarked/);
  assert.match(statusMessage, /locked: "管理外のハムスターは編集できません/);
  assert.match(statusMessage, /viewerForbidden: "閲覧者はこの操作を実行できません/);
  assert.match(statusMessage, /systemError: "処理中に予期しないエラーが発生しました/);
});

test("ダッシュボードは表示対象IDの本日分を一括取得して紐付ける", () => {
  const queries = source("src/lib/queries.ts");

  assert.match(
    queries,
    /prisma\.feedingRecord\.findMany\([\s\S]*hamsterId: \{ in: dashboardHamsterIds \}[\s\S]*recordDate: careDayRecordDate/
  );
  assert.match(queries, /const now = new Date\(\)/);
  assert.match(queries, /const careDayRecordDate = getCareDayRecordDate\(now, careDayStartMinutes\)/);
  assert.match(queries, /todayFeeding: feedingByHamster\.get\(hamster\.id\) \?\? null/);
});

test("食事項目は簡潔な状態表示を使い、実施時刻は支援技術向け情報へ残す", () => {
  const unmarked = renderToStaticMarkup(
    <FeedingToggle hamsterId="hamster-1" hamsterName="きなこ" fedAt={null} readOnly />
  );
  const marked = renderToStaticMarkup(
    <FeedingToggle
      hamsterId="hamster-1"
      hamsterName="きなこ"
      fedAt="2026-07-28T10:05:00.000Z"
      readOnly
    />
  );

  assert.match(unmarked, /aria-pressed="false"/);
  assert.match(unmarked, />未実施</);
  assert.match(unmarked, /disabled=""/);
  assert.match(unmarked, /サンプル閲覧モードでは変更できません/);
  assert.match(marked, /aria-pressed="true"/);
  assert.match(marked, />実施済み</);
  assert.doesNotMatch(marked, />19:05に実施済み</);
  assert.match(marked, /19:05に実施済みです/);
});

test("保存中・無効化・デモ読み取り専用の操作制御を維持する", () => {
  const component = source("src/components/feeding-toggle.tsx");
  const demoPage = source("src/app/demo/page.tsx");
  const viewer = renderToStaticMarkup(
    <FeedingToggle hamsterId="hamster-1" hamsterName="きなこ" fedAt={null} canEdit={false} />
  );
  const inactive = renderToStaticMarkup(
    <FeedingToggle hamsterId="hamster-1" hamsterName="きなこ" fedAt={null} isActive={false} />
  );
  const demo = renderToStaticMarkup(
    <FeedingToggle hamsterId="hamster-1" hamsterName="きなこ" fedAt={null} readOnly />
  );

  assert.match(component, /const disabled = pending \|\| disabledReason !== null/);
  assert.match(component, /disabled=\{disabled\}/);
  assert.match(component, /保存中\.\.\./);
  assert.match(component, /focus-visible:ring-2/);
  assert.match(component, /cursor-pointer/);
  assert.match(component, /const hoverClass = disabled \? "" : "hover:bg-slate-100"/);
  assert.match(component, /disabled:cursor-not-allowed/);
  assert.match(component, /shouldDimWhenDisabled=\{!readOnly && isActive\}/);
  assert.match(component, /shouldDimWhenDisabled \? "disabled:opacity-65" : ""/);
  assert.doesNotMatch(component, /CheckCircle2|<Circle/);
  assert.match(viewer, /閲覧者は食事状態を変更できません/);
  assert.match(inactive, /管理外のハムスターは変更できません/);
  assert.doesNotMatch(inactive, /hover:bg-slate-100/);
  assert.match(demo, /disabled=""/);
  assert.doesNotMatch(demo, /disabled:opacity-65/);
  assert.match(demoPage, /<FeedingToggle[\s\S]*readOnly/);
  assert.doesNotMatch(demoPage, /actions\/feeding|setTodayFeeding/);
});
