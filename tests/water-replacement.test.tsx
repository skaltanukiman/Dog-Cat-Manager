import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";

import { WaterReplacementToggle } from "../src/components/water-replacement-toggle";
import { toDateInputValue } from "../src/lib/date";
import {
  getTodayWaterReplacementRecordDate,
  setTodayWaterReplacementState,
  todayWaterReplacementRecordsByHamster
} from "../src/lib/water-replacement";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

type FakeWaterReplacementRow = {
  id: string;
  hamsterId: string;
  recordDate: Date;
  replacedAt: Date;
  createdByUserId: string;
};

function createFakeTransaction() {
  const rows = new Map<string, FakeWaterReplacementRow>();
  let nextId = 1;
  const key = (hamsterId: string, recordDate: Date) =>
    `${hamsterId}:${toDateInputValue(recordDate)}`;
  const waterReplacementRecord = {
    async createMany({
      data
    }: {
      data: Omit<FakeWaterReplacementRow, "id">;
      skipDuplicates: boolean;
    }) {
      const rowKey = key(data.hamsterId, data.recordDate);
      if (rows.has(rowKey)) return { count: 0 };
      rows.set(rowKey, { id: `water-replacement-${nextId++}`, ...data });
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
    tx: {
      waterReplacementRecord
    } as unknown as Pick<Prisma.TransactionClient, "waterReplacementRecord">
  };
}

test("本日の記録だけをハムスターごとの交換済み状態へ対応付ける", () => {
  const now = new Date("2026-07-28T10:00:00.000Z");
  const records = [
    {
      hamsterId: "hamster-1",
      recordDate: new Date("2026-07-27T00:00:00.000Z"),
      replacedAt: new Date("2026-07-27T10:00:00.000Z")
    },
    {
      hamsterId: "hamster-2",
      recordDate: new Date("2026-07-28T00:00:00.000Z"),
      replacedAt: new Date("2026-07-28T10:05:00.000Z")
    }
  ];

  const byHamster = todayWaterReplacementRecordsByHamster(records, now);
  assert.equal(byHamster.has("hamster-1"), false);
  assert.equal(
    byHamster.get("hamster-2")?.replacedAt.toISOString(),
    "2026-07-28T10:05:00.000Z"
  );
  assert.equal(todayWaterReplacementRecordsByHamster([], now).size, 0);
});

test("本日の水替え日付はUTCではなくJSTの日付境界で切り替わる", () => {
  assert.equal(
    toDateInputValue(
      getTodayWaterReplacementRecordDate(new Date("2026-07-28T14:59:59.999Z"))
    ),
    "2026-07-28"
  );
  assert.equal(
    toDateInputValue(
      getTodayWaterReplacementRecordDate(new Date("2026-07-28T15:00:00.000Z"))
    ),
    "2026-07-29"
  );
});

test("8時境界の直前は前日、8時ちょうどは当日のお世話日へ水替えを登録・取消する", async () => {
  const database = createFakeTransaction();
  const common = { hamsterId: "hamster-1", createdByUserId: "user-1", careDayStartMinutes: 480 };
  const beforeBoundary = new Date("2026-08-01T22:59:59.999Z");
  const atBoundary = new Date("2026-08-01T23:00:00.000Z");

  const previousDay = await setTodayWaterReplacementState(database.tx, {
    ...common,
    state: "marked",
    now: beforeBoundary
  });
  assert.equal(toDateInputValue(previousDay.recordDate), "2026-08-01");
  assert.equal(previousDay.record?.replacedAt.toISOString(), beforeBoundary.toISOString());
  const cancelled = await setTodayWaterReplacementState(database.tx, {
    ...common,
    state: "unmarked",
    now: beforeBoundary
  });
  assert.equal(cancelled.changed, true);
  assert.equal(database.rows.size, 0);

  const currentDay = await setTodayWaterReplacementState(database.tx, {
    ...common,
    state: "marked",
    now: atBoundary
  });
  assert.equal(toDateInputValue(currentDay.recordDate), "2026-08-02");
});

test("交換済み化と取消を冪等に処理し、同日レコードを重複作成しない", async () => {
  const database = createFakeTransaction();
  const input = {
    hamsterId: "hamster-1",
    createdByUserId: "user-1",
    now: new Date("2026-07-28T10:05:00.000Z")
  };

  const firstMark = await setTodayWaterReplacementState(database.tx, {
    ...input,
    state: "marked"
  });
  const duplicateMark = await setTodayWaterReplacementState(database.tx, {
    ...input,
    state: "marked"
  });
  assert.equal(firstMark.changed, true);
  assert.equal(duplicateMark.changed, false);
  assert.equal(database.rows.size, 1);

  const firstUnmark = await setTodayWaterReplacementState(database.tx, {
    ...input,
    state: "unmarked"
  });
  const duplicateUnmark = await setTodayWaterReplacementState(database.tx, {
    ...input,
    state: "unmarked"
  });
  assert.equal(firstUnmark.changed, true);
  assert.equal(duplicateUnmark.changed, false);
  assert.equal(database.rows.size, 0);
});

test("同時の交換済み化でも複合一意キー相当の処理で1件だけ作成する", async () => {
  const database = createFakeTransaction();
  const input = {
    hamsterId: "hamster-1",
    createdByUserId: "user-1",
    state: "marked" as const,
    now: new Date("2026-07-28T10:05:00.000Z")
  };

  const results = await Promise.all([
    setTodayWaterReplacementState(database.tx, input),
    setTodayWaterReplacementState(database.tx, input)
  ]);

  assert.equal(results.filter((result) => result.changed).length, 1);
  assert.equal(database.rows.size, 1);
});

test("Prismaモデルとmigrationが日単位の一意性、交換日時、操作者を保持する", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source(
    "prisma/migrations/20260728230000_add_water_replacement_records/migration.sql"
  );

  assert.match(
    schema,
    /model WaterReplacementRecord[\s\S]*recordDate\s+DateTime[\s\S]*replacedAt\s+DateTime/
  );
  assert.match(schema, /createdByUserId\s+String\?/);
  assert.match(schema, /@@unique\(\[hamsterId, recordDate\]\)/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "water_replacement_records_hamster_id_record_date_key"/
  );
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /ADD VALUE 'WATER_REPLACEMENT_MARKED'/);
  assert.match(migration, /ADD VALUE 'WATER_REPLACEMENT_UNMARKED'/);
});

test("Server Actionは共通認可、所属・管理状態確認、履歴、revision、安全な副作用を再利用する", () => {
  const action = source("src/app/actions/water-replacement.ts");
  const waterReplacement = source("src/lib/water-replacement.ts");

  assert.match(action, /getRequiredHouseholdMutationContext\("\/"\)/);
  assert.match(action, /tx\.hamster\.findUnique/);
  assert.match(action, /tx\.householdMember\.findUnique/);
  assert.match(action, /careDayStartMinutes: membership\.household\.careDayStartMinutes/);
  assert.match(
    action,
    /belongsToCurrentHousehold\(hamster\.householdId, context\.household\.id\)/
  );
  assert.match(action, /if \(!hamster\.isActive\) redirect\("\/\?status=locked"\)/);
  assert.match(action, /commitHouseholdMutation\(\{/);
  assert.match(action, /source: "waterReplacement"/);
  assert.match(action, /WATER_REPLACEMENT_MARKED/);
  assert.match(action, /WATER_REPLACEMENT_UNMARKED/);
  assert.match(action, /result\.changed[\s\S]*category: "CARE_RECORD"/);
  assert.match(action, /targetNameSnapshot: result\.hamsterName/);
  assert.match(action, /details: \{ recordDate: toDateInputValue\(result\.recordDate\) \}/);
  assert.match(action, /publishHouseholdChangeSafely\(change\)/);
  assert.match(action, /revalidatePathsSafely\(/);
  assert.match(action, /redirect\("\/"\)/);
  assert.match(action, /redirect\("\/\?status=invalid"\)/);
  assert.match(action, /redirect\("\/\?status=locked"\)/);
  assert.match(action, /handleServerActionError\(/);
  assert.match(waterReplacement, /createMany\([\s\S]*skipDuplicates: true/);
  assert.match(waterReplacement, /deleteMany\(/);
});

test("ダッシュボードは表示対象IDの本日分を1クエリで一括取得して紐付ける", () => {
  const queries = source("src/lib/queries.ts");

  assert.match(
    queries,
    /prisma\.waterReplacementRecord\.findMany\([\s\S]*hamsterId: \{ in: dashboardHamsterIds \}[\s\S]*recordDate: careDayRecordDate/
  );
  assert.match(queries, /const careDayRecordDate = getCareDayRecordDate\(now, careDayStartMinutes\)/);
  assert.equal(
    queries.match(/prisma\.waterReplacementRecord\.findMany\(/g)?.length,
    1
  );
  assert.match(
    queries,
    /todayWaterReplacement: waterReplacementByHamster\.get\(hamster\.id\) \?\? null/
  );
});

test("通常ダッシュボードは食事直下・最新体重の上に操作可能な水替えを表示する", () => {
  const dashboard = source("src/app/(app)/page.tsx");
  const feedingPosition = dashboard.indexOf("<FeedingToggle");
  const waterPosition = dashboard.indexOf("<WaterReplacementToggle");
  const weightPosition = dashboard.indexOf("<Scale");

  assert.ok(feedingPosition >= 0);
  assert.ok(waterPosition > feedingPosition);
  assert.ok(weightPosition > waterPosition);
  assert.match(dashboard, /action=\{setTodayWaterReplacement\}/);
  assert.match(dashboard, /canEdit=\{canEdit\}/);
  assert.match(dashboard, /isActive=\{hamster\.isActive\}/);
});

test("水替え項目は交換状態、支援技術向け時刻、無効状態を正しく表示する", () => {
  const unmarked = renderToStaticMarkup(
    <WaterReplacementToggle
      hamsterId="hamster-1"
      hamsterName="きなこ"
      replacedAt={null}
      readOnly
    />
  );
  const marked = renderToStaticMarkup(
    <WaterReplacementToggle
      hamsterId="hamster-1"
      hamsterName="きなこ"
      replacedAt="2026-07-28T10:05:00.000Z"
      readOnly
    />
  );

  assert.match(unmarked, /aria-pressed="false"/);
  assert.match(unmarked, />未交換</);
  assert.match(unmarked, /disabled=""/);
  assert.match(unmarked, /サンプル閲覧モードでは変更できません/);
  assert.match(marked, /aria-pressed="true"/);
  assert.match(marked, />交換済み</);
  assert.doesNotMatch(marked, />19:05に交換済み</);
  assert.match(marked, /19:05に交換済みです/);
  assert.match(marked, /きなこの水替えは/);
});

test("保存中・VIEWER・管理外・デモ読み取り専用の操作制御を食事と揃える", () => {
  const component = source("src/components/water-replacement-toggle.tsx");
  const demoPage = source("src/app/demo/page.tsx");
  const viewer = renderToStaticMarkup(
    <WaterReplacementToggle
      hamsterId="hamster-1"
      hamsterName="きなこ"
      replacedAt={null}
      canEdit={false}
    />
  );
  const inactive = renderToStaticMarkup(
    <WaterReplacementToggle
      hamsterId="hamster-1"
      hamsterName="きなこ"
      replacedAt={null}
      isActive={false}
    />
  );
  const demo = renderToStaticMarkup(
    <WaterReplacementToggle
      hamsterId="hamster-1"
      hamsterName="きなこ"
      replacedAt={null}
      readOnly
    />
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
  assert.match(viewer, /閲覧者は水替え状態を変更できません/);
  assert.match(inactive, /管理外のハムスターは変更できません/);
  assert.doesNotMatch(inactive, /hover:bg-slate-100/);
  assert.match(demo, /disabled=""/);
  assert.doesNotMatch(demo, /disabled:opacity-65/);
  assert.match(demoPage, /<WaterReplacementToggle[\s\S]*readOnly/);
  assert.doesNotMatch(
    demoPage,
    /actions\/water-replacement|setTodayWaterReplacement/
  );
});

test("公開デモは専用Householdの当日水替えだけを一括取得し、交換済みと未交換を表示できる", () => {
  const queries = source("src/lib/public-demo-queries.ts");
  const seed = source("prisma/seed-demo.ts");

  assert.match(queries, /const household = await getPublicDemoHousehold\(\)/);
  assert.match(
    queries,
    /prisma\.waterReplacementRecord\.findMany\([\s\S]*hamsterId: \{ in: hamsterIds \}[\s\S]*getTodayWaterReplacementRecordDate/
  );
  assert.match(
    queries,
    /todayWaterReplacement: waterReplacements\.get\(hamster\.id\) \?\? null/
  );
  assert.match(seed, /waterReplacementRecords:/);
  assert.ok(
    (seed.match(/waterReplacementRow\("/g)?.length ?? 0) >= 3,
    "複数の交換済みデモデータが必要です。"
  );
});

test("既存の食事項目は変更せず、両項目がダッシュボードに共存する", () => {
  const feedingComponent = source("src/components/feeding-toggle.tsx");
  const dashboard = source("src/app/(app)/page.tsx");

  assert.match(feedingComponent, /食事/);
  assert.match(
    feedingComponent,
    /const stateLabel = isMarked \? "実施済み" : "未実施"/
  );
  assert.match(dashboard, /<FeedingToggle/);
  assert.match(dashboard, /<WaterReplacementToggle/);
});
