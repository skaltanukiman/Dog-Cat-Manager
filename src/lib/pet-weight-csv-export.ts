import type { Prisma } from "@prisma/client";

import { toCsv } from "@/lib/csv";
import { isValidYearMonthInput, monthDateRange, toDateInputValue } from "@/lib/date";

export const PET_WEIGHT_CSV_FORMATS = ["standard", "detailed"] as const;

export type PetWeightCsvFormat = (typeof PET_WEIGHT_CSV_FORMATS)[number];

export const PET_WEIGHT_CSV_STANDARD_HEADER = ["date", "pet_name", "species", "weight_kg", "memo"] as const;

export const PET_WEIGHT_CSV_DETAILED_HEADER = [
  "app_id",
  "record_type",
  "schema_version",
  "record_id",
  "pet_id",
  "date",
  "pet_name",
  "species",
  "weight_kg",
  "memo",
  "created_at",
  "updated_at"
] as const;

export const PET_WEIGHT_CSV_IDENTITY = {
  appId: "dog-cat-manager",
  recordType: "pet_weight_record",
  schemaVersion: "1"
} as const;

export type PetWeightCsvRecord = {
  id: string;
  petId: string;
  recordDate: Date;
  weightKg: { toString(): string };
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
  pet: {
    id: string;
    name: string;
    species: "DOG" | "CAT";
  };
};

export class PetWeightCsvExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PetWeightCsvExportValidationError";
  }
}

/**
 * Excelなどがユーザー入力を数式として評価しないよう、危険な先頭文字を文字列として固定する。
 * CSVの引用符・改行エスケープは、この処理の後に共通の`toCsv`へ委譲する。
 */
export function sanitizePetWeightCsvUserText(value: string | null) {
  if (value === null) return null;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** timestampをJST固定のISO 8601へ変換する。日付専用のrecordDateには使用しない。 */
export function formatPetWeightCsvTimestamp(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().replace(/Z$/, "+09:00");
}

export function parsePetWeightCsvExportOptions(searchParams: URLSearchParams) {
  const petId = searchParams.get("petId") || undefined;
  const month = searchParams.get("month") || undefined;
  const format = searchParams.get("format") || "standard";

  if (month && !isValidYearMonthInput(month)) {
    throw new PetWeightCsvExportValidationError("年月の指定が不正です。");
  }
  if (!PET_WEIGHT_CSV_FORMATS.includes(format as PetWeightCsvFormat)) {
    throw new PetWeightCsvExportValidationError("出力形式の指定が不正です。");
  }

  return { petId, month, format: format as PetWeightCsvFormat };
}

/** Household境界をDB検索条件の基点にし、任意のPet・年月フィルターを重ねる。 */
export function createPetWeightCsvRecordWhere(
  householdId: string,
  petId: string | undefined,
  month: string | undefined
): Prisma.PetWeightRecordWhereInput {
  const where: Prisma.PetWeightRecordWhereInput = { pet: { householdId } };
  if (petId) where.petId = petId;
  if (month) {
    const { start, end } = monthDateRange(month);
    where.recordDate = { gte: start, lt: end };
  }
  return where;
}

function recordToStandardCsvRow(record: PetWeightCsvRecord) {
  return [
    toDateInputValue(record.recordDate),
    sanitizePetWeightCsvUserText(record.pet.name),
    record.pet.species,
    record.weightKg.toString(),
    sanitizePetWeightCsvUserText(record.memo)
  ];
}

function recordToDetailedCsvRow(record: PetWeightCsvRecord) {
  return [
    PET_WEIGHT_CSV_IDENTITY.appId,
    PET_WEIGHT_CSV_IDENTITY.recordType,
    PET_WEIGHT_CSV_IDENTITY.schemaVersion,
    record.id,
    record.petId,
    ...recordToStandardCsvRow(record),
    formatPetWeightCsvTimestamp(record.createdAt),
    formatPetWeightCsvTimestamp(record.updatedAt)
  ];
}

export function buildPetWeightCsvRows(records: readonly PetWeightCsvRecord[], format: PetWeightCsvFormat) {
  if (format === "detailed") {
    return [[...PET_WEIGHT_CSV_DETAILED_HEADER], ...records.map(recordToDetailedCsvRow)];
  }

  return [[...PET_WEIGHT_CSV_STANDARD_HEADER], ...records.map(recordToStandardCsvRow)];
}

export function toPetWeightCsv(records: readonly PetWeightCsvRecord[], format: PetWeightCsvFormat) {
  // Excelで日本語を正しく開けるよう、CSV本文の先頭へUTF-8 BOMを付ける。
  return `\uFEFF${toCsv(buildPetWeightCsvRows(records, format))}`;
}

export function getPetWeightCsvFilename(month: string | undefined, format: PetWeightCsvFormat) {
  const parts = ["dog_cat_weights"];
  if (format === "detailed") parts.push("detailed");
  if (month) parts.push(month);
  return `${parts.join("_")}.csv`;
}
