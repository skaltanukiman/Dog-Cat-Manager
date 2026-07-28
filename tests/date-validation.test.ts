import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDateJp,
  formatDateJst,
  formatDateTimeJst,
  formatTimeJst,
  getDaysInMonth,
  isValidDateInput,
  isValidYearMonthInput,
  monthDateRange,
  normalizeYearMonth,
  parseDateInput,
  toDateInputValue
} from "../src/lib/date";
import { cleaningMonthSchema, createHamsterSchema, createWeightRecordSchema } from "../src/lib/schemas";
import { parseWeightCsvImport } from "../src/lib/weight-csv-import";

test("実在する日付と閏日だけを受け付ける", () => {
  assert.equal(isValidDateInput("2024-02-29"), true);
  assert.equal(isValidDateInput("2026-02-28"), true);
  assert.equal(isValidDateInput("2026-02-29"), false);
  assert.equal(isValidDateInput("2026-02-31"), false);
  assert.equal(isValidDateInput("2026-13-01"), false);
  assert.equal(isValidDateInput("2026-00-01"), false);
  assert.equal(isValidDateInput("0000-01-01"), false);
  assert.equal(isValidDateInput("2026-7-01"), false);
});

test("不正日付を別の日へ正規化せず例外にする", () => {
  assert.equal(toDateInputValue(parseDateInput("2024-02-29")), "2024-02-29");
  assert.throws(() => parseDateInput("2026-02-31"), /Invalid date input/);
});

test("時刻を持つUTC timestampはJSTの日付と日時へ変換して表示する", () => {
  const beforeJstMidnight = new Date("2026-07-14T14:59:00.000Z");
  const afterJstMidnight = new Date("2026-07-14T15:01:00.000Z");

  assert.equal(formatDateJst(beforeJstMidnight), "2026/07/14");
  assert.equal(formatDateTimeJst(beforeJstMidnight), "2026/07/14 23:59");
  assert.equal(formatDateJst(afterJstMidnight), "2026/07/15");
  assert.equal(formatDateTimeJst(afterJstMidnight), "2026/07/15 00:01");
  assert.equal(formatTimeJst(beforeJstMidnight), "23:59");
  assert.equal(formatTimeJst(afterJstMidnight), "00:01");
  assert.equal(formatDateTimeJst(undefined), "未記録");
});

test("日付のみのDB値はタイムゾーン変換せず同じ暦日を表示する", () => {
  assert.equal(formatDateJp(new Date("2026-07-14T00:00:00.000Z")), "2026/07/14");
});

test("年月は1月から12月だけを受け付ける", () => {
  assert.equal(isValidYearMonthInput("2026-01"), true);
  assert.equal(isValidYearMonthInput("2026-12"), true);
  assert.equal(isValidYearMonthInput("2026-00"), false);
  assert.equal(isValidYearMonthInput("2026-13"), false);
  assert.equal(isValidYearMonthInput("0000-01"), false);
  assert.equal(normalizeYearMonth("2026-13"), normalizeYearMonth(undefined));
  assert.throws(() => getDaysInMonth("2026-13"), /Invalid month input/);
});

test("月範囲は年末から翌年へ正しく進む", () => {
  const range = monthDateRange("2026-12");
  assert.equal(toDateInputValue(range.start), "2026-12-01");
  assert.equal(toDateInputValue(range.end), "2027-01-01");
});

test("画面用schemaも不正な暦日と年月を拒否する", () => {
  assert.equal(
    createHamsterSchema.safeParse({ name: "しろ", memo: "", birthDate: "2026-02-31", adoptionDate: "" }).success,
    false
  );
  assert.equal(
    createWeightRecordSchema.safeParse({ hamsterId: "hamster-1", recordDate: "2026-02-31", weightG: "120" }).success,
    false
  );
  assert.equal(cleaningMonthSchema.safeParse({ hamsterId: "hamster-1", yearMonth: "2026-13" }).success, false);
});

test("CSV取込も存在しない日付を拒否する", () => {
  const parsed = parseWeightCsvImport("date,hamster,weight\n2026/02/31,しろ,120", "2026-12-31");
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /YYYY\/MM\/DD形式の日付/);
});
