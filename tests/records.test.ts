import assert from "node:assert/strict";
import { File } from "node:buffer";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  canServeRecordImage,
  commitWithNewRecordImage,
  deleteRecordImage,
  MAX_RECORD_IMAGE_SIZE_BYTES,
  prepareRecordImage,
  readRecordImage,
  RECORD_IMAGE_MAX_DIMENSION,
  RecordImageError
} from "../src/lib/record-image";
import { MAX_STORED_IMAGE_SIZE_BYTES } from "../src/lib/image-constraints";
import {
  createHealthRecordSchema,
  createMedicalRecordSchema,
  createMemoryRecordSchema,
  deleteSavedMemoryTagsSchema,
  MAX_MEMORY_RECORD_HAMSTERS,
  updateMemoryRecordSchema
} from "../src/lib/record-schemas";
import {
  buildHealthSearchText,
  buildMedicalSearchText,
  buildMemorySearchText,
  buildMemoryTagSearchValues,
  buildRecordListWhere,
  buildRecordKeywordWhere,
  buildRecordScopeWhere,
  buildSavedMemoryTagRows,
  collectRecordTagSuggestions,
  filterToRecordType,
  getRecordSearchVariants,
  normalizeRecordScope,
  parseRecordSearchTerms,
  planMemoryRecordsForHamsterDeletion,
  normalizeRecordTypeFilter,
  recordCreateKindForHamsterStatus,
  RECORD_PAGE_SIZE,
  recordsUrl,
  resolveRecordScope
} from "../src/lib/records";
import { normalizeTagStorageValue } from "../src/lib/tags";
import { formatRecordTime, isFutureRecordTime, parseRecordTimeInput } from "../src/lib/record-time";

const projectRoot = process.cwd();

function source(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

const validHealth = {
  hamsterId: "hamster-1",
  recordDate: "2026-07-15",
  overallCondition: "GOOD",
  appetite: "NORMAL",
  activityLevel: "NORMAL",
  stoolCondition: "NORMAL",
  urineCondition: "NORMAL",
  symptoms: ["SNEEZING"],
  memo: "少しくしゃみ"
};

const validMedical = {
  hamsterId: "hamster-1",
  recordDate: "2026-07-15",
  hospitalName: "しろ動物病院",
  reason: "食欲が少ない",
  diagnosis: "経過観察",
  examination: "触診",
  treatment: "補液",
  medication: "整腸剤",
  medicationInstructions: "朝1回",
  nextVisitDate: "2026-07-20",
  consultationFee: "3500",
  memo: ""
};

test("健康記録は必須項目・enum・文字数を検証する", () => {
  const withoutTime = createHealthRecordSchema.safeParse(validHealth);
  const withTime = createHealthRecordSchema.safeParse({ ...validHealth, recordTime: "23:59" });
  assert.equal(withoutTime.success, true);
  assert.equal(withoutTime.success && withoutTime.data.recordTime, null);
  assert.equal(withTime.success && withTime.data.recordTime, 1439);
  assert.equal(parseRecordTimeInput("07:05"), 425);
  assert.equal(formatRecordTime(425), "07:05");
  assert.equal(formatRecordTime(null), null);
  assert.equal(createHealthRecordSchema.safeParse({ ...validHealth, hamsterId: "" }).success, false);
  assert.equal(createHealthRecordSchema.safeParse({ ...validHealth, recordDate: "2026-02-30" }).success, false);
  assert.equal(createHealthRecordSchema.safeParse({ ...validHealth, appetite: "INVALID" }).success, false);
  assert.equal(createHealthRecordSchema.safeParse({ ...validHealth, memo: "x".repeat(2001) }).success, false);
  assert.equal(createHealthRecordSchema.safeParse({ ...validHealth, symptoms: ["INVALID"] }).success, false);
  for (const recordTime of ["24:00", "12:60", "7:05", "noon"]) {
    assert.equal(createHealthRecordSchema.safeParse({ ...validHealth, recordTime }).success, false);
  }
});

test("健康記録の時刻はJSTの登録時刻より未来の場合だけ拒否する", () => {
  const now = new Date("2026-07-17T03:34:45.000Z"); // JST 2026-07-17 12:34
  assert.equal(isFutureRecordTime("2026-07-17", 12 * 60 + 35, now), true);
  assert.equal(isFutureRecordTime("2026-07-17", 12 * 60 + 34, now), false);
  assert.equal(isFutureRecordTime("2026-07-16", 23 * 60 + 59, now), false);
  assert.equal(isFutureRecordTime("2026-07-18", 0, now), true);
  assert.equal(isFutureRecordTime("2026-07-17", null, now), false);
});

test("通院記録は理由だけを内容必須とし、診察費は0以上の整数に限定する", () => {
  const parsed = createMedicalRecordSchema.safeParse(validMedical);
  assert.equal(parsed.success, true);
  assert.equal(createMedicalRecordSchema.safeParse({ ...validMedical, reason: "" }).success, false);
  assert.equal(createMedicalRecordSchema.safeParse({ ...validMedical, hospitalName: "", diagnosis: "", medication: "" }).success, true);
  for (const consultationFee of ["-1", "1.5", "abc", "100000000"]) {
    assert.equal(createMedicalRecordSchema.safeParse({ ...validMedical, consultationFee }).success, false);
  }
  assert.equal(parsed.success && parsed.data.nextVisitDate?.toISOString(), "2026-07-20T00:00:00.000Z");
});

test("思い出記録はタイトル・内容を必須にし、自由タグを正規化する", () => {
  const parsed = createMemoryRecordSchema.safeParse({
    hamsterId: "hamster-1",
    hamsterIds: ["hamster-1", "hamster-2", "hamster-2"],
    recordDate: "2026-07-15",
    title: "初めて手の上で寝た",
    content: "静かに眠ってくれた。",
    tags: "初めて、日常, 初めて",
    isFavorite: "true",
    saveTags: "true"
  });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success && parsed.data.hamsterIds, ["hamster-1", "hamster-2"]);
  assert.deepEqual(parsed.success && parsed.data.tags, ["初めて", "日常"]);
  assert.equal(parsed.success && parsed.data.isFavorite, true);
  assert.equal(parsed.success && parsed.data.saveTags, true);
  const withoutSaving = createMemoryRecordSchema.parse({
    hamsterId: "hamster-1",
    hamsterIds: ["hamster-1"],
    recordDate: "2026-07-15",
    title: "日常",
    content: "ひまわりの種を食べた",
    tags: "ＡＢＣ，ABC、abc,１２３",
    isFavorite: "false"
  });
  assert.deepEqual(withoutSaving.tags, ["ABC", "abc", "123"]);
  assert.equal(withoutSaving.saveTags, false);
  assert.equal(createMemoryRecordSchema.safeParse({ hamsterId: "h", hamsterIds: ["h"], recordDate: "2026-07-15", title: "", content: "本文", tags: "", isFavorite: "false" }).success, false);
});

test("思い出対象は1匹以上・空IDなし・100匹以内とし、重複を安全に除去する", () => {
  const base = {
    hamsterId: "hamster-1",
    recordDate: "2026-07-15",
    title: "一緒に遊んだ",
    content: "部屋んぽを楽しみました。",
    tags: "遊び",
    isFavorite: "false",
    saveTags: "false"
  };
  assert.equal(createMemoryRecordSchema.safeParse({ ...base, hamsterIds: [] }).success, false);
  assert.equal(createMemoryRecordSchema.safeParse({ ...base, hamsterIds: [""] }).success, false);
  assert.equal(
    createMemoryRecordSchema.safeParse({
      ...base,
      hamsterIds: Array.from({ length: MAX_MEMORY_RECORD_HAMSTERS + 1 }, (_, index) => `hamster-${index}`)
    }).success,
    false
  );
  const duplicate = createMemoryRecordSchema.parse({ ...base, hamsterIds: ["hamster-1", "hamster-2", "hamster-2"] });
  assert.deepEqual(duplicate.hamsterIds, ["hamster-1", "hamster-2"]);
});

test("新規思い出は代表ハムスターを対象に必須とし、編集では代表解除を許可する", () => {
  const base = {
    hamsterId: "hamster-1",
    hamsterIds: ["hamster-2"],
    recordDate: "2026-07-15",
    title: "一緒のお祝い",
    content: "みんなでお祝いしました。",
    tags: "記念日",
    isFavorite: "false"
  };
  assert.equal(createMemoryRecordSchema.safeParse({ ...base, saveTags: "false" }).success, false);
  assert.equal(updateMemoryRecordSchema.safeParse({ ...base, id: "record-1" }).success, true);
});

test("保存対象の思い出タグをHousehold単位の個別行へ正規化する", () => {
  assert.deepEqual(buildSavedMemoryTagRows("household-1", "user-1", ["ＡＢＣ", "abc", "１２３"]), [
    { householdId: "household-1", createdByUserId: "user-1", name: "ABC", normalizedName: "ABC" },
    { householdId: "household-1", createdByUserId: "user-1", name: "abc", normalizedName: "abc" },
    { householdId: "household-1", createdByUserId: "user-1", name: "123", normalizedName: "123" }
  ]);
  assert.equal(normalizeTagStorageValue("　ＡｂＣ１２３　"), "AbC123");
});

test("保存済みタグの一括削除は選択必須・幅正規化・大小文字区別を検証する", () => {
  const parsed = deleteSavedMemoryTagsSchema.parse({ tags: ["ＡＢＣ", "ABC", "abc", " 食事 "] });
  assert.deepEqual(parsed.tags, ["ABC", "abc", "食事"]);
  assert.equal(deleteSavedMemoryTagsSchema.safeParse({ tags: [] }).success, false);
  assert.equal(deleteSavedMemoryTagsSchema.safeParse({ tags: ["x".repeat(31)] }).success, false);
  assert.equal(deleteSavedMemoryTagsSchema.safeParse({ tags: [123] }).success, false);
});

test("検索用テキストへ症状・診断・薬・内容を含め、思い出タグは含めない", () => {
  const health = createHealthRecordSchema.parse(validHealth);
  const medical = createMedicalRecordSchema.parse(validMedical);
  const memory = createMemoryRecordSchema.parse({ hamsterId: "h", hamsterIds: ["h"], recordDate: "2026-07-15", title: "誕生日", content: "ひまわりの種", tags: "記念日、食事", isFavorite: "false" });
  assert.match(buildHealthSearchText(health), /くしゃみ/);
  assert.match(buildMedicalSearchText(medical), /経過観察/);
  assert.match(buildMedicalSearchText(medical), /整腸剤/);
  assert.match(buildMemorySearchText(memory), /ひまわりの種/);
  assert.doesNotMatch(buildMemorySearchText(memory), /記念日/);
});

test("キーワード同士・タグ同士はOR、キーワードとタグはANDでかな表記差を吸収する", () => {
  assert.deepEqual(parseRecordSearchTerms("はちみつ, 手に乗った, #初めて"), [
    { value: "はちみつ", isTag: false },
    { value: "手に乗った", isTag: false },
    { value: "初めて", isTag: true }
  ]);
  assert.deepEqual(getRecordSearchVariants("ハチミツ"), ["ハチミツ", "はちみつ"]);
  const where = buildRecordKeywordWhere("ハチミツ,#ハジメテ");
  assert.deepEqual(where, {
    AND: [
      {
        OR: [
          { searchText: { contains: "ハチミツ", mode: "insensitive" } },
          { searchText: { contains: "はちみつ", mode: "insensitive" } }
        ]
      },
      {
        OR: [
          { recordType: "MEMORY", memoryDetail: { is: { searchTags: { has: "ハジメテ" } } } },
          { recordType: "MEMORY", memoryDetail: { is: { searchTags: { has: "はじめて" } } } }
        ]
      }
    ]
  });
  assert.ok(buildRecordKeywordWhere("ハチミツ,手に乗った")?.OR);
  assert.ok(buildRecordKeywordWhere("#初めて,#日常")?.OR);
  assert.deepEqual(new Set(collectRecordTagSuggestions([{ tags: ["ABC", "abc"] }, { tags: ["ＡＢＣ", "食事"] }])), new Set(["ABC", "abc", "食事"]));
  assert.deepEqual(getRecordSearchVariants("ＡｂＣ"), ["ａｂｃ", "abc"]);
  assert.deepEqual(buildMemoryTagSearchValues(["ABC", "abc", "ＡＢＣ", "ハム"]), ["abc", "ハム"]);
  assert.deepEqual(buildRecordKeywordWhere("#abc"), buildRecordKeywordWhere("#ABC"));
  assert.deepEqual(buildRecordKeywordWhere("#ＡｂＣ"), {
    OR: [
      { recordType: "MEMORY", memoryDetail: { is: { searchTags: { has: "abc" } } } }
    ]
  });
});

test("種類フィルターと20件ページングを固定する", () => {
  assert.equal(normalizeRecordTypeFilter("health"), "health");
  assert.equal(normalizeRecordTypeFilter("unknown"), "all");
  assert.equal(filterToRecordType("medical"), "MEDICAL");
  assert.equal(filterToRecordType("all"), undefined);
  assert.equal(RECORD_PAGE_SIZE, 20);
});

test("記録の表示範囲は許可値だけを採用し、未指定・不正値を個別表示へ正規化する", () => {
  assert.equal(normalizeRecordScope("hamster"), "hamster");
  assert.equal(normalizeRecordScope("household"), "household");
  assert.equal(normalizeRecordScope(undefined), "hamster");
  assert.equal(normalizeRecordScope("invalid"), "hamster");
});

test("URL指定が保存設定より優先され、URL未指定時だけ保存設定を使用する", () => {
  assert.equal(
    resolveRecordScope({ hasScopeParam: false, defaultScope: "household" }),
    "household"
  );
  assert.equal(
    resolveRecordScope({ hasScopeParam: true, scopeParam: "hamster", defaultScope: "household" }),
    "hamster"
  );
  assert.equal(
    resolveRecordScope({ hasScopeParam: true, scopeParam: "household", defaultScope: "hamster" }),
    "household"
  );
  assert.equal(
    resolveRecordScope({ hasScopeParam: true, scopeParam: "invalid", defaultScope: "household" }),
    "hamster"
  );
  assert.equal(resolveRecordScope({ hasScopeParam: false, defaultScope: undefined }), "hamster");
});

test("個別表示とグループ表示は必ずHousehold境界を含む", () => {
  assert.deepEqual(buildRecordScopeWhere("hamster", "household-1", "hamster-1"), {
    hamster: { householdId: "household-1" },
    OR: [
      { recordType: { in: ["HEALTH", "MEDICAL"] }, hamsterId: "hamster-1" },
      {
        recordType: "MEMORY",
        memoryDetail: {
          is: {
            hamsters: {
              some: { hamsterId: "hamster-1", hamster: { householdId: "household-1" } }
            }
          }
        }
      }
    ]
  });
  assert.deepEqual(buildRecordScopeWhere("household", "household-1", "hamster-1"), {
    hamster: { householdId: "household-1" }
  });
});

test("グループ表示でも種類・日付・キーワード・お気に入り条件をHousehold条件へ重ねる", () => {
  const where = buildRecordListWhere({
    scope: "household",
    householdId: "household-1",
    selectedHamsterId: "hamster-1",
    recordType: "medical",
    from: "2026-07-01",
    to: "2026-07-31",
    keyword: "投薬",
    favoriteOnly: false
  });
  assert.deepEqual(where, {
    hamster: { householdId: "household-1" },
    recordType: "MEDICAL",
    recordDate: {
      gte: new Date("2026-07-01T00:00:00.000Z"),
      lte: new Date("2026-07-31T00:00:00.000Z")
    },
    OR: [
      { searchText: { contains: "投薬", mode: "insensitive" } }
    ]
  });
  assert.deepEqual(
    buildRecordListWhere({
      scope: "household",
      householdId: "household-1",
      selectedHamsterId: "hamster-1",
      recordType: "health",
      from: "",
      to: "",
      keyword: "",
      favoriteOnly: true
    }),
    {
      hamster: { householdId: "household-1" },
      recordType: "MEMORY",
      memoryDetail: { is: { isFavorite: true } }
    }
  );
});

test("記録URLは個別表示の後方互換性とグループ表示の状態を維持する", () => {
  assert.equal(recordsUrl({ hamsterId: "hamster-1" }), "/records?hamsterId=hamster-1");
  assert.equal(
    recordsUrl({ scope: "hamster", includeScope: true, hamsterId: "hamster-1" }),
    "/records?scope=hamster&hamsterId=hamster-1"
  );
  assert.equal(
    recordsUrl({
      scope: "household",
      hamsterId: "hamster-1",
      type: "memory",
      from: "2026-07-01",
      to: "2026-07-31",
      keyword: "#日常",
      favoriteOnly: true,
      page: 2
    }),
    "/records?scope=household&hamsterId=hamster-1&type=memory&from=2026-07-01&to=2026-07-31&keyword=%23%E6%97%A5%E5%B8%B8&favorite=1&page=2"
  );
});

test("共通タイムラインは日付、時刻ありの降順、時刻なし、作成日時、IDの順でDB取得する", () => {
  const query = source("src/lib/record-queries.ts");
  const records = source("src/lib/records.ts");
  assert.match(query, /buildRecordListWhere\(\{/);
  assert.match(query, /householdId: context\.household\.id/);
  assert.match(query, /recordDate: "desc"[\s\S]*recordTimeMinutes: \{ sort: "desc", nulls: "last" \}[\s\S]*createdAt: "desc"[\s\S]*id: "desc"/);
  assert.match(query, /recordTime: formatRecordTime\(record\.recordTimeMinutes\)/);
  assert.match(records, /buildRecordKeywordWhere\(keyword\)/);
  assert.match(query, /memoryRecordDetail\.findMany/);
  assert.match(query, /savedMemoryTag\.findMany/);
  assert.match(query, /savedMemoryTag[\s\S]*where: \{ householdId: context\.household\.id \}/);
  assert.match(query, /hamsterRecord: buildRecordScopeWhere\(scope, context\.household\.id, selectedHamster\.id\)/);
  assert.match(query, /hamster: \{ select: \{ id: true, name: true, isActive: true \} \}/);
  assert.match(query, /hamster: record\.hamster/);
  assert.match(records, /memoryDetail: \{ is: \{ isFavorite: true \} \}/);
  assert.match(query, /skip: \(currentPage - 1\) \* RECORD_PAGE_SIZE/);
  assert.match(query, /take: RECORD_PAGE_SIZE/);
  assert.match(query, /hamsters: \{[\s\S]*orderBy: \[\{ sortOrder: "asc" \}, \{ hamsterId: "asc" \}\]/);
  assert.match(query, /hamsters: record\.memoryDetail\.hamsters\.map\(\(entry\) => entry\.hamster\)/);
});

test("個別タイムラインとタグ候補は思い出だけ中間関連を使い、グループ表示は親記録を重複させない", () => {
  const records = source("src/lib/records.ts");
  const query = source("src/lib/record-queries.ts");
  assert.match(records, /recordType: \{ in: \["HEALTH", "MEDICAL"\] \}, hamsterId: selectedHamsterId/);
  assert.match(records, /recordType: "MEMORY"[\s\S]*hamsters: \{[\s\S]*some: \{ hamsterId: selectedHamsterId/);
  assert.match(query, /hamsterRecord\.count\(\{ where \}\)/);
  assert.match(query, /hamsterRecord\.findMany\(\{[\s\S]*where,/);
  assert.match(query, /hamsterRecord: buildRecordScopeWhere\(scope, context\.household\.id, selectedHamster\.id\)/);
  assert.doesNotMatch(query, /memoryRecordHamster\.findMany/);
});

test("更新Actionは未来日・Household所属・管理外制御とrevision同一トランザクションを維持する", () => {
  const actions = source("src/app/actions/records.ts");
  assert.match(actions, /isFutureDateInput\(result\.data\.recordDate\)/);
  assert.match(actions, /isFutureRecordTime\(result\.data\.recordDate, result\.data\.recordTime\)/);
  assert.match(actions, /recordCreateError\("futureTime"\)/);
  assert.match(actions, /recordRedirect\(result\.data\.hamsterId, "futureTime", formData\)/);
  assert.match(actions, /where: \{ id: hamsterId, householdId \}/);
  assert.match(actions, /where: \{ id, hamsterId, hamster: \{ householdId \} \}/);
  assert.match(actions, /if \(!allowInactive && !hamster\.isActive\)/);
  assert.match(actions, /record\.recordType !== "MEMORY" && !record\.hamster\.isActive/);
  assert.match(actions, /commitHouseholdMutation\(/);
  assert.match(actions, /source: "record"/);
  assert.match(actions, /publishHouseholdChangeSafely\(change\)/);
  assert.match(actions, /savedMemoryTag\.createMany/);
  assert.match(actions, /skipDuplicates: true/);
  assert.match(actions, /searchTags: buildMemoryTagSearchValues\(result\.data\.tags\)/);
  assert.match(actions, /recordTimeMinutes: result\.data\.recordTime/);
  assert.match(actions, /record\.recordTimeMinutes === result\.data\.recordTime/);
});

test("健康記録の任意時刻は分単位・範囲制約付きで追加するマイグレーションを持つ", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20260717120000_add_health_record_time/migration.sql");
  assert.match(schema, /recordTimeMinutes\s+Int\?[\s\S]*?@map\("record_time_minutes"\) @db\.SmallInt/);
  assert.match(schema, /@@index\(\[hamsterId, recordDate, recordTimeMinutes, createdAt\]\)/);
  assert.match(migration, /ADD COLUMN "record_time_minutes" SMALLINT/);
  assert.match(migration, /BETWEEN 0 AND 1439/);
  assert.match(migration, /hamster_records_hamster_id_record_date_record_time_minutes_created_at_idx/);
});

test("保存済みタグ削除ActionはHousehold内候補だけをrevisionと同一トランザクションで一括削除する", () => {
  const actions = source("src/app/actions/records.ts");
  const start = actions.indexOf("export async function deleteSavedMemoryTags");
  const end = actions.indexOf("async function getEditableRecord", start);
  const deleteAction = actions.slice(start, end);
  assert.match(deleteAction, /getRequiredHouseholdMutationContext\("\/records"\)/);
  assert.match(deleteAction, /deleteSavedMemoryTagsSchema\.safeParse\(\{ tags: formData\.getAll\("tags"\) \}\)/);
  assert.match(deleteAction, /commitHouseholdMutation\(/);
  assert.match(deleteAction, /tx\.savedMemoryTag\.deleteMany/);
  assert.match(deleteAction, /householdId: context\.household\.id/);
  assert.match(deleteAction, /name: \{ in: result\.data\.tags \}/);
  assert.match(deleteAction, /publishAndRevalidate\(change, context\.household\.id, "records\.memoryTag\.deleteMany"\)/);
  assert.doesNotMatch(deleteAction, /memoryRecordDetail|hamsterRecord/);
});

test("保存済み思い出タグはHousehold分離と正規化名の一意制約を持つ", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20260716160000_add_saved_memory_tags/migration.sql");
  assert.match(schema, /model SavedMemoryTag/);
  assert.match(schema, /@@unique\(\[householdId, normalizedName\]\)/);
  assert.match(schema, /household\s+Household[\s\S]*onDelete: Cascade/);
  assert.match(migration, /saved_memory_tags_household_id_normalized_name_key/);
  assert.match(migration, /REFERENCES "households"\("id"\) ON DELETE CASCADE/);
});

test("既存の思い出タグを幅正規化し、大文字小文字を保持するマイグレーションを持つ", () => {
  const migration = source("prisma/migrations/20260716190000_normalize_memory_tag_width_preserve_case/migration.sql");
  assert.match(migration, /normalize\(btrim\(input\."tag"\), NFKC\)/);
  assert.match(migration, /UPDATE "saved_memory_tags"/);
  assert.match(migration, /"normalized_name" = normalize\(btrim\("name"\), NFKC\)/);
  assert.doesNotMatch(migration, /lower\(/i);
});

test("タグ検索用配列を既存データから小文字・NFKC正規化して追加する", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20260716210000_add_memory_record_search_tags/migration.sql");
  assert.match(schema, /searchTags\s+String\[\][^\n]*@map\("search_tags"\)/);
  assert.match(schema, /@@index\(\[searchTags\], type: Gin\)/);
  assert.match(migration, /ADD COLUMN "search_tags" TEXT\[\]/);
  assert.match(migration, /lower\(normalize\(btrim\(input\."tag"\), NFKC\)\)/);
  assert.match(migration, /USING GIN \("search_tags"\)/);
});

test("Prismaは親・種類別詳細・画像を分離し、Cascadeと検索索引を持つ", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20260715120000_add_hamster_records/migration.sql");
  for (const model of ["HamsterRecord", "HealthRecordDetail", "MedicalVisitDetail", "MemoryRecordDetail", "MemoryRecordImage"]) {
    assert.match(schema, new RegExp(`model ${model}`));
  }
  assert.match(schema, /memoryRecord\s+MemoryRecordDetail[\s\S]*onDelete: Cascade/);
  assert.match(migration, /gin_trgm_ops/);
});

test("思い出とハムスターの中間モデルは複合主キー・Cascade・検索用indexを持つ", () => {
  const schema = source("prisma/schema.prisma");
  assert.match(schema, /model MemoryRecordHamster/);
  assert.match(schema, /hamsterRecordId\s+String[\s\S]*hamsterId\s+String[\s\S]*sortOrder\s+Int\s+@default\(0\)/);
  assert.match(schema, /memoryRecord\s+MemoryRecordDetail[\s\S]*onDelete: Cascade/);
  assert.match(schema, /hamster\s+Hamster[\s\S]*onDelete: Cascade/);
  assert.match(schema, /@@id\(\[hamsterRecordId, hamsterId\]\)/);
  assert.match(schema, /@@index\(\[hamsterId\]\)/);
  assert.match(schema, /@@map\("memory_record_hamsters"\)/);
  assert.match(schema, /model HamsterRecord[\s\S]*hamsterId\s+String\s+@map\("hamster_id"\)/);
});

test("思い出対象migrationは既存代表を重複なくバックフィルし、空対象を拒否する", () => {
  const migration = source("prisma/migrations/20260802120000_add_memory_record_hamsters/migration.sql");
  assert.match(migration, /CREATE TABLE "memory_record_hamsters"/);
  assert.match(migration, /PRIMARY KEY \("hamster_record_id", "hamster_id"\)/);
  assert.match(migration, /SELECT memory\."hamster_record_id", record\."hamster_id", 0/);
  assert.match(migration, /WHERE record\."record_type" = 'MEMORY'/);
  assert.match(migration, /ON CONFLICT \("hamster_record_id", "hamster_id"\) DO NOTHING/);
  assert.match(migration, /NOT EXISTS \([\s\S]*FROM "memory_record_hamsters"/);
  assert.match(migration, /RAISE EXCEPTION 'Failed to backfill memory record hamsters'/);
  assert.match(migration, /memory_record_hamsters_hamster_id_idx/);
  assert.equal((migration.match(/ON DELETE CASCADE ON UPDATE CASCADE/g) ?? []).length, 2);
});

test("思い出ActionはgetAllで対象を受け、Household所属をtransaction内で検証する", () => {
  const actions = source("src/app/actions/records.ts");
  assert.match(actions, /hamsterIds: formData\.getAll\("hamsterIds"\)/);
  assert.match(actions, /tx\.hamster\.count\(\{ where: \{ id: \{ in: hamsterIds \}, householdId \} \}\)/);
  assert.match(actions, /if \(count !== hamsterIds\.length\) throw new InvalidMemoryHamstersError\(\)/);
  assert.match(actions, /await assertMemoryHamstersBelongToHousehold\(tx, result\.data\.hamsterIds, context\.household\.id\)/);
  assert.match(actions, /await getMutationHamster\(result\.data\.hamsterId, context\.household\.id, true\)/);
});

test("思い出登録・更新は本体・対象・タグ・画像を同じrealtime transactionで整合させる", () => {
  const actions = source("src/app/actions/records.ts");
  assert.match(actions, /hamsters: \{[\s\S]*create: result\.data\.hamsterIds\.map/);
  assert.match(actions, /memoryRecordHamster\.deleteMany\(\{ where: \{ hamsterRecordId: record\.id \} \}\)/);
  assert.match(actions, /memoryRecordHamster\.createMany\(\{/);
  assert.match(actions, /hamsterId: representativeHamsterId/);
  assert.match(actions, /result\.data\.hamsterIds\.includes\(record\.hamsterId\)[\s\S]*record\.hamsterId[\s\S]*result\.data\.hamsterIds\[0\]/);
  assert.match(actions, /memoryRecordImage\.deleteMany/);
  assert.match(actions, /savedMemoryTag\.createMany/);
  assert.match(actions, /source: "record"/);
});

test("共有思い出の削除計画は非代表削除を保持し、代表削除を先頭へ付け替える", () => {
  const records = [{
    id: "memory-1",
    representativeHamsterId: "hamster-1",
    hamsterIds: ["hamster-1", "hamster-2", "hamster-3"],
    imageFileNames: ["photo.webp"]
  }];
  assert.deepEqual(planMemoryRecordsForHamsterDeletion(records, ["hamster-2"]), [{
    recordId: "memory-1",
    deleteRecord: false,
    nextRepresentativeHamsterId: "hamster-1",
    imageFileNamesToDelete: []
  }]);
  assert.deepEqual(planMemoryRecordsForHamsterDeletion(records, ["hamster-1"]), [{
    recordId: "memory-1",
    deleteRecord: false,
    nextRepresentativeHamsterId: "hamster-2",
    imageFileNamesToDelete: []
  }]);
});

test("単独対象・一括全対象削除だけが思い出と重複排除済み画像を削除する", () => {
  const single = planMemoryRecordsForHamsterDeletion([{
    id: "memory-single",
    representativeHamsterId: "hamster-1",
    hamsterIds: ["hamster-1"],
    imageFileNames: ["photo.webp", "photo.webp"]
  }], ["hamster-1"]);
  assert.deepEqual(single, [{
    recordId: "memory-single",
    deleteRecord: true,
    nextRepresentativeHamsterId: null,
    imageFileNamesToDelete: ["photo.webp"]
  }]);

  const bulk = planMemoryRecordsForHamsterDeletion([{
    id: "memory-shared",
    representativeHamsterId: "hamster-1",
    hamsterIds: ["hamster-1", "hamster-2", "hamster-3"],
    imageFileNames: ["shared.webp"]
  }], ["hamster-1", "hamster-2"]);
  assert.equal(bulk[0]?.deleteRecord, false);
  assert.equal(bulk[0]?.nextRepresentativeHamsterId, "hamster-3");
  assert.deepEqual(bulk[0]?.imageFileNamesToDelete, []);
});

test("単体・一括ハムスター削除は共有思い出を先に整理し、削除記録の画像だけ後処理する", () => {
  const actions = source("src/app/actions/hamsters.ts");
  assert.match(actions, /prepareMemoryRecordsForHamsterDeletion\([\s\S]*tx\.hamster\.deleteMany/);
  assert.match(actions, /tx\.hamsterRecord\.update\([\s\S]*data: \{ hamsterId: plan\.nextRepresentativeHamsterId \}/);
  assert.match(actions, /tx\.hamsterRecord\.deleteMany\([\s\S]*recordType: "MEMORY"/);
  assert.equal((actions.match(/result: deletedMemoryRecords/g) ?? []).length, 2);
  assert.equal((actions.match(/deletedMemoryRecords,/g) ?? []).length, 2);
  assert.match(actions, /const deletedFileNames = new Set<string>\(\)/);
});

test("既存の思い出検索テキストからタグを除外するマイグレーションを持つ", () => {
  const migration = source("prisma/migrations/20260716130000_separate_record_keyword_and_tag_search/migration.sql");
  assert.match(migration, /UPDATE "hamster_records"/);
  assert.match(migration, /"title"[\s\S]*"memo"/);
  assert.match(migration, /WHERE "record_type" = 'MEMORY'/);
  assert.doesNotMatch(migration, /memory_record_details/);
});

async function pngFile() {
  const buffer = await sharp({ create: { width: 32, height: 24, channels: 3, background: "orange" } }).png().toBuffer();
  return new File([buffer], "memory.png", { type: "image/png" });
}

async function largeMemoryPngFile(width = 1800, height = 1200) {
  const buffer = await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 }
  }).png().toBuffer();
  return new File([buffer], "large-memory.png", { type: "image/png" });
}

test("思い出画像は変換・Household分離・保存失敗時の後片付けに対応する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "record-image-"));
  const image = await prepareRecordImage(await pngFile());
  try {
    const stored = await commitWithNewRecordImage({ householdId: "household-1", image, rootDir: root, commit: async (fileName) => fileName });
    assert.equal(stored, image.fileName);
    assert.deepEqual(await readRecordImage("household-1", image.fileName, root), image.buffer);
    assert.equal(canServeRecordImage({ currentHouseholdId: "household-1", hamsterHouseholdId: "household-1", fileName: image.fileName }), true);
    assert.equal(canServeRecordImage({ currentHouseholdId: "household-2", hamsterHouseholdId: "household-1", fileName: image.fileName }), false);
    await deleteRecordImage("household-1", image.fileName, root);

    const rollbackImage = await prepareRecordImage(await pngFile());
    await assert.rejects(commitWithNewRecordImage({ householdId: "household-1", image: rollbackImage, rootDir: root, commit: async () => { throw new Error("DB failed"); } }), /DB failed/);
    await assert.rejects(readRecordImage("household-1", rollbackImage.fileName, root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("不正な思い出画像を拒否する", async () => {
  await assert.rejects(
    prepareRecordImage(new File([Buffer.alloc(MAX_RECORD_IMAGE_SIZE_BYTES + 1)], "large.jpg", { type: "image/jpeg" })),
    (error: unknown) => error instanceof RecordImageError && error.code === "tooLarge"
  );
  await assert.rejects(prepareRecordImage(new File(["GIF89a"], "memory.gif", { type: "image/gif" })), (error: unknown) => error instanceof RecordImageError && error.code === "unsupported");
});

test("2MBを超える思い出画像を縦横比を保って長辺1920px以内・2MB以下へ圧縮する", async () => {
  const source = await largeMemoryPngFile();
  assert.ok(source.size > MAX_STORED_IMAGE_SIZE_BYTES);
  assert.ok(source.size <= MAX_RECORD_IMAGE_SIZE_BYTES);

  const converted = await prepareRecordImage(source);
  const metadata = await sharp(converted.buffer).metadata();
  assert.ok(converted.buffer.byteLength <= MAX_STORED_IMAGE_SIZE_BYTES);
  assert.equal(metadata.width, 1800);
  assert.equal(metadata.height, 1200);

  const wide = await prepareRecordImage(await pngFileForDimensions(2400, 1200));
  const wideMetadata = await sharp(wide.buffer).metadata();
  assert.equal(wideMetadata.width, RECORD_IMAGE_MAX_DIMENSION);
  assert.equal(wideMetadata.height, RECORD_IMAGE_MAX_DIMENSION / 2);

  const small = await prepareRecordImage(await pngFileForDimensions(320, 180));
  const smallMetadata = await sharp(small.buffer).metadata();
  assert.equal(smallMetadata.width, 320);
  assert.equal(smallMetadata.height, 180);
});

async function pngFileForDimensions(width: number, height: number) {
  const buffer = await sharp({ create: { width, height, channels: 3, background: "orange" } }).png().toBuffer();
  return new File([buffer], "dimensions.png", { type: "image/png" });
}

test("記録フィルターは変更時に自動適用し、スクロール位置を維持する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const form = source("src/components/auto-submit-filter-form.tsx");
  assert.match(page, /<AutoSubmitFilterForm[\s\S]*?action="\/records"/);
  assert.match(page, /ignoreFieldNames=\{\["hamsterId"\]\}/);
  assert.doesNotMatch(page, />絞り込む<\/button>/);
  assert.match(form, /form\.requestSubmit\(\)/);
  assert.match(form, /scroll=\{false\}/);
  assert.match(page, /<div className="grid gap-3 md:grid-cols-\[1fr_auto\]">/);
  assert.match(page, /お気に入りの思い出のみ<\/label>/);
  assert.match(page, /text-slate-700 md:mt-6 md:self-start/);
  assert.doesNotMatch(page, /md:grid-cols-\[1fr_auto\] md:items-end/);
});

test("共通タイムラインは共通ページングを使用し、検索条件とスクロール位置を維持する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const pagination = source("src/components/pagination.tsx");
  const records = source("src/lib/records.ts");

  assert.equal(page.match(/<PaginationLayout/g)?.length, 2);
  assert.match(page, /<PaginationLayout[\s\S]*?<RecordTimeline[\s\S]*?<PaginationLayout/);
  assert.match(page, /ariaLabel="記録一覧のページ移動"/);
  assert.match(page, /visibleCount=\{data\.records\.length\}/);
  assert.equal(page.match(/buildHref=\{buildRecordsPageHref\}/g)?.length, 2);
  assert.equal(page.match(/preserveScroll/g)?.length, 2);
  assert.equal(
    page.match(/<PaginationLayout[\s\S]*?scroll=\{false\}[\s\S]*?preserveScroll[\s\S]*?\/>/g)?.length,
    2
  );
  assert.match(page, /const buildRecordsPageHref = \(page: number\) => recordsUrl\(\{ \.\.\.currentFilters, includeScope: true, page \}\)/);
  for (const filter of ["hamsterId", "type", "from", "to", "keyword", "favoriteOnly"]) {
    assert.match(records, new RegExp(`if \\(options\\.${filter}`));
  }
  assert.match(records, /options\.scope === "household" \|\| \(options\.includeScope && options\.scope === "hamster"\)/);
  assert.doesNotMatch(page, /\{data\.pagination\.totalCount\}件の記録/);
  assert.doesNotMatch(page, /ChevronsLeft|ChevronsRight|aria-label="最初のページ"|aria-label="最後のページ"/);
  assert.match(pagination, /getPaginationItems/);
  assert.match(pagination, /aria-current="page"/);
  assert.match(pagination, /currentPage > 1/);
  assert.match(pagination, /currentPage < totalPages/);
  assert.match(pagination, /pagination\.totalCount > 0/);
});

test("記録画面は表示範囲を明示し、フィルター・種類・ページング・ハムスター選択でscopeを維持する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const query = source("src/lib/record-queries.ts");
  assert.match(page, /Object\.prototype\.hasOwnProperty\.call\(params, "scope"\)/);
  assert.match(page, /scopeParam = getParam\(params\.scope\)/);
  assert.match(page, /hasScopeParam,[\s\S]*?scopeParam,/);
  assert.match(query, /resolveRecordScope\(\{[\s\S]*?hasScopeParam: filters\.hasScopeParam,[\s\S]*?defaultScope: setting\?\.recordTimelineDefaultScope/);
  assert.match(page, /タイムラインの表示範囲/);
  assert.match(page, /選択中のハムスター/);
  assert.match(page, /グループ全体/);
  assert.match(
    page,
    /className="grid grid-cols-2 gap-2 sm:inline-grid sm:w-fit sm:gap-0\.5 sm:rounded-lg sm:bg-slate-100 sm:p-1 sm:ring-1 sm:ring-inset sm:ring-slate-200"/
  );
  assert.match(page, /aria-current=\{scope === option\.scope \? "page" : undefined\}/);
  assert.match(
    page,
    /min-w-0 whitespace-nowrap rounded-full border px-1\.5 py-2 text-center text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss sm:rounded-md sm:border-0 sm:px-3 sm:text-sm/
  );
  assert.match(page, /\? "border-moss bg-moss text-white sm:shadow-sm"/);
  assert.match(page, /: "border-slate-200 bg-white text-slate-700 hover:border-moss hover:text-moss sm:bg-transparent sm:text-slate-600 sm:hover:bg-white"/);
  assert.match(page, /aria-label="記録種類の切り替え"[\s\S]*?className=\{`rounded-full border px-3 py-2 text-sm font-semibold/);
  assert.match(page, /recordsUrl\(\{ \.\.\.currentFilters, scope: option\.scope, includeScope: true, page: 1 \}\)/);
  assert.match(page, /<input type="hidden" name="scope" value=\{scope\} \/>/);
  assert.match(page, /recordsUrl\(\{ \.\.\.currentFilters, includeScope: true, type: tab\.value, page: 1 \}\)/);
  assert.match(page, /記録を追加するハムスター/);
  assert.match(page, /タイムラインにはグループ内の全ハムスターの記録が表示されます。/);
  assert.match(page, /グループ全体のタイムライン/);
  assert.match(page, /<RecordTimeline records=\{data\.records\} hamsters=\{data\.hamsters\} scope=\{scope\} returnHamsterId=\{selectedHamsterId\}/);
});

test("タイムラインは思い出の全対象ハムスターを表示し、健康・通院は従来の所属を使う", () => {
  const timeline = source("src/components/record-timeline.tsx");
  assert.match(timeline, /record\.recordType === "MEMORY"[\s\S]*record\.memoryDetail\?\.hamsters/);
  assert.match(timeline, /recordHamsters\.map\(\(hamster\) => <Link key=\{hamster\.id\}/);
  assert.match(timeline, /hamsterId: hamster\.id/);
  assert.match(timeline, /\{hamster\.name\}<\/Link>/);
  assert.ok((timeline.match(/name="hamsterId" value=\{record\.hamster\.id\}/g)?.length ?? 0) >= 4);
  assert.ok((timeline.match(/name="viewScope"/g)?.length ?? 0) >= 4);
  assert.ok((timeline.match(/name="returnHamsterId"/g)?.length ?? 0) >= 4);
  assert.match(timeline, /const editable = canEdit && \(record\.recordType === "MEMORY" \|\| record\.hamster\.isActive\)/);
  assert.doesNotMatch(timeline, /hamsterIsActive/);
});

test("編集・削除後のURLは対象hamsterIdと表示用hamsterIdを分離してscopeとエラーID遷移へ引き継ぐ", () => {
  const actions = source("src/app/actions/records.ts");
  assert.match(actions, /formData\?\.get\("viewScope"\)/);
  assert.match(actions, /formData\?\.get\("returnHamsterId"\)/);
  assert.match(actions, /normalizeRecordScope/);
  assert.match(actions, /recordsUrl\(\{ scope, includeScope: true, hamsterId: returnHamsterId, status \}\)/);
  assert.match(actions, /recordRedirect\(result\.data\.hamsterId, "recordUpdated", formData\)/);
  assert.match(actions, /recordRedirect\(result\.data\.hamsterId, "recordDeleted", formData\)/);
  assert.ok((actions.match(/searchParams: recordReturnSearchParams/g)?.length ?? 0) >= 4);
  assert.match(actions, /where: \{ id, hamsterId, hamster: \{ householdId \} \}/);
  assert.match(actions, /where: \{ id: result\.data\.id, hamsterId: result\.data\.hamsterId, hamster: \{ householdId: context\.household\.id \} \}/);
});

test("閲覧者権限はグループ表示でもタイムラインの編集・削除UIを有効にしない", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const timeline = source("src/components/record-timeline.tsx");
  assert.match(page, /const canEdit = canEditHouseholdSharedData\(data\.context\.membership\.role\)/);
  assert.match(page, /<RecordTimeline[\s\S]*canEdit=\{canEdit\}/);
  assert.match(timeline, /const editable = canEdit &&/);
  assert.match(timeline, /\{editable \? <form action=\{deleteHamsterRecord\}/);
  assert.match(timeline, /\{editable \? <details/);
});

test("共通タイムラインは白いカードの可読性を保ち、健康・通院・思い出をアクセント配色でも区別する", () => {
  const timeline = source("src/components/record-timeline.tsx");
  assert.match(timeline, /HEALTH:[\s\S]*?border-l-emerald-500 bg-white[\s\S]*?bg-emerald-600[\s\S]*?bg-emerald-50 text-emerald-800[\s\S]*?ring-emerald-200/);
  assert.match(timeline, /MEDICAL:[\s\S]*?border-l-sky-500 bg-white[\s\S]*?bg-sky-600[\s\S]*?bg-sky-50 text-sky-800[\s\S]*?ring-sky-200/);
  assert.match(timeline, /MEMORY:[\s\S]*?border-l-rose-400 bg-white[\s\S]*?bg-rose-500[\s\S]*?bg-rose-50 text-rose-800[\s\S]*?ring-rose-200/);
  assert.equal(timeline.match(/card: "border-slate-200 border-l-4[^\n]*bg-white"/g)?.length, 3);
  assert.match(timeline, /const typeStyle = recordTypeStyles\[record\.recordType\]/);
  assert.match(timeline, /\$\{typeStyle\.card\}/);
  assert.match(timeline, /\$\{typeStyle\.marker\}/);
  assert.match(timeline, /\$\{typeStyle\.badge\}/);
  assert.match(timeline, /<TypeIcon type=\{record\.recordType\} \/>/);
  assert.match(timeline, /\{RECORD_TYPE_LABELS\[record\.recordType\]\}/);
});

test("共通タイムラインの思い出写真はダッシュボードと同様の拡大ダイアログを開く", () => {
  const timeline = source("src/components/record-timeline.tsx");

  assert.match(timeline, /aria-haspopup="dialog"/);
  assert.match(timeline, /aria-label=\{`\$\{title\}の写真を拡大表示`\}/);
  assert.match(timeline, /cursor-zoom-in/);
  assert.match(timeline, /role="dialog"/);
  assert.match(timeline, /aria-modal="true"/);
  assert.match(timeline, /aria-labelledby=\{dialogTitleId\}/);
  assert.match(timeline, /aria-label="写真を閉じる"/);
  assert.match(timeline, /event\.key === "Escape"/);
  assert.match(timeline, /onClick=\{\(\) => setIsOpen\(false\)\}/);
  assert.match(timeline, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(timeline, /alt=\{`\$\{title\}の写真（拡大表示）`\}/);
  assert.match(timeline, /onError=\{handleImageError\}/);
});

test("記録画面はハムスターの空選択を表示せず、クリア時に絞り込み入力を初期化して再取得する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const selector = source("src/components/hamster-selector-input.tsx");
  const form = source("src/components/auto-submit-filter-form.tsx");
  assert.match(page, /<HamsterSelectorInput[\s\S]*?showEmptyOption=\{false\}/);
  assert.match(selector, /!allOptionLabel && showEmptyOption/);
  assert.match(page, /<FilterClearButton fieldNames=\{\["from", "to", "keyword", "favorite"\]\}/);
  assert.match(form, /control\.checked = false/);
  assert.match(form, /valueSetter\?\.call\(control, ""\)/);
  assert.match(form, /new Event\("input", \{ bubbles: true \}\)/);
  assert.match(form, /form\.requestSubmit\(\)/);
});

test("キーワード欄は#入力時に選択中ハムスターの使用済みタグ候補を表示する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const input = source("src/components/record-keyword-input.tsx");
  assert.match(page, /<RecordKeywordInput[\s\S]*?tagSuggestions=\{data\.tagSuggestions\}/);
  assert.match(input, /segment\.startsWith\("#"\)/);
  assert.match(input, /normalizeSearchText\(tag\)\.includes\(normalizedQuery\)/);
  assert.match(input, /selectTag\(tag, event\.currentTarget\.form\)/);
});

test("思い出フォームは保存済みタグの再利用と同時保存に対応する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const forms = source("src/components/record-create-forms.tsx");
  const tagInput = source("src/components/memory-tag-input.tsx");
  assert.match(page, /savedMemoryTags=\{data\.savedMemoryTags\}/);
  assert.match(forms, /<MemoryTagInput savedTags=\{savedMemoryTags\}/);
  assert.match(tagInput, /name="saveTags"/);
  assert.match(tagInput, /入力したタグを保存して再利用する/);
  assert.match(tagInput, /split\(separatorPattern\)/);
  assert.match(tagInput, /normalizeTagStorageValue/);
  assert.match(tagInput, /type="button"/);
  assert.match(tagInput, /<details className=/);
  assert.match(tagInput, /<summary[^>]*>保存済みタグ（\{reusableTags\.length\}件）<\/summary>/);
  assert.match(tagInput, /\{reusableTags\.length > 0 \? \(\s*<details/);
  assert.match(tagInput, /\{initialSuggestions\.length > 0 \? \(\s*<div className="grid gap-2">/);
  assert.doesNotMatch(tagInput, /<details[^>]*\sopen(?:=|\s|>)/);
});

test("思い出登録・編集フォームは要約付き折りたたみで全Household候補と管理外を表示する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const forms = source("src/components/record-create-forms.tsx");
  const timeline = source("src/components/record-timeline.tsx");
  const selector = source("src/components/memory-hamster-selector.tsx");
  const actions = source("src/app/actions/records.ts");
  assert.match(page, /hamsters=\{data\.hamsters\}/);
  assert.match(forms, /<MemoryHamsterSelector[\s\S]*selectedIds=\{\[hamsterId\]\}[\s\S]*lockRepresentative[\s\S]*hasError=\{submitErrors\.memory\?\.field === "hamsterIds"\}/);
  assert.match(timeline, /selectedIds=\{record\.memoryDetail\.hamsters\.map\(\(hamster\) => hamster\.id\)\}/);
  assert.match(timeline, /representativeId=\{record\.hamster\.id\}[\s\S]*isEditing/);
  assert.match(selector, /対象ハムスター（複数選択可）/);
  assert.match(selector, /max-h-64 gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-none sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(selector, /type="checkbox"[\s\S]*name=\{readOnly \? undefined : "hamsterIds"\}/);
  assert.match(selector, /現在選択中のハムスターを代表/);
  assert.match(selector, /管理外/);
  assert.doesNotMatch(selector, /<select|multiple/);
  assert.match(selector, /required=\{!readOnly && summary\.selectedCount === 0 && index === 0\}/);
  assert.match(selector, /<details[\s\S]*open=\{hasError \|\| isOpen\}[\s\S]*onToggle=\{\(event\) => setIsOpen\(event\.currentTarget\.open\)\}[\s\S]*<summary/);
  assert.match(selector, /<summary[^>]*>[\s\S]*対象ハムスター（複数選択可）[\s\S]*aria-live="polite"/);
  assert.match(selector, /detailsRef\.current\.open = true/);
  assert.doesNotMatch(selector, /ChevronDown|aria-expanded|>変更<|>閉じる|<summary[^>]*>[\s\S]*<button/);
  assert.doesNotMatch(selector, /expanded \? "mt-3" : "hidden"/);
  assert.match(actions, /issue\.path\[0\] === "hamsterIds"/);
  assert.match(actions, /recordCreateError\("invalid", "hamsterIds"\)/);
});

test("思い出画像APIは代表だけでなく対象関連のHousehold所属で認可する", () => {
  const route = source("src/app/api/records/[id]/image/route.ts");
  assert.match(route, /memoryDetail: \{[\s\S]*hamsters: \{ some: \{ hamster: \{ householdId: context\.household\.id \} \} \}/);
  assert.match(route, /hamsterHouseholdId = record\?\.memoryDetail\?\.hamsters\[0\]\?\.hamster\.householdId/);
  assert.doesNotMatch(route, /where: \{ id, recordType: "MEMORY", hamster:/);
});

test("デモデータは全思い出を中間関連へ登録し、複数対象のサンプルを1件持つ", () => {
  const seed = source("prisma/seed-demo.ts");
  const demoQuery = source("src/lib/public-demo-queries.ts");
  const demoPage = source("src/app/demo/records/page.tsx");
  assert.match(seed, /tx\.memoryRecordHamster\.createMany/);
  assert.match(seed, /record\.id === PUBLIC_DEMO_RECORD_IDS\.kinakoMemory/);
  assert.match(seed, /PUBLIC_DEMO_HAMSTER_IDS\.monaka/);
  assert.match(demoQuery, /hamsters: record\.memoryDetail\.hamsters\.map\(\(entry\) => entry\.hamster\)/);
  assert.match(demoPage, /<RecordTimeline[\s\S]*hamsters=\{data\.hamsters\}/);
});

test("体調フォームはいつも通り設定を非表示にしつつ再表示用の処理を保持する", () => {
  const forms = source("src/components/record-create-forms.tsx");
  assert.match(forms, /const SHOW_USUAL_CONDITION_CONTROL = false/);
  assert.match(forms, /function setUsualCondition\(\)/);
  assert.match(forms, /overallCondition: "GOOD"/);
  assert.match(forms, /urineCondition: "NORMAL"/);
  assert.match(forms, /SHOW_USUAL_CONDITION_CONTROL \? <button[^>]*onClick=\{setUsualCondition\}/);
  assert.match(forms, />いつも通りに設定<\/button> : null/);
  assert.match(forms, /SHOW_USUAL_CONDITION_CONTROL \? <p[^>]*>「いつも通り」は5つの状態だけを正常値へ設定します。症状とメモは消去しません。<\/p> : null/);
});

test("体調記録はチェック時だけ任意時刻を入力・編集し、カードでは日付、時刻、登録者の順に表示する", () => {
  const forms = source("src/components/record-create-forms.tsx");
  const timeInput = source("src/components/record-time-input.tsx");
  const timeline = source("src/components/record-timeline.tsx");
  assert.match(forms, /記録日<input[^>]*name="recordDate"[\s\S]*<RecordTimeInput \/>/);
  assert.match(timeInput, />\s*時間も記録する\s*<\/label>/);
  assert.match(timeInput, /name="recordTimeEnabled"[\s\S]*defaultChecked=\{Boolean\(defaultValue\)\}/);
  assert.match(timeInput, /\{enabled \? \([\s\S]*type="time" name="recordTime"[\s\S]*required/);
  assert.match(timeline, /<RecordTimeInput defaultValue=\{record\.recordTime\} \/>/);
  assert.match(timeline, /record\.recordDate\.replaceAll\("-", "\/"\)[\s\S]*record\.recordTime[\s\S]*record\.createdByLabel/);
  assert.match(timeline, /<Clock3 className=/);
});

test("共通タイムラインの編集トグルは開閉状態に合わせて文言を切り替える", () => {
  const timeline = source("src/components/record-timeline.tsx");
  assert.match(timeline, /<details className="group mt-4">/);
  assert.match(timeline, /className="group-open:hidden">編集フォームを開く/);
  assert.match(timeline, /className="hidden group-open:inline">編集フォームを閉じる/);
});

test("保存済みタグはモーダルで複数選択し、既存記録を変えずにまとめて削除できる", () => {
  const tagInput = source("src/components/memory-tag-input.tsx");
  assert.match(tagInput, /保存済みタグを削除/);
  assert.match(tagInput, /保存済みタグのおかたづけ/);
  assert.match(tagInput, /role="dialog"/);
  assert.match(tagInput, /aria-modal="true"/);
  assert.match(tagInput, /createPortal\(/);
  assert.match(tagInput, /role="checkbox"/);
  assert.match(tagInput, /すべて選択/);
  assert.match(tagInput, /選択解除/);
  assert.match(tagInput, /selectedTags\.forEach\(\(tag\) => formData\.append\("tags", tag\)\)/);
  assert.match(tagInput, /await deleteSavedMemoryTags\(formData\)/);
  assert.match(tagInput, /router\.refresh\(\)/);
  assert.match(tagInput, /すでに登録した思い出記録のタグは残ります/);
});

test("記録作成エラーは画面遷移せず入力を保持し、画像を送信前にも検証する", () => {
  const actions = source("src/app/actions/records.ts");
  const forms = source("src/components/record-create-forms.tsx");
  const imageField = source("src/components/record-image-field.tsx");
  const imageRules = source("src/lib/image-constraints.ts");
  assert.match(forms, /onSubmit=\{submitRecord\("health", createHealthRecord\)\}/);
  assert.match(forms, /onSubmit=\{submitRecord\("medical", createMedicalRecord\)\}/);
  assert.match(forms, /onSubmit=\{submitRecord\("memory", createMemoryRecord\)\}/);
  assert.match(forms, /new FormData\(form\)/);
  assert.match(forms, /<RecordCreateError error=\{submitErrors\.memory\}/);
  assert.doesNotMatch(forms, /action=\{create(?:Health|Medical|Memory)Record\}/);
  assert.match(actions, /return recordCreateError\(imageValidationStatus\(error\)\)/);
  assert.match(actions, /logUnexpectedError\(error/);
  assert.match(imageField, /file\.size > MAX_IMAGE_UPLOAD_SIZE_BYTES/);
  assert.match(imageField, /setCustomValidity\(error\)/);
  assert.match(imageField, /role="alert"/);
  assert.match(imageRules, /MAX_IMAGE_UPLOAD_SIZE_BYTES = 10 \* 1024 \* 1024/);
  assert.match(imageRules, /MAX_STORED_IMAGE_SIZE_BYTES = 2 \* 1024 \* 1024/);
});

test("記録作成成功時は選択中フォームとスクロール位置を維持してタイムラインだけ更新する", () => {
  const actions = source("src/app/actions/records.ts");
  const forms = source("src/components/record-create-forms.tsx");
  const statusMessage = source("src/components/status-message.tsx");
  const createActions = actions.slice(actions.indexOf("export async function createHealthRecord"), actions.indexOf("async function getEditableRecord"));
  assert.doesNotMatch(createActions, /recordRedirect\(/);
  assert.equal(createActions.match(/return \{ success: true \}/g)?.length, 3);
  assert.match(forms, /const \[kind, setKind\] = useState<RecordCreateKind>/);
  assert.match(forms, /router\.refresh\(\)/);
  assert.doesNotMatch(forms, /router\.(?:push|replace)\(/);
  assert.match(forms, /setFormVersions\(\(current\) => \(\{ \.\.\.current, \[recordKind\]: current\[recordKind\] \+ 1 \}\)\)/);
  assert.match(forms, /key=\{formVersions\.health\}/);
  assert.match(forms, /key=\{formVersions\.medical\}/);
  assert.match(forms, /key=\{formVersions\.memory\}/);
  assert.match(forms, /AutoDismissSuccessMessage message="記録を登録しました。"/);
  assert.match(forms, /記録を登録しました。/);
  assert.match(statusMessage, /AUTO_DISMISS_MS = 3500/);
  assert.match(statusMessage, /LEAVE_ANIMATION_MS = 450/);
  assert.match(statusMessage, /export function AutoDismissSuccessMessage/);
});

test("記録作成フォームは管理外へ切り替わった場合だけ思い出を選択する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const forms = source("src/components/record-create-forms.tsx");
  assert.equal(recordCreateKindForHamsterStatus("health", false), "memory");
  assert.equal(recordCreateKindForHamsterStatus("medical", false), "memory");
  assert.equal(recordCreateKindForHamsterStatus("memory", true), "memory");
  assert.equal(recordCreateKindForHamsterStatus("health", true), "health");
  assert.equal(recordCreateKindForHamsterStatus("medical", true), "medical");
  assert.match(forms, /useState<RecordCreateKind>\(recordCreateKindForHamsterStatus\("health", hamsterIsActive\)\)/);
  assert.match(forms, /useState\(hamsterIsActive\)/);
  assert.match(forms, /if \(previousHamsterIsActive !== hamsterIsActive\) \{\s*setPreviousHamsterIsActive\(hamsterIsActive\);\s*if \(!hamsterIsActive\) \{\s*setKind\(\(currentKind\) => recordCreateKindForHamsterStatus\(currentKind, hamsterIsActive\)\);\s*\}\s*\}/);
  assert.doesNotMatch(forms, /previousHamsterId|setPreviousHamsterId/);
  assert.doesNotMatch(page, /<RecordCreateForms[^>]*\skey=/);
  assert.match(forms, /onClick=\{\(\) => setKind\("health"\)\} disabled=\{!hamsterIsActive\}/);
  assert.match(forms, /onClick=\{\(\) => setKind\("medical"\)\} disabled=\{!hamsterIsActive\}/);
  assert.match(forms, /onClick=\{\(\) => setKind\("memory"\)\}/);
  assert.match(forms, /<div className=\{kind === "memory" \? "" : "hidden"\}>/);
});

test("思い出写真の削除状態を未保存変更として検知し、保存ボタンを活性化できる", () => {
  const imageField = source("src/components/record-image-field.tsx");
  const dirtyState = source("src/components/form-dirty-state.ts");
  assert.match(imageField, /name="removeImage"[\s\S]*data-dirty-control/);
  assert.match(imageField, /removeInputRef\.current\?\.form\?\.dispatchEvent\(new Event\("change"/);
  assert.match(imageField, /}, \[removeCurrent\]\);/);
  assert.match(imageField, /onClick=\{\(\) => \{[\s\S]*setRemoveCurrent\(true\)/);
  assert.match(dirtyState, /control\.type === "hidden"[\s\S]*control\.hasAttribute\("data-dirty-control"\)/);
});
