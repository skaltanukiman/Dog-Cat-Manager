import type {
  HealthAmountCondition,
  HealthExcretionCondition,
  HealthOverallCondition,
  HealthSymptom,
  PetRecordType,
  Prisma
} from "@prisma/client";

import { isValidDateInput, parseDateInput } from "@/lib/date";
import type {
  PetHealthRecordInput,
  PetMedicalRecordInput,
  PetMedicationRecordInput,
  PetMemoryRecordInput,
  PetVaccinationRecordInput
} from "@/lib/pet-record-schemas";
import { normalizeSearchText } from "@/lib/search";
import { normalizeTagStorageValue } from "@/lib/tags";

export const PET_RECORD_PAGE_SIZE = 20;
export const PET_RECORD_SCOPES = ["pet", "household"] as const;
export type PetRecordScope = (typeof PET_RECORD_SCOPES)[number];
export const DEFAULT_PET_RECORD_SCOPE: PetRecordScope = "pet";
export type PetRecordCreateKind = "health" | "medical" | "medication" | "vaccination" | "memory";

export const PET_RECORD_TYPE_LABELS: Record<PetRecordType, string> = {
  HEALTH: "健康・体調",
  MEDICAL: "通院",
  MEDICATION: "投薬",
  VACCINATION: "ワクチン",
  MEMORY: "思い出"
};

export const PET_HEALTH_OVERALL_LABELS: Record<HealthOverallCondition, string> = {
  GOOD: "良好",
  CONCERN: "少し気になる",
  WARNING: "要注意"
};

export const PET_HEALTH_AMOUNT_LABELS: Record<HealthAmountCondition, string> = {
  NORMAL: "普通",
  LOW: "少ない",
  NONE: "なし・ほとんどない",
  UNKNOWN: "未確認"
};

export const PET_HEALTH_EXCRETION_LABELS: Record<HealthExcretionCondition, string> = {
  NORMAL: "通常",
  LOW: "少ない",
  ABNORMAL: "異常あり",
  UNKNOWN: "未確認"
};

export const PET_HEALTH_SYMPTOM_LABELS: Record<HealthSymptom, string> = {
  SNEEZING: "くしゃみ",
  RUNNY_NOSE: "鼻水",
  EYE_DISCHARGE: "目やに",
  HAIR_LOSS: "脱毛",
  BLEEDING: "出血",
  LUMP: "しこり",
  DIARRHEA: "軟便・下痢",
  UNSTEADY: "ふらつき",
  ABNORMAL_BREATHING: "呼吸の異常",
  LOSS_OF_APPETITE: "食欲低下",
  OTHER: "その他"
};

export const PET_MEMORY_TAG_SUGGESTIONS = [
  "お迎え",
  "初めて",
  "日常",
  "かわいい行動",
  "寝姿",
  "食事",
  "遊び",
  "誕生日",
  "記念日"
] as const;

export type PetRecordTypeFilter = "all" | "health" | "medical" | "medication" | "vaccination" | "memory";

export type PetRecordsUrlOptions = {
  scope?: PetRecordScope;
  includeScope?: boolean;
  petId?: string | null;
  includeInactive?: boolean;
  type?: PetRecordTypeFilter;
  from?: string;
  to?: string;
  keyword?: string;
  favoriteOnly?: boolean;
  page?: number;
  status?: string;
  errorId?: string;
};

export function normalizePetRecordScope(value?: string | null): PetRecordScope {
  return value === "household" ? "household" : DEFAULT_PET_RECORD_SCOPE;
}

export function petRecordsUrl(options: PetRecordsUrlOptions = {}) {
  const params = new URLSearchParams();
  if (options.scope === "household" || (options.includeScope && options.scope === "pet")) {
    params.set("scope", options.scope);
  }
  if (options.petId) params.set("petId", options.petId);
  if (options.includeInactive) params.set("includeInactive", "1");
  if (options.type && options.type !== "all") params.set("type", options.type);
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  if (options.keyword) params.set("keyword", options.keyword);
  if (options.favoriteOnly) params.set("favorite", "1");
  if (options.page && options.page > 1) params.set("page", String(options.page));
  if (options.status) params.set("status", options.status);
  if (options.errorId) params.set("errorId", options.errorId);
  return `/records${params.size ? `?${params.toString()}` : ""}`;
}

export function normalizePetRecordTypeFilter(value?: string): PetRecordTypeFilter {
  return value === "health" || value === "medical" || value === "medication" || value === "vaccination" || value === "memory"
    ? value
    : "all";
}

export function filterToPetRecordType(value: PetRecordTypeFilter): PetRecordType | undefined {
  if (value === "health") return "HEALTH";
  if (value === "medical") return "MEDICAL";
  if (value === "medication") return "MEDICATION";
  if (value === "vaccination") return "VACCINATION";
  if (value === "memory") return "MEMORY";
  return undefined;
}

export function normalizePetRecordPage(value?: string) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function normalizePetRecordDateFilter(value?: string) {
  return value && isValidDateInput(value) ? value : "";
}

export function normalizePetRecordKeyword(value?: string) {
  return value?.trim().slice(0, 100) ?? "";
}

export type PetRecordSearchTerm = { value: string; isTag: boolean };

export function parsePetRecordSearchTerms(keyword: string): PetRecordSearchTerm[] {
  return keyword
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const normalizedPart = part.normalize("NFKC");
      const isTag = normalizedPart.startsWith("#");
      return { value: (isTag ? normalizedPart.slice(1) : part).trim(), isTag };
    })
    .filter((term) => Boolean(term.value));
}

function toKatakana(value: string) {
  return value.replace(/[\u3041-\u3096]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0x60)
  );
}

export function getPetRecordSearchVariants(value: string) {
  const original = value.trim().toLocaleLowerCase("ja-JP");
  const nfkc = original.normalize("NFKC");
  const hiragana = normalizeSearchText(original);
  return Array.from(new Set([original, nfkc, hiragana, toKatakana(hiragana)].filter(Boolean)));
}

/** 通常語群とタグ群をAND、各群の候補をORにしたDB検索条件へ変換する。 */
export function buildPetRecordKeywordWhere(keyword: string): Prisma.PetRecordWhereInput | undefined {
  const terms = parsePetRecordSearchTerms(keyword);
  const keywordConditions = terms
    .filter((term) => !term.isTag)
    .flatMap<Prisma.PetRecordWhereInput>((term) =>
      getPetRecordSearchVariants(term.value).map((variant) => ({
        searchText: { contains: variant, mode: "insensitive" }
      }))
    );
  const tagConditions = terms
    .filter((term) => term.isTag)
    .flatMap<Prisma.PetRecordWhereInput>((term) =>
      getPetRecordSearchVariants(term.value).map((variant) => ({
        recordType: "MEMORY",
        memoryDetail: { is: { searchTags: { has: variant } } }
      }))
    );
  const groups = [keywordConditions, tagConditions]
    .filter((conditions) => conditions.length > 0)
    .map<Prisma.PetRecordWhereInput>((conditions) => ({ OR: conditions }));

  if (groups.length === 0) return undefined;
  return groups.length === 1 ? groups[0] : { AND: groups };
}

/** Household境界を常に含め、Memoryだけは中間テーブルの全関連Petから個別scopeを判定する。 */
export function buildPetRecordScopeWhere(
  scope: PetRecordScope,
  householdId: string,
  selectedPetId: string
): Prisma.PetRecordWhereInput {
  return {
    pet: { householdId },
    ...(scope === "pet"
      ? {
          OR: [
            { recordType: { in: ["HEALTH", "MEDICAL", "MEDICATION", "VACCINATION"] }, petId: selectedPetId },
            {
              recordType: "MEMORY",
              memoryDetail: {
                is: { pets: { some: { petId: selectedPetId, pet: { householdId } } } }
              }
            }
          ]
        }
      : {})
  };
}

export function buildPetRecordListWhere({
  scope,
  householdId,
  selectedPetId,
  recordType,
  from,
  to,
  keyword,
  favoriteOnly
}: {
  scope: PetRecordScope;
  householdId: string;
  selectedPetId: string;
  recordType: PetRecordTypeFilter;
  from: string;
  to: string;
  keyword: string;
  favoriteOnly: boolean;
}): Prisma.PetRecordWhereInput {
  const databaseRecordType = filterToPetRecordType(recordType);
  const keywordWhere = buildPetRecordKeywordWhere(keyword);
  const scopeWhere = buildPetRecordScopeWhere(scope, householdId, selectedPetId);
  const { OR: scopeAlternatives, ...scopeBoundary } = scopeWhere;
  const applyFavoriteFilter = favoriteOnly && (recordType === "all" || recordType === "memory");
  return {
    ...scopeBoundary,
    ...(databaseRecordType ? { recordType: databaseRecordType } : {}),
    ...(from || to
      ? {
          recordDate: {
            ...(from ? { gte: parseDateInput(from) } : {}),
            ...(to ? { lte: parseDateInput(to) } : {})
          }
        }
      : {}),
    ...(scopeAlternatives && keywordWhere
      ? { AND: [{ OR: scopeAlternatives }, keywordWhere] }
      : {
          ...(scopeAlternatives ? { OR: scopeAlternatives } : {}),
          ...(keywordWhere ?? {})
        }),
    ...(applyFavoriteFilter ? { recordType: "MEMORY", memoryDetail: { is: { isFavorite: true } } } : {})
  };
}

export function collectPetRecordTagSuggestions(rows: ReadonlyArray<{ tags: string[] }>) {
  const tagsByNormalizedValue = new Map<string, string>();
  for (const { tags } of rows) {
    for (const tag of tags) {
      const normalized = normalizeTagStorageValue(tag);
      if (normalized && !tagsByNormalizedValue.has(normalized)) {
        tagsByNormalizedValue.set(normalized, tag);
      }
    }
  }
  return Array.from(tagsByNormalizedValue.values()).sort((left, right) => left.localeCompare(right, "ja"));
}

export function buildPetSavedMemoryTagRows(householdId: string, createdByUserId: string, tags: readonly string[]) {
  return tags.map((value) => {
    const name = normalizeTagStorageValue(value);
    return { householdId, createdByUserId, name, normalizedName: name };
  });
}

export function buildPetMemoryTagSearchValues(tags: readonly string[]) {
  return Array.from(
    new Set(tags.map((tag) => normalizeTagStorageValue(tag).toLocaleLowerCase("ja-JP")).filter(Boolean))
  );
}

export function buildPetHealthRecordTitle(overallCondition: HealthOverallCondition) {
  return `体調: ${PET_HEALTH_OVERALL_LABELS[overallCondition]}`;
}

export function buildPetMedicalRecordTitle(hospitalName: string | null) {
  return hospitalName ? `通院: ${hospitalName}` : "通院記録";
}

export function buildPetMedicationRecordTitle(medicationName: string) {
  return `投薬: ${medicationName}`;
}

export function buildPetVaccinationRecordTitle(vaccineName: string) {
  return vaccineName;
}

function joinSearchText(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP");
}

export function buildPetHealthSearchText(input: PetHealthRecordInput) {
  return joinSearchText([
    buildPetHealthRecordTitle(input.overallCondition),
    PET_HEALTH_OVERALL_LABELS[input.overallCondition],
    PET_HEALTH_AMOUNT_LABELS[input.appetite],
    PET_HEALTH_AMOUNT_LABELS[input.activityLevel],
    PET_HEALTH_EXCRETION_LABELS[input.stoolCondition],
    PET_HEALTH_EXCRETION_LABELS[input.urineCondition],
    ...input.symptoms.map((symptom) => PET_HEALTH_SYMPTOM_LABELS[symptom]),
    input.memo
  ]);
}

export function buildPetMedicalSearchText(input: PetMedicalRecordInput) {
  return joinSearchText([
    buildPetMedicalRecordTitle(input.hospitalName),
    input.hospitalName,
    input.reason,
    input.diagnosis,
    input.examination,
    input.treatment,
    input.medication,
    input.medicationInstructions,
    input.memo
  ]);
}

export function buildPetMedicationSearchText(input: PetMedicationRecordInput) {
  return joinSearchText([
    buildPetMedicationRecordTitle(input.medicationName),
    input.medicationName,
    input.dosage,
    input.memo
  ]);
}

export function buildPetVaccinationSearchText(input: PetVaccinationRecordInput) {
  return joinSearchText([
    buildPetVaccinationRecordTitle(input.vaccineName),
    input.vaccineName,
    input.hospitalName,
    input.memo
  ]);
}

export function buildPetMemorySearchText(input: PetMemoryRecordInput, petNames: readonly string[] = []) {
  return joinSearchText([input.title, input.content, ...input.tags, ...petNames]);
}

export function isSameOrderedStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
