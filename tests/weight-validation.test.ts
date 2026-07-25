import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createWeightRecordSchema, updateWeightRecordSchema } from "../src/lib/schemas";
import { parseWeightCsvImport } from "../src/lib/weight-csv-import";
import {
  getAppliedWeightChartRange,
  isCompleteWeightChartRange,
  normalizeWeightChartRange
} from "../src/lib/weight-chart-filter";
import { isWeightInTenths } from "../src/lib/weight-rules";

test("体重履歴は管理一覧と同じ共通ページングを上下に使用する", async () => {
  const pageSource = await readFile("src/app/(app)/weights/page.tsx", "utf8");
  const paginationSource = await readFile("src/components/pagination.tsx", "utf8");

  assert.equal(pageSource.match(/<PaginationLayout/g)?.length, 2);
  assert.equal(pageSource.match(/scroll=\{false\}/g)?.length, 2);
  assert.equal(pageSource.match(/preserveScroll/g)?.length, 2);
  assert.match(
    pageSource,
    /<PaginationLayout[\s\S]*?<WeightHistoryList[\s\S]*?<PaginationLayout/
  );
  assert.doesNotMatch(pageSource, /ChevronsLeft|ChevronsRight|最初へ|最後へ/);
  assert.match(paginationSource, /getPaginationItems/);
  assert.match(paginationSource, /aria-current="page"/);
  assert.match(paginationSource, /sm:hidden/);
  assert.match(paginationSource, /sm:flex/);
  assert.match(paginationSource, /<ScrollPreservingLink/);
});

test("体重履歴の数字リンクは遷移先で保存したスクロール座標を復元する", async () => {
  const source = await readFile("src/components/scroll-preserving-link.tsx", "utf8");

  assert.match(source, /window\.sessionStorage\.setItem/);
  assert.match(source, /destination\.pathname !== window\.location\.pathname/);
  assert.match(source, /destination\.search !== window\.location\.search/);
  assert.match(
    source,
    /destination\.pathname !==[\s\S]*?destination\.search !==[\s\S]*?return;[\s\S]*?sessionStorage\.removeItem/
  );
  assert.match(source, /window\.scrollTo\(stored\.x, stored\.y\)/);
  assert.match(source, /scroll=\{false\}/);
});

test("体重履歴のページ移動は既存の表示条件を共通URL生成関数へ渡す", async () => {
  const source = await readFile("src/app/(app)/weights/page.tsx", "utf8");

  assert.match(source, /const buildWeightPageHref = \(page: number\)/);
  for (const property of [
    "hamsterId: selectedHamster.id",
    "filterMode",
    "month: selectedMonth",
    "chartFrom: chartRange.from",
    "chartTo: chartRange.to",
    "page",
    "sortTarget",
    "sortDirection",
    "includeInactive"
  ]) {
    assert.match(source, new RegExp(property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(source.match(/buildHref=\{buildWeightPageHref\}/g)?.length, 2);
});

test("グラフ期間は実在する開始日と終了日だけを受け付ける", () => {
  assert.deepEqual(normalizeWeightChartRange("2026-06-01", "2026-06-30"), {
    from: "2026-06-01",
    to: "2026-06-30"
  });
  assert.deepEqual(normalizeWeightChartRange("2026-06-31", "invalid"), {
    from: undefined,
    to: undefined
  });
});

test("グラフ専用期間は全件表示だけに適用し、月ごと表示では適用しない", () => {
  assert.deepEqual(getAppliedWeightChartRange("all", "2026-06-01", "2026-06-30"), {
    from: "2026-06-01",
    to: "2026-06-30"
  });
  assert.deepEqual(getAppliedWeightChartRange("month", "2026-06-01", "2026-06-30"), {});
});

test("グラフ期間は開始日と終了日の両方が有効な場合だけ自動反映できる", () => {
  assert.equal(isCompleteWeightChartRange("2026-06-01", "2026-06-30"), true);
  assert.equal(isCompleteWeightChartRange("2026-06-01", ""), false);
  assert.equal(isCompleteWeightChartRange("", "2026-06-30"), false);
  assert.equal(isCompleteWeightChartRange("2026-06-31", "2026-07-01"), false);
  assert.equal(isCompleteWeightChartRange("2026-07-01", "2026-06-30"), false);
});

test("体重は整数または0.1g単位だけを受け付ける", () => {
  assert.equal(isWeightInTenths(121), true);
  assert.equal(isWeightInTenths(121.1), true);
  assert.equal(isWeightInTenths(0.3), true);
  assert.equal(isWeightInTenths(121.11), false);
  assert.equal(isWeightInTenths(121.1111111), false);
});

test("通常登録と編集のschemaは0.1gより細かい値を拒否する", () => {
  const base = { hamsterId: "hamster-1", recordDate: "2026-07-12" };
  assert.equal(createWeightRecordSchema.safeParse({ ...base, weightG: "121.1" }).success, true);
  assert.equal(createWeightRecordSchema.safeParse({ ...base, weightG: "121.1111111" }).success, false);
  assert.equal(updateWeightRecordSchema.safeParse({ ...base, id: "weight-1", weightG: "121.11" }).success, false);
});

test("CSV取込は0.1gより細かい値を行エラーにする", () => {
  const csv = [
    "date,hamster,weight,unit",
    "2026/07/12,しろ,121.1,g",
    "2026/07/12,くろ,121.1111111,g"
  ].join("\n");
  const parsed = parseWeightCsvImport(csv, "2026-07-12");

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].weightG, 121.1);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /0.1g単位/);
});
