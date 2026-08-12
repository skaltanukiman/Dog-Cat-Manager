import assert from "node:assert/strict";
import test from "node:test";

import { parseDateInput, toDateInputValue, todayInputJst } from "../src/lib/date";
import {
  createPetWeightRecordSchema,
  deletePetWeightRecordSchema,
  updatePetWeightRecordSchema
} from "../src/lib/schemas";
import { isPetWeightInHundredths, MAX_PET_WEIGHT_KG } from "../src/lib/pet-weight-rules";

const validInput = {
  petId: "pet-1",
  recordDate: "2026-08-12",
  weightKg: "5.25",
  memo: "夕食前"
};

test("Pet体重は正の値かつ0.01kg単位だけを受け付ける", () => {
  assert.equal(createPetWeightRecordSchema.safeParse(validInput).success, true);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, weightKg: "0.01" }).success, true);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, weightKg: "8.40" }).success, true);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, weightKg: "0" }).success, false);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, weightKg: "-1" }).success, false);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, weightKg: "5.251" }).success, false);
  assert.equal(isPetWeightInHundredths(32.1), true);
  assert.equal(isPetWeightInHundredths(32.101), false);
});

test("Pet体重はDecimal(5,2)の上限を超えられない", () => {
  assert.equal(MAX_PET_WEIGHT_KG, 999.99);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, weightKg: "999.99" }).success, true);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, weightKg: "1000.00" }).success, false);
});

test("Pet体重の測定日は実在する未来でない暦日に限る", () => {
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, recordDate: "2026-02-29" }).success, false);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, recordDate: "invalid" }).success, false);

  const tomorrow = new Date(parseDateInput(todayInputJst()).getTime() + 24 * 60 * 60 * 1000);
  assert.equal(
    createPetWeightRecordSchema.safeParse({ ...validInput, recordDate: toDateInputValue(tomorrow) }).success,
    false
  );
});

test("Pet体重メモは空文字をnull化し500文字を上限とする", () => {
  const empty = createPetWeightRecordSchema.safeParse({ ...validInput, memo: "   " });
  assert.equal(empty.success, true);
  if (empty.success) assert.equal(empty.data.memo, null);

  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, memo: "a".repeat(500) }).success, true);
  assert.equal(createPetWeightRecordSchema.safeParse({ ...validInput, memo: "a".repeat(501) }).success, false);
});

test("Pet体重の編集・削除schemaはPet IDと記録IDを必須とする", () => {
  assert.equal(updatePetWeightRecordSchema.safeParse({ ...validInput, id: "record-1" }).success, true);
  assert.equal(updatePetWeightRecordSchema.safeParse({ ...validInput, id: "" }).success, false);
  assert.equal(deletePetWeightRecordSchema.safeParse({ id: "record-1", petId: "pet-1" }).success, true);
  assert.equal(deletePetWeightRecordSchema.safeParse({ id: "record-1", petId: "" }).success, false);
});
