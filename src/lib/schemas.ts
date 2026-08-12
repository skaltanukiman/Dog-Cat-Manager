import { z } from "zod";

import { CLEANING_MOBILE_DEFAULT_DATE_FILTERS } from "@/lib/cleaning-settings";
import { HAMSTER_SELECTOR_MODES, MAX_DASHBOARD_BOARD_COUNT, MIN_DASHBOARD_BOARD_COUNT } from "@/lib/dashboard-settings";
import { isValidDateInput, isValidYearMonthInput, parseDateInput, todayInputJst } from "@/lib/date";
import { RECORD_SCOPES } from "@/lib/records";
import {
  isPetWeightInHundredths,
  MAX_PET_WEIGHT_KG,
  PET_WEIGHT_MEMO_MAX_LENGTH
} from "@/lib/pet-weight-rules";
import { isValidJstDateTimeLocal, PET_CARE_MEMO_MAX_LENGTH } from "@/lib/pet-care";
import { isWeightInTenths, MAX_WEIGHT_G } from "@/lib/weight-rules";

export const idSchema = z.string().min(1);

export const dateInputSchema = z.string().refine(isValidDateInput);
export const yearMonthSchema = z.string().refine(isValidYearMonthInput);

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

export const createHamsterSchema = z.object({
  name: z.string().trim().min(1).max(15),
  memo: nullableMemoSchema,
  birthDate: nullablePastOrTodayDateInputSchema,
  adoptionDate: nullablePastOrTodayDateInputSchema
});

export const updateHamsterSchema = createHamsterSchema.extend({
  id: idSchema
});

export const deleteHamsterSchema = z.object({
  id: idSchema
});

export const deleteHamstersSchema = z.object({
  ids: z.array(idSchema).min(1)
});

export const updateHamsterActiveStatusSchema = z.object({
  id: idSchema,
  isActive: z.enum(["true", "false"]).transform((value) => value === "true")
});

export const createPetSchema = z.object({
  name: z.string().trim().min(1).max(50),
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

export const createPetWalkRecordSchema = z.object({
  petId: idSchema,
  startedAt: petCareDateTimeSchema,
  durationMinutes: nullableWalkDurationSchema,
  memo: nullablePetCareMemoSchema
});

export const updatePetWalkRecordSchema = createPetWalkRecordSchema.extend({
  id: idSchema
});

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

export const createWeightRecordSchema = z.object({
  hamsterId: idSchema,
  recordDate: dateInputSchema,
  weightG: z.coerce.number().positive().max(MAX_WEIGHT_G).refine(isWeightInTenths, { message: "weightIncrement" })
});

export const updateWeightRecordSchema = createWeightRecordSchema.extend({
  id: idSchema
});

export const deleteWeightRecordSchema = z.object({
  id: idSchema,
  hamsterId: idSchema
});

export const deleteWeightRecordsSchema = z.object({
  ids: z.array(idSchema).min(1),
  hamsterId: idSchema
});

export const cleaningMonthSchema = z.object({
  hamsterId: idSchema,
  yearMonth: yearMonthSchema
});

export const feedingStateSchema = z.object({
  hamsterId: idSchema,
  state: z.enum(["marked", "unmarked"])
});

export const waterReplacementStateSchema = z.object({
  hamsterId: idSchema,
  state: z.enum(["marked", "unmarked"])
});

export const dashboardSettingsSchema = z.object({
  dashboardBoardCount: z.coerce.number().int().min(MIN_DASHBOARD_BOARD_COUNT).max(MAX_DASHBOARD_BOARD_COUNT),
  hamsterSelectorMode: z.enum(HAMSTER_SELECTOR_MODES),
  recordTimelineDefaultScope: z.enum(RECORD_SCOPES),
  cleaningMobileDefaultDateFilter: z.enum(CLEANING_MOBILE_DEFAULT_DATE_FILTERS),
  hamsterIds: z
    .array(idSchema)
    .refine((ids) => new Set(ids).size === ids.length, { message: "ハムスターIDが重複しています。" })
});

export const updateUserProfileSchema = z.object({
  name: z.string().trim().min(1).max(50)
});

export const updateHouseholdNameSchema = z.object({
  name: z.string().trim().min(1).max(50)
});
