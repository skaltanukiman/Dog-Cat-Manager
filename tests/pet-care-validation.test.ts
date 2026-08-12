import assert from "node:assert/strict";
import test from "node:test";

import { getCareDayDateInputJst, getCareDayRecordDate } from "../src/lib/care-day";
import { toDateInputValue } from "../src/lib/date";
import {
  formatJstDateTimeLocal,
  isFuturePetCareTimestamp,
  isSameInputMinute,
  isTimestampInCareDate,
  normalizePetCareDate,
  parseJstDateTimeLocal
} from "../src/lib/pet-care";
import {
  createPetFeedingRecordSchema,
  createPetWaterRecordSchema,
  deletePetFeedingRecordSchema,
  deletePetWaterRecordSchema,
  updatePetFeedingRecordSchema,
  updatePetWaterRecordSchema
} from "../src/lib/schemas";

const feeding = { petId: "pet-1", fedAt: "2026-08-12T18:30", memo: "食欲あり" };
const water = { petId: "pet-1", caredAt: "2026-08-12T19:15", action: "REPLACED", memo: "容器も洗浄" };

test("JST datetime-localをOS timezone非依存でUTCへ変換し、編集値へ戻せる", () => {
  const timestamp = parseJstDateTimeLocal("2026-08-12T18:30");
  assert.equal(timestamp.toISOString(), "2026-08-12T09:30:00.000Z");
  assert.equal(formatJstDateTimeLocal(timestamp), "2026-08-12T18:30");
});

test("datetime-localは厳密な分精度と実在日時だけを許可する", () => {
  for (const value of ["2026-08-12 18:30", "2026-8-12T18:30", "2026-08-12T18:30:00", "2026-02-29T12:00", "2026-08-12T24:00"]) {
    assert.throws(() => parseJstDateTimeLocal(value));
  }
  assert.equal(parseJstDateTimeLocal("2028-02-29T23:59").toISOString(), "2028-02-29T14:59:00.000Z");
});

test("未来timestampはServer Action用utilityで拒否し、変更なしは分精度で比較する", () => {
  const now = new Date("2026-08-12T09:30:30.000Z");
  assert.equal(isFuturePetCareTimestamp(new Date("2026-08-12T09:31:00.000Z"), now), true);
  assert.equal(isFuturePetCareTimestamp(new Date("2026-08-12T09:30:00.000Z"), now), false);
  assert.equal(isSameInputMinute(new Date("2026-08-12T09:30:59.999Z"), new Date("2026-08-12T09:30:00.000Z")), true);
});

test("careDayStartMinutes=0ではJST暦日、04:00では03:59が前日・04:00が当日になる", () => {
  const before = parseJstDateTimeLocal("2026-08-13T03:59");
  const boundary = parseJstDateTimeLocal("2026-08-13T04:00");
  assert.equal(getCareDayDateInputJst(before, 0), "2026-08-13");
  assert.equal(getCareDayDateInputJst(before, 240), "2026-08-12");
  assert.equal(getCareDayDateInputJst(boundary, 240), "2026-08-13");
  assert.equal(toDateInputValue(getCareDayRecordDate(before, 240)), "2026-08-12");
  assert.equal(isTimestampInCareDate(before, "2026-08-12", 240), true);
});

test("Household設定変更は新しい計算結果だけを変え、既存recordDate値は書き換えない", () => {
  const timestamp = parseJstDateTimeLocal("2026-08-13T02:00");
  const storedRecordDate = getCareDayRecordDate(timestamp, 240);
  assert.equal(toDateInputValue(storedRecordDate), "2026-08-12");
  assert.equal(toDateInputValue(getCareDayRecordDate(timestamp, 0)), "2026-08-13");
  assert.equal(toDateInputValue(storedRecordDate), "2026-08-12");
});

test("未来・不正なお世話日queryは現在のお世話日へ正規化する", () => {
  assert.equal(normalizePetCareDate("2026-08-11", "2026-08-12"), "2026-08-11");
  assert.equal(normalizePetCareDate("2026-08-13", "2026-08-12"), "2026-08-12");
  assert.equal(normalizePetCareDate("invalid", "2026-08-12"), "2026-08-12");
});

test("食事・水メモは空白をnull化し500文字を許可して501文字を拒否する", () => {
  const emptyFeeding = createPetFeedingRecordSchema.safeParse({ ...feeding, memo: "  " });
  const emptyWater = createPetWaterRecordSchema.safeParse({ ...water, memo: "  " });
  assert.equal(emptyFeeding.success, true);
  assert.equal(emptyWater.success, true);
  if (emptyFeeding.success) assert.equal(emptyFeeding.data.memo, null);
  if (emptyWater.success) assert.equal(emptyWater.data.memo, null);
  assert.equal(createPetFeedingRecordSchema.safeParse({ ...feeding, memo: "a".repeat(500) }).success, true);
  assert.equal(createPetFeedingRecordSchema.safeParse({ ...feeding, memo: "a".repeat(501) }).success, false);
  assert.equal(createPetWaterRecordSchema.safeParse({ ...water, memo: "a".repeat(500) }).success, true);
  assert.equal(createPetWaterRecordSchema.safeParse({ ...water, memo: "a".repeat(501) }).success, false);
});

test("水actionはREPLACEDとREFILLEDだけを許可する", () => {
  assert.equal(createPetWaterRecordSchema.safeParse(water).success, true);
  assert.equal(createPetWaterRecordSchema.safeParse({ ...water, action: "REFILLED" }).success, true);
  assert.equal(createPetWaterRecordSchema.safeParse({ ...water, action: "REPLACEMENT" }).success, false);
});

test("作成・更新・削除schemaはPet IDと記録IDを検証する", () => {
  assert.equal(updatePetFeedingRecordSchema.safeParse({ ...feeding, id: "feeding-1" }).success, true);
  assert.equal(updatePetWaterRecordSchema.safeParse({ ...water, id: "water-1" }).success, true);
  assert.equal(deletePetFeedingRecordSchema.safeParse({ id: "feeding-1", petId: "pet-1" }).success, true);
  assert.equal(deletePetWaterRecordSchema.safeParse({ id: "water-1", petId: "pet-1" }).success, true);
  assert.equal(deletePetFeedingRecordSchema.safeParse({ id: "", petId: "pet-1" }).success, false);
  assert.equal(deletePetWaterRecordSchema.safeParse({ id: "water-1", petId: "" }).success, false);
});
