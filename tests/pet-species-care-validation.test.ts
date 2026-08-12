import assert from "node:assert/strict";
import test from "node:test";

import { getCareDayDateInputJst, getCareDayRecordDate } from "../src/lib/care-day";
import { toDateInputValue } from "../src/lib/date";
import { isFuturePetCareTimestamp, isTimestampInCareDate, parseJstDateTimeLocal } from "../src/lib/pet-care";
import {
  createPetLitterRecordSchema,
  createPetWalkRecordSchema,
  deletePetLitterRecordSchema,
  deletePetWalkRecordSchema,
  updatePetLitterRecordSchema,
  updatePetWalkRecordSchema
} from "../src/lib/schemas";

const walk = { petId: "dog-1", startedAt: "2026-08-12T20:00", durationMinutes: "30", memo: "公園まで" };
const litter = { petId: "cat-1", occurredAt: "2026-08-12T20:15", action: "DEFECATION", memo: "普通" };

test("Walkは厳密なJST datetime-localを受け付ける", () => {
  assert.equal(createPetWalkRecordSchema.safeParse(walk).success, true);
  assert.equal(createPetWalkRecordSchema.safeParse({ ...walk, startedAt: "2026-02-29T20:00" }).success, false);
  assert.equal(createPetWalkRecordSchema.safeParse({ ...walk, startedAt: "2026-08-12 20:00" }).success, false);
});

test("Walk durationは空をnull化し1〜1440の整数だけを許可する", () => {
  for (const empty of ["", "   "]) {
    const result = createPetWalkRecordSchema.safeParse({ ...walk, durationMinutes: empty });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.durationMinutes, null);
  }
  for (const durationMinutes of ["1", "30", "1440"]) {
    assert.equal(createPetWalkRecordSchema.safeParse({ ...walk, durationMinutes }).success, true);
  }
  for (const durationMinutes of ["0", "1441", "30.5", "abc"]) {
    assert.equal(createPetWalkRecordSchema.safeParse({ ...walk, durationMinutes }).success, false);
  }
});

test("Walk memoは空白をnull化し500文字を許可して501文字を拒否する", () => {
  const empty = createPetWalkRecordSchema.safeParse({ ...walk, memo: "  " });
  assert.equal(empty.success, true);
  if (empty.success) assert.equal(empty.data.memo, null);
  assert.equal(createPetWalkRecordSchema.safeParse({ ...walk, memo: "a".repeat(500) }).success, true);
  assert.equal(createPetWalkRecordSchema.safeParse({ ...walk, memo: "a".repeat(501) }).success, false);
});

test("Litter actionは4種類だけを許可する", () => {
  for (const action of ["URINATION", "DEFECATION", "BOTH", "CLEANED"]) {
    assert.equal(createPetLitterRecordSchema.safeParse({ ...litter, action }).success, true);
  }
  assert.equal(createPetLitterRecordSchema.safeParse({ ...litter, action: "UNKNOWN" }).success, false);
});

test("Litterは厳密な日時と500文字memoを検証する", () => {
  assert.equal(createPetLitterRecordSchema.safeParse({ ...litter, occurredAt: "2026-02-29T20:00" }).success, false);
  const empty = createPetLitterRecordSchema.safeParse({ ...litter, memo: "  " });
  assert.equal(empty.success, true);
  if (empty.success) assert.equal(empty.data.memo, null);
  assert.equal(createPetLitterRecordSchema.safeParse({ ...litter, memo: "a".repeat(500) }).success, true);
  assert.equal(createPetLitterRecordSchema.safeParse({ ...litter, memo: "a".repeat(501) }).success, false);
});

test("Walk/Litter timestampから04:00境界のお世話日を算出する", () => {
  const before = parseJstDateTimeLocal("2026-08-13T03:59");
  const boundary = parseJstDateTimeLocal("2026-08-13T04:00");
  assert.equal(getCareDayDateInputJst(before, 240), "2026-08-12");
  assert.equal(toDateInputValue(getCareDayRecordDate(before, 240)), "2026-08-12");
  assert.equal(toDateInputValue(getCareDayRecordDate(boundary, 240)), "2026-08-13");
  assert.equal(isTimestampInCareDate(before, "2026-08-12", 240), true);
  assert.equal(isTimestampInCareDate(boundary, "2026-08-12", 240), false);
});

test("未来Walk/Litter timestampを共通Server Action utilityで判定する", () => {
  const now = new Date("2026-08-12T11:00:00.000Z");
  assert.equal(isFuturePetCareTimestamp(parseJstDateTimeLocal("2026-08-12T20:01"), now), true);
  assert.equal(isFuturePetCareTimestamp(parseJstDateTimeLocal("2026-08-12T20:00"), now), false);
});

test("Walk/Litter更新・削除schemaは記録IDとPet IDを必須とする", () => {
  assert.equal(updatePetWalkRecordSchema.safeParse({ ...walk, id: "walk-1" }).success, true);
  assert.equal(updatePetLitterRecordSchema.safeParse({ ...litter, id: "litter-1" }).success, true);
  assert.equal(deletePetWalkRecordSchema.safeParse({ id: "walk-1", petId: "dog-1" }).success, true);
  assert.equal(deletePetLitterRecordSchema.safeParse({ id: "litter-1", petId: "cat-1" }).success, true);
  assert.equal(deletePetWalkRecordSchema.safeParse({ id: "", petId: "dog-1" }).success, false);
  assert.equal(deletePetLitterRecordSchema.safeParse({ id: "litter-1", petId: "" }).success, false);
});
