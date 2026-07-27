import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CleaningMobileDayFilter, CleaningMobileForm } from "../src/components/cleaning-mobile-form";
import {
  DEFAULT_CLEANING_MOBILE_DATE_FILTER,
  normalizeCleaningMobileDefaultDateFilter,
  resolveCleaningMobileInitialSelectedDate
} from "../src/lib/cleaning-settings";

const dates = ["2026-07-26", "2026-07-27"];

function resolve(defaultDateFilter: string | null | undefined, yearMonth = "2026-07", availableDates = dates) {
  return resolveCleaningMobileInitialSelectedDate({
    defaultDateFilter,
    yearMonth,
    currentYearMonth: "2026-07",
    today: "2026-07-27",
    dates: availableDates
  });
}

test("未設定値と不正なDB値はtodayへ正規化する", () => {
  assert.equal(DEFAULT_CLEANING_MOBILE_DATE_FILTER, "today");
  assert.equal(normalizeCleaningMobileDefaultDateFilter(undefined), "today");
  assert.equal(normalizeCleaningMobileDefaultDateFilter(null), "today");
  assert.equal(normalizeCleaningMobileDefaultDateFilter("invalid"), "today");
  assert.equal(normalizeCleaningMobileDefaultDateFilter("today"), "today");
  assert.equal(normalizeCleaningMobileDefaultDateFilter("all"), "all");
});

test("今月のtoday設定は今日を初期選択する", () => {
  assert.equal(resolve("today"), "2026-07-27");
});

test("today設定でも過去月または今日が一覧にない場合は全日付へフォールバックする", () => {
  assert.equal(resolve("today", "2026-06", ["2026-06-01", "2026-06-30"]), "all");
  assert.equal(resolve("today", "2026-07", ["2026-07-26"]), "all");
});

test("all設定は今月でも全日付を初期選択する", () => {
  assert.equal(resolve("all"), "all");
});

test("日付プルダウンとスマホ入力カードは同じ初期選択値で描画される", () => {
  const initialSelectedDate = resolve("today");
  const dayOptions = [
    { date: "2026-07-26", day: 26, weekday: "日" },
    { date: "2026-07-27", day: 27, weekday: "月" }
  ];
  const filterMarkup = renderToStaticMarkup(
    <CleaningMobileDayFilter days={dayOptions} initialSelectedDate={initialSelectedDate} />
  );
  const formMarkup = renderToStaticMarkup(
    <CleaningMobileForm
      days={dayOptions.map((day) => ({
        ...day,
        isFuture: false,
        isToday: day.date === "2026-07-27",
        record: null
      }))}
      hamsterId="hamster-1"
      includeInactive={false}
      isLocked={false}
      initialSelectedDate={initialSelectedDate}
      readOnly
      recordsVersion="version-1"
      yearMonth="2026-07"
    />
  );

  assert.match(filterMarkup, /data-cleaning-selected-date="2026-07-27"/);
  assert.match(formMarkup, /data-cleaning-selected-date="2026-07-27"/);
  assert.match(filterMarkup, /<option value="2026-07-27" selected="">27日/);
  assert.match(formMarkup, /data-cleaning-date="2026-07-26" data-cleaning-visible="false"/);
  assert.match(formMarkup, /data-cleaning-date="2026-07-27" data-cleaning-visible="true"/);
});

test("PC用月間テーブルは従来のlg表示と全日付mapを維持する", () => {
  const page = readFileSync(
    new URL("../src/app/(app)/cleaning/page.tsx", import.meta.url),
    "utf8"
  );

  assert.match(page, /className="hidden space-y-4 lg:block"/);
  assert.match(page, /<tbody>[\s\S]*?\{days\.map\(\(day\) => \{/);
  assert.match(page, /<CleaningMobileDayFilter[\s\S]*?initialSelectedDate=\{mobileInitialSelectedDate\}/);
  assert.match(page, /<CleaningMobileForm[\s\S]*?initialSelectedDate=\{mobileInitialSelectedDate\}/);
});
