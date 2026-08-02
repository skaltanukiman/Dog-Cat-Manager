import type {
  HealthAmountCondition,
  HealthExcretionCondition,
  HealthOverallCondition,
  HealthSymptom,
  HamsterRecordType,
  Prisma
} from "@prisma/client";

import { isValidDateInput, parseDateInput } from "@/lib/date";
import type { HealthRecordInput, MedicalRecordInput, MemoryRecordInput } from "@/lib/record-schemas";
import { normalizeSearchText } from "@/lib/search";
import { normalizeTagStorageValue } from "@/lib/tags";

export const RECORD_PAGE_SIZE = 20;
export const RECORD_SCOPES = ["hamster", "household"] as const;
export type RecordScope = (typeof RECORD_SCOPES)[number];
export const DEFAULT_RECORD_SCOPE: RecordScope = "hamster";
export type RecordCreateKind = "health" | "medical" | "memory";

export function recordCreateKindForHamsterStatus(currentKind: RecordCreateKind, hamsterIsActive: boolean): RecordCreateKind {
  // 管理外の個体には新しい健康・通院記録を追加できないが、過去の思い出は引き続き残せる。
  return hamsterIsActive ? currentKind : "memory";
}

export const RECORD_TYPE_LABELS: Record<HamsterRecordType, string> = {
  HEALTH: "健康・体調",
  MEDICAL: "通院",
  MEMORY: "思い出"
};

export const HEALTH_OVERALL_LABELS: Record<HealthOverallCondition, string> = {
  GOOD: "良好",
  CONCERN: "少し気になる",
  WARNING: "要注意"
};

export const HEALTH_AMOUNT_LABELS: Record<HealthAmountCondition, string> = {
  NORMAL: "普通",
  LOW: "少ない",
  NONE: "なし・ほとんどない",
  UNKNOWN: "未確認"
};

export const HEALTH_EXCRETION_LABELS: Record<HealthExcretionCondition, string> = {
  NORMAL: "通常",
  LOW: "少ない",
  ABNORMAL: "異常あり",
  UNKNOWN: "未確認"
};

export const HEALTH_SYMPTOM_LABELS: Record<HealthSymptom, string> = {
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

export const MEMORY_TAG_SUGGESTIONS = [
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

export type RecordTypeFilter = "all" | "health" | "medical" | "memory";

export type RecordsUrlOptions = {
  basePath?: "/records" | "/demo/records";
  scope?: RecordScope;
  includeScope?: boolean;
  hamsterId?: string | null;
  type?: RecordTypeFilter;
  from?: string;
  to?: string;
  keyword?: string;
  favoriteOnly?: boolean;
  page?: number;
  status?: string;
};

export function normalizeRecordScope(value?: string | null): RecordScope {
  return value === "hamster" || value === "household" ? value : DEFAULT_RECORD_SCOPE;
}

export function resolveRecordScope({
  hasScopeParam,
  scopeParam,
  defaultScope
}: {
  hasScopeParam: boolean;
  scopeParam?: string;
  defaultScope?: string | null;
}): RecordScope {
  return normalizeRecordScope(hasScopeParam ? scopeParam : defaultScope);
}

export function recordsUrl(options: RecordsUrlOptions = {}) {
  const params = new URLSearchParams();
  if (options.scope === "household" || (options.includeScope && options.scope === "hamster")) {
    params.set("scope", options.scope);
  }
  if (options.hamsterId) params.set("hamsterId", options.hamsterId);
  if (options.type && options.type !== "all") params.set("type", options.type);
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  if (options.keyword) params.set("keyword", options.keyword);
  if (options.favoriteOnly) params.set("favorite", "1");
  if (options.page && options.page > 1) params.set("page", String(options.page));
  if (options.status) params.set("status", options.status);
  return `${options.basePath ?? "/records"}${params.size ? `?${params.toString()}` : ""}`;
}

export function normalizeRecordTypeFilter(value?: string): RecordTypeFilter {
  return value === "health" || value === "medical" || value === "memory" ? value : "all";
}

export function filterToRecordType(value: RecordTypeFilter): HamsterRecordType | undefined {
  if (value === "health") return "HEALTH";
  if (value === "medical") return "MEDICAL";
  if (value === "memory") return "MEMORY";
  return undefined;
}

export function normalizeRecordPage(value?: string) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function normalizeRecordDateFilter(value?: string) {
  return value && isValidDateInput(value) ? value : "";
}

export function normalizeRecordKeyword(value?: string) {
  return value?.trim().slice(0, 100) ?? "";
}

export type RecordSearchTerm = {
  value: string;
  isTag: boolean;
};

export function parseRecordSearchTerms(keyword: string): RecordSearchTerm[] {
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

export function getRecordSearchVariants(value: string) {
  const original = value.trim().toLocaleLowerCase("ja-JP");
  const nfkc = original.normalize("NFKC");
  const hiragana = normalizeSearchText(original);
  return Array.from(new Set([original, nfkc, hiragana, toKatakana(hiragana)].filter(Boolean)));
}

/**
 * 記録検索語をPrismaの条件へ変換する。
 *
 * 通常語と`#`付きタグはAND、各語の全半角・かな表記の候補はORで検索する。
 * 条件を生成できない空入力では`undefined`を返す。
 */
export function buildRecordKeywordWhere(keyword: string): Prisma.HamsterRecordWhereInput | undefined {
  const terms = parseRecordSearchTerms(keyword);
  const keywordConditions = terms
    .filter((term) => !term.isTag)
    .flatMap<Prisma.HamsterRecordWhereInput>((term) =>
      getRecordSearchVariants(term.value).map((variant) => ({
        searchText: { contains: variant, mode: "insensitive" }
      }))
    );
  const tagConditions = terms
    .filter((term) => term.isTag)
    .flatMap<Prisma.HamsterRecordWhereInput>((term) =>
      getRecordSearchVariants(term.value).map((variant) => ({
        recordType: "MEMORY",
        memoryDetail: { is: { searchTags: { has: variant } } }
      }))
    );
  const groups = [keywordConditions, tagConditions]
    .filter((conditions) => conditions.length > 0)
    .map<Prisma.HamsterRecordWhereInput>((conditions) => ({ OR: conditions }));

  if (groups.length === 0) return undefined;
  return groups.length === 1 ? groups[0] : { AND: groups };
}

/**
 * 記録一覧をHouseholdと選択個体の範囲へ制限するPrisma条件を返す。
 *
 * 健康・通院は代表`hamsterId`、共同の思い出は中間テーブルの参加個体で判定する。
 * Household条件は常に含まれるため、呼び出し側で省略しないこと。
 */
export function buildRecordScopeWhere(
  scope: RecordScope,
  householdId: string,
  selectedHamsterId: string
): Prisma.HamsterRecordWhereInput {
  return {
    hamster: { householdId },
    ...(scope === "hamster"
      ? {
          OR: [
            { recordType: { in: ["HEALTH", "MEDICAL"] }, hamsterId: selectedHamsterId },
            {
              recordType: "MEMORY",
              memoryDetail: {
                is: {
                  hamsters: {
                    some: { hamsterId: selectedHamsterId, hamster: { householdId } }
                  }
                }
              }
            }
          ]
        }
      : {})
  };
}

export type MemoryRecordDeletionCandidate = {
  id: string;
  representativeHamsterId: string;
  hamsterIds: string[];
  imageFileNames: string[];
};

export type MemoryRecordDeletionPlan = {
  recordId: string;
  deleteRecord: boolean;
  nextRepresentativeHamsterId: string | null;
  imageFileNamesToDelete: string[];
};

/**
 * ハムスター削除時に、関連する共同の思い出を保持・移譲・削除する計画を作る。
 *
 * 対象個体が残る思い出は保持し、代表だけが消える場合は残存順の先頭へ移す。
 * 画像削除対象は思い出自体を削除する場合にだけ返す。
 */
export function planMemoryRecordsForHamsterDeletion(
  records: readonly MemoryRecordDeletionCandidate[],
  deletingHamsterIds: readonly string[]
): MemoryRecordDeletionPlan[] {
  const deletingIds = new Set(deletingHamsterIds);
  return records.map((record) => {
    const remainingHamsterIds = record.hamsterIds.filter((hamsterId) => !deletingIds.has(hamsterId));
    if (remainingHamsterIds.length === 0) {
      return {
        recordId: record.id,
        deleteRecord: true,
        nextRepresentativeHamsterId: null,
        imageFileNamesToDelete: [...new Set(record.imageFileNames)]
      };
    }

    const representativeRemains = remainingHamsterIds.includes(record.representativeHamsterId);
    return {
      recordId: record.id,
      deleteRecord: false,
      nextRepresentativeHamsterId: representativeRemains
        ? record.representativeHamsterId
        : remainingHamsterIds[0],
      imageFileNamesToDelete: []
    };
  });
}

export function buildRecordListWhere({
  scope,
  householdId,
  selectedHamsterId,
  recordType,
  from,
  to,
  keyword,
  favoriteOnly
}: {
  scope: RecordScope;
  householdId: string;
  selectedHamsterId: string;
  recordType: RecordTypeFilter;
  from: string;
  to: string;
  keyword: string;
  favoriteOnly: boolean;
}): Prisma.HamsterRecordWhereInput {
  const databaseRecordType = filterToRecordType(recordType);
  const keywordWhere = buildRecordKeywordWhere(keyword);
  return {
    ...buildRecordScopeWhere(scope, householdId, selectedHamsterId),
    ...(databaseRecordType ? { recordType: databaseRecordType } : {}),
    ...(from || to
      ? {
          recordDate: {
            ...(from ? { gte: parseDateInput(from) } : {}),
            ...(to ? { lte: parseDateInput(to) } : {})
          }
        }
      : {}),
    ...(keywordWhere ?? {}),
    ...(favoriteOnly ? { recordType: "MEMORY", memoryDetail: { is: { isFavorite: true } } } : {})
  };
}

export function collectRecordTagSuggestions(rows: ReadonlyArray<{ tags: string[] }>) {
  const tagsByNormalizedValue = new Map<string, string>();
  // 全角半角などの表記ゆれは正規化して重複排除し、画面には最初に保存された表記を残す。
  for (const { tags } of rows) {
    for (const tag of tags) {
      const normalized = normalizeTagStorageValue(tag);
      if (normalized && !tagsByNormalizedValue.has(normalized)) tagsByNormalizedValue.set(normalized, tag);
    }
  }
  return Array.from(tagsByNormalizedValue.values()).sort((left, right) => left.localeCompare(right, "ja"));
}

export function buildSavedMemoryTagRows(householdId: string, createdByUserId: string, tags: readonly string[]) {
  return tags.map((value) => {
    const name = normalizeTagStorageValue(value);
    return { householdId, createdByUserId, name, normalizedName: name };
  });
}

export function buildMemoryTagSearchValues(tags: readonly string[]) {
  return Array.from(
    new Set(tags.map((tag) => normalizeTagStorageValue(tag).toLocaleLowerCase("ja-JP")).filter(Boolean))
  );
}

export function buildHealthRecordTitle(overallCondition: HealthOverallCondition) {
  return `体調: ${HEALTH_OVERALL_LABELS[overallCondition]}`;
}

export function buildMedicalRecordTitle(hospitalName: string | null) {
  return hospitalName ? `通院: ${hospitalName}` : "通院記録";
}

function joinSearchText(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).join("\n").toLocaleLowerCase("ja-JP");
}

export function buildHealthSearchText(input: HealthRecordInput) {
  return joinSearchText([
    buildHealthRecordTitle(input.overallCondition),
    input.memo,
    ...input.symptoms.map((symptom) => HEALTH_SYMPTOM_LABELS[symptom])
  ]);
}

export function buildMedicalSearchText(input: MedicalRecordInput) {
  return joinSearchText([
    buildMedicalRecordTitle(input.hospitalName),
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

export function buildMemorySearchText(input: MemoryRecordInput) {
  return joinSearchText([input.title, input.content]);
}
