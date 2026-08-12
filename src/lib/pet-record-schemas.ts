import { z } from "zod";

import { isValidDateInput } from "@/lib/date";
import { parseRecordTimeInput } from "@/lib/record-time";
import { normalizeTagStorageValue } from "@/lib/tags";

const idSchema = z.string().trim().min(1);
// Pet Recordsはお世話日境界を使わず、入力されたJST暦日をそのまま保持する。
const dateSchema = z.string().trim().refine(isValidDateInput, "invalidDate");
const updatedAtSchema = z
  .string()
  .trim()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const optionalDateSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.union([dateSchema, z.null()])
);

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.union([z.string().trim().max(max), z.null()])
  );

const optionalRecordTime = z.preprocess((value) => {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  if (typeof value !== "string") return Number.NaN;
  return parseRecordTimeInput(value.trim()) ?? Number.NaN;
}, z.union([z.number().int().min(0).max(1439), z.null()]));

const checkboxSchema = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean()
);

export const PET_HEALTH_OVERALL_CONDITIONS = ["GOOD", "CONCERN", "WARNING"] as const;
export const PET_HEALTH_AMOUNT_CONDITIONS = ["NORMAL", "LOW", "NONE", "UNKNOWN"] as const;
export const PET_HEALTH_EXCRETION_CONDITIONS = ["NORMAL", "LOW", "ABNORMAL", "UNKNOWN"] as const;
export const PET_HEALTH_SYMPTOMS = [
  "SNEEZING",
  "RUNNY_NOSE",
  "EYE_DISCHARGE",
  "HAIR_LOSS",
  "BLEEDING",
  "LUMP",
  "DIARRHEA",
  "UNSTEADY",
  "ABNORMAL_BREATHING",
  "LOSS_OF_APPETITE",
  "OTHER"
] as const;

export const MAX_PET_MEMORY_RECORD_PETS = 100;
export const MAX_PET_MEMORY_TAGS = 20;
export const MAX_PET_MEMORY_TAG_LENGTH = 30;
export const MAX_PET_MEMORY_TITLE_LENGTH = 100;
export const MAX_PET_RECORD_MEMO_LENGTH = 2000;

const petHealthBaseSchema = z.object({
  petId: idSchema,
  recordDate: dateSchema,
  recordTime: optionalRecordTime,
  overallCondition: z.enum(PET_HEALTH_OVERALL_CONDITIONS),
  appetite: z.enum(PET_HEALTH_AMOUNT_CONDITIONS),
  activityLevel: z.enum(PET_HEALTH_AMOUNT_CONDITIONS),
  stoolCondition: z.enum(PET_HEALTH_EXCRETION_CONDITIONS),
  urineCondition: z.enum(PET_HEALTH_EXCRETION_CONDITIONS),
  symptoms: z.array(z.enum(PET_HEALTH_SYMPTOMS)).max(PET_HEALTH_SYMPTOMS.length),
  memo: optionalText(MAX_PET_RECORD_MEMO_LENGTH)
});

export const createPetHealthRecordSchema = petHealthBaseSchema;
export const updatePetHealthRecordSchema = petHealthBaseSchema.extend({
  id: idSchema,
  updatedAt: updatedAtSchema
});

const consultationFeeSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return Number.NaN;
    return Number(trimmed);
  }
  return value;
}, z.union([z.number().int().min(0).max(99_999_999), z.null()]));

const petMedicalBaseSchema = z
  .object({
    petId: idSchema,
    recordDate: dateSchema,
    recordTime: optionalRecordTime,
    hospitalName: optionalText(120),
    reason: z.string().trim().min(1).max(2000),
    diagnosis: optionalText(2000),
    examination: optionalText(2000),
    treatment: optionalText(2000),
    medication: optionalText(2000),
    medicationInstructions: optionalText(2000),
    nextVisitDate: optionalDateSchema,
    consultationFee: consultationFeeSchema,
    memo: optionalText(MAX_PET_RECORD_MEMO_LENGTH)
  })
  .superRefine((value, context) => {
    if (value.nextVisitDate !== null && value.nextVisitDate < value.recordDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextVisitDate"],
        message: "beforeRecordDate"
      });
    }
  });

export const createPetMedicalRecordSchema = petMedicalBaseSchema;
export const updatePetMedicalRecordSchema = petMedicalBaseSchema.and(
  z.object({ id: idSchema, updatedAt: updatedAtSchema })
);

const petMedicationBaseSchema = z.object({
  petId: idSchema,
  recordDate: dateSchema,
  recordTime: optionalRecordTime,
  medicationName: z.string().trim().min(1).max(200),
  dosage: optionalText(100),
  memo: optionalText(MAX_PET_RECORD_MEMO_LENGTH)
});

export const createPetMedicationRecordSchema = petMedicationBaseSchema;
export const updatePetMedicationRecordSchema = petMedicationBaseSchema.extend({
  id: idSchema,
  updatedAt: updatedAtSchema
});

const petVaccinationBaseSchema = z
  .object({
    petId: idSchema,
    recordDate: dateSchema,
    recordTime: optionalRecordTime,
    vaccineName: z.string().trim().min(1).max(200),
    hospitalName: optionalText(200),
    nextDueDate: optionalDateSchema,
    memo: optionalText(MAX_PET_RECORD_MEMO_LENGTH)
  })
  .superRefine((value, context) => {
    if (value.nextDueDate !== null && value.nextDueDate < value.recordDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextDueDate"],
        message: "beforeRecordDate"
      });
    }
  });

export const createPetVaccinationRecordSchema = petVaccinationBaseSchema;
export const updatePetVaccinationRecordSchema = petVaccinationBaseSchema.and(
  z.object({ id: idSchema, updatedAt: updatedAtSchema })
);

function normalizeTags(value: unknown) {
  if (typeof value !== "string") return value;
  return [
    ...new Set(
      value
        .split(/[,，、]/)
        .map(normalizeTagStorageValue)
        .filter(Boolean)
    )
  ];
}

function normalizeSavedMemoryTags(value: unknown) {
  if (!Array.isArray(value)) return value;
  return [
    ...new Set(
      value
        .map((tag) => (typeof tag === "string" ? normalizeTagStorageValue(tag) : tag))
        .filter(Boolean)
    )
  ];
}

const petMemoryFields = {
  petId: idSchema,
  petIds: z
    .array(idSchema)
    .min(1)
    .max(MAX_PET_MEMORY_RECORD_PETS)
    .transform((ids) => [...new Set(ids)]),
  recordDate: dateSchema,
  recordTime: optionalRecordTime,
  title: z.string().trim().min(1).max(MAX_PET_MEMORY_TITLE_LENGTH),
  content: z.string().trim().min(1).max(5000),
  tags: z.preprocess(
    normalizeTags,
    z.array(z.string().min(1).max(MAX_PET_MEMORY_TAG_LENGTH)).max(MAX_PET_MEMORY_TAGS)
  ),
  isFavorite: checkboxSchema
};

export const petMemoryBaseSchema = z.object(petMemoryFields);

export const createPetMemoryRecordSchema = z
  .object({ ...petMemoryFields, saveTags: checkboxSchema })
  .superRefine((value, context) => {
    if (!value.petIds.includes(value.petId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["petIds"],
        message: "representativeRequired"
      });
    }
  });

export const updatePetMemoryRecordSchema = z.object({
  ...petMemoryFields,
  id: idSchema,
  updatedAt: updatedAtSchema
});

export const deletePetRecordSchema = z.object({
  id: idSchema,
  petId: idSchema
});

export const deletePetSavedMemoryTagsSchema = z.object({
  tags: z.preprocess(
    normalizeSavedMemoryTags,
    z.array(z.string().min(1).max(MAX_PET_MEMORY_TAG_LENGTH)).min(1).max(1000)
  )
});

export type PetHealthRecordInput = z.infer<typeof petHealthBaseSchema>;
export type PetMedicalRecordInput = z.infer<typeof petMedicalBaseSchema>;
export type PetMedicationRecordInput = z.infer<typeof petMedicationBaseSchema>;
export type PetVaccinationRecordInput = z.infer<typeof petVaccinationBaseSchema>;
export type PetMemoryRecordInput = z.infer<typeof petMemoryBaseSchema>;
