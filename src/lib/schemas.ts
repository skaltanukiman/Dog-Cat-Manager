import { z } from "zod";

import { MAX_DASHBOARD_BOARD_COUNT, MIN_DASHBOARD_BOARD_COUNT } from "@/lib/dashboard-settings";
import { isValidDateInput, parseDateInput, todayInputJst } from "@/lib/date";
import {
  isPetWeightInHundredths,
  MAX_PET_WEIGHT_KG,
  PET_WEIGHT_MEMO_MAX_LENGTH
} from "@/lib/pet-weight-rules";
import {
  isValidJstDateTimeLocal,
  MAX_WALK_DISTANCE_METERS,
  PET_CARE_MEMO_MAX_LENGTH
} from "@/lib/pet-care";

export const idSchema = z.string().min(1);

export const dateInputSchema = z.string().refine(isValidDateInput);

// 空文字のメモはDBへ空文字ではなくnullで保存し、未入力として扱いを統一する。
const nullableMemoSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().max(2000).nullable());

const nullableBreedSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().max(100).nullable());

// 任意の日付入力は空欄ならnull、入力ありならDB保存用のDateへ正規化する。
const nullableDateInputSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return dateInputSchema.safeParse(trimmed).success ? parseDateInput(trimmed) : value;
}, z.date().nullable());

// 誕生日・お迎え日はプロフィールの日付なので、ブラウザ制限を迂回した未来日の送信も保存前に弾く。
const nullablePastOrTodayDateInputSchema = nullableDateInputSchema.refine(
  (value) => value === null || value.getTime() <= parseDateInput(todayInputJst()).getTime(),
  { message: "future" }
);

export const createPetSchema = z.object({
  name: z.string().trim().min(1).max(15),
  species: z.enum(["DOG", "CAT"]),
  breed: nullableBreedSchema,
  sex: z.enum(["MALE", "FEMALE", "UNKNOWN"]),
  birthDate: nullablePastOrTodayDateInputSchema,
  adoptionDate: nullablePastOrTodayDateInputSchema,
  memo: nullableMemoSchema
});

export const updatePetSchema = createPetSchema.omit({
  species: true
}).extend({
  id: idSchema
});

export const updatePetActiveStatusSchema = z.object({
  id: idSchema,
  isActive: z.enum(["true", "false"]).transform((value) => value === "true")
});

const petWeightRecordDateSchema = z
  .string()
  .refine(isValidDateInput, { message: "invalidDate" })
  .refine((value) => !isValidDateInput(value) || value <= todayInputJst(), { message: "future" });

// Pet体重メモは空文字を未入力として統一し、DBのVARCHAR(500)上限に合わせる。
const nullablePetWeightMemoSchema = z.preprocess((value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().max(PET_WEIGHT_MEMO_MAX_LENGTH).nullable());

export const createPetWeightRecordSchema = z.object({
  petId: idSchema,
  recordDate: petWeightRecordDateSchema,
  weightKg: z.coerce
    .number()
    .positive({ message: "positive" })
    .max(MAX_PET_WEIGHT_KG, { message: "max" })
    .refine(isPetWeightInHundredths, { message: "weightIncrement" }),
  memo: nullablePetWeightMemoSchema
});

export const updatePetWeightRecordSchema = createPetWeightRecordSchema.extend({
  id: idSchema
});

export const deletePetWeightRecordSchema = z.object({
  id: idSchema,
  petId: idSchema
});

const petCareDateTimeSchema = z.string().refine(isValidJstDateTimeLocal, { message: "invalidDateTime" });

// Pet Careのメモは空白だけなら未入力として扱い、DBのVARCHAR(500)と上限を揃える。
const nullablePetCareMemoSchema = z.preprocess((value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().max(PET_CARE_MEMO_MAX_LENGTH).nullable());

export const createPetFeedingRecordSchema = z.object({
  petId: idSchema,
  fedAt: petCareDateTimeSchema,
  memo: nullablePetCareMemoSchema
});

export const updatePetFeedingRecordSchema = createPetFeedingRecordSchema.extend({
  id: idSchema
});

export const deletePetFeedingRecordSchema = z.object({
  id: idSchema,
  petId: idSchema
});

export const createPetWaterRecordSchema = z.object({
  petId: idSchema,
  caredAt: petCareDateTimeSchema,
  action: z.enum(["REPLACED", "REFILLED"]),
  memo: nullablePetCareMemoSchema
});

export const updatePetWaterRecordSchema = createPetWaterRecordSchema.extend({
  id: idSchema
});

export const deletePetWaterRecordSchema = z.object({
  id: idSchema,
  petId: idSchema
});

const nullableWalkDurationSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.coerce.number().int().min(1).max(1440).nullable());

// km文字列の桁数を検証してから整数meterへ変換し、小数の丸めによる不正入力の受理を防ぐ。
const nullableWalkDistanceMetersSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return value;
  const wholeKm = Number(match[1]);
  const hundredthsKm = Number((match[2] ?? "").padEnd(2, "0"));
  const distanceMeters = wholeKm * 1000 + hundredthsKm * 10;
  return Number.isSafeInteger(distanceMeters) ? distanceMeters : value;
}, z.number().int().min(10).max(MAX_WALK_DISTANCE_METERS).nullable());

const petWalkRecordSchema = z.object({
  petId: idSchema,
  startedAt: petCareDateTimeSchema,
  durationMinutes: nullableWalkDurationSchema,
  distanceMeters: nullableWalkDistanceMetersSchema,
  memo: nullablePetCareMemoSchema
});

/** FormDataのkm入力名を、Actionが扱うDB保存用meter値へ正規化する。 */
function normalizePetWalkDistanceInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return { ...value, distanceMeters: (value as Record<string, unknown>).distanceKm };
}

export const createPetWalkRecordSchema = z.preprocess(normalizePetWalkDistanceInput, petWalkRecordSchema);

export const updatePetWalkRecordSchema = z.preprocess(
  normalizePetWalkDistanceInput,
  petWalkRecordSchema.extend({ id: idSchema })
);

export const deletePetWalkRecordSchema = z.object({
  id: idSchema,
  petId: idSchema
});

export const createPetLitterRecordSchema = z.object({
  petId: idSchema,
  occurredAt: petCareDateTimeSchema,
  action: z.enum(["URINATION", "DEFECATION", "BOTH", "CLEANED"]),
  memo: nullablePetCareMemoSchema
});

export const updatePetLitterRecordSchema = createPetLitterRecordSchema.extend({
  id: idSchema
});

export const deletePetLitterRecordSchema = z.object({
  id: idSchema,
  petId: idSchema
});

export const dashboardSettingsSchema = z.object({
  dashboardBoardCount: z.coerce.number().int().min(MIN_DASHBOARD_BOARD_COUNT).max(MAX_DASHBOARD_BOARD_COUNT),
  petIds: z
    .array(idSchema)
    .refine((ids) => new Set(ids).size === ids.length, { message: "Pet IDが重複しています。" })
});

export const updateUserProfileSchema = z.object({
  name: z.string().trim().min(1).max(50)
});

export const updateHouseholdNameSchema = z.object({
  name: z.string().trim().min(1).max(50)
});
