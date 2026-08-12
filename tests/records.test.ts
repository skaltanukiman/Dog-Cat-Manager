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
  canServePetRecordImage,
  commitWithNewPetRecordImage,
  deletePetRecordImage,
  PET_RECORD_IMAGE_MAX_DIMENSION,
  MAX_PET_RECORD_IMAGE_SIZE_BYTES,
  preparePetRecordImage,
  readPetRecordImage,
  PetRecordImageError
} from "../src/lib/pet-record-image";
import {
  createPetHealthRecordSchema,
  createPetMedicalRecordSchema,
  createPetMedicationRecordSchema,
  createPetMemoryRecordSchema,
  createPetVaccinationRecordSchema,
  updatePetHealthRecordSchema,
  updatePetMedicalRecordSchema,
  updatePetMedicationRecordSchema,
  updatePetMemoryRecordSchema,
  updatePetVaccinationRecordSchema
} from "../src/lib/pet-record-schemas";
import {
  buildPetHealthSearchText,
  buildPetMedicalSearchText,
  buildPetMedicationSearchText,
  buildPetMemorySearchText,
  buildPetMemoryTagSearchValues,
  buildPetRecordKeywordWhere,
  buildPetRecordListWhere,
  buildPetRecordScopeWhere,
  buildPetVaccinationSearchText,
  collectPetRecordTagSuggestions,
  filterToPetRecordType,
  normalizePetRecordScope,
  normalizePetRecordTypeFilter,
  parsePetRecordSearchTerms,
  PET_RECORD_PAGE_SIZE,
  petRecordsUrl
} from "../src/lib/pet-records";
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

function prismaBlock(schema: string, kind: "model" | "enum", name: string) {
  const start = schema.indexOf(`${kind} ${name} {`);
  assert.notEqual(start, -1, `${kind} ${name} が見つかりません。`);
  const end = schema.indexOf("\n}", start);
  assert.notEqual(end, -1, `${kind} ${name} の終端が見つかりません。`);
  return schema.slice(start, end + 2);
}

function actionSource(actions: string, name: string) {
  const start = actions.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} が見つかりません。`);
  const next = actions.indexOf("export async function", start + 1);
  return actions.slice(start, next === -1 ? undefined : next);
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

const validPetHealth = {
  petId: "pet-1",
  recordDate: "2026-08-12",
  recordTime: "08:30",
  overallCondition: "GOOD",
  appetite: "NORMAL",
  activityLevel: "NORMAL",
  stoolCondition: "NORMAL",
  urineCondition: "NORMAL",
  symptoms: ["SNEEZING"],
  memo: " 少しくしゃみ "
};

const validPetMedical = {
  petId: "pet-1",
  recordDate: "2026-08-12",
  recordTime: "",
  hospitalName: " しろ動物病院 ",
  reason: "食欲が少ない",
  diagnosis: "経過観察",
  examination: "触診",
  treatment: "補液",
  medication: "整腸剤",
  medicationInstructions: "朝1回",
  nextVisitDate: "2026-08-20",
  consultationFee: "0",
  memo: ""
};

const validPetMedication = {
  petId: "pet-1",
  recordDate: "2026-08-12",
  recordTime: "08:00",
  medicationName: " アモキシシリン ",
  dosage: " 1錠 ",
  memo: ""
};

const validPetVaccination = {
  petId: "pet-1",
  recordDate: "2026-08-12",
  recordTime: "",
  vaccineName: " 混合ワクチン ",
  hospitalName: "",
  nextDueDate: "2027-08-12",
  memo: ""
};

const validPetMemory = {
  petId: "pet-1",
  petIds: ["pet-1", "pet-2", "pet-2"],
  recordDate: "2026-08-12",
  recordTime: "",
  title: " 初めて海へ行った ",
  content: " 波を眺めて過ごした。 ",
  tags: "海、旅行, 海",
  isFavorite: "true",
  saveTags: "true"
};

test("Pet Health schemaは日付・任意時刻・状態・症状・memoを独立検証する", () => {
  const parsed = createPetHealthRecordSchema.parse(validPetHealth);
  assert.equal(parsed.petId, "pet-1");
  assert.equal(parsed.recordTime, 510);
  assert.equal(parsed.memo, "少しくしゃみ");
  assert.equal(createPetHealthRecordSchema.safeParse({ ...validPetHealth, recordTime: "" }).success, true);
  assert.equal(createPetHealthRecordSchema.safeParse({ ...validPetHealth, symptoms: ["INVALID"] }).success, false);
  assert.equal(createPetHealthRecordSchema.safeParse({ ...validPetHealth, memo: "x".repeat(2001) }).success, false);
  assert.equal(createPetHealthRecordSchema.safeParse({ ...validPetHealth, recordDate: "2026-02-30" }).success, false);
  assert.equal(updatePetHealthRecordSchema.safeParse({ ...validPetHealth, id: "record-1", updatedAt: "2026-08-12T01:00:00.000Z" }).success, true);
});

test("Pet Medical schemaは診察費を0以上の整数に限定し、将来の次回受診日を許可する", () => {
  const parsed = createPetMedicalRecordSchema.parse(validPetMedical);
  assert.equal(parsed.consultationFee, 0);
  assert.equal(parsed.nextVisitDate, "2026-08-20");
  assert.equal(parsed.hospitalName, "しろ動物病院");
  assert.equal(parsed.memo, null);
  for (const consultationFee of ["-1", "1.5", "abc", "100000000"]) {
    assert.equal(createPetMedicalRecordSchema.safeParse({ ...validPetMedical, consultationFee }).success, false);
  }
  assert.equal(createPetMedicalRecordSchema.safeParse({ ...validPetMedical, reason: "" }).success, false);
  assert.equal(createPetMedicalRecordSchema.safeParse({ ...validPetMedical, nextVisitDate: "2026-08-11" }).success, false);
  assert.equal(updatePetMedicalRecordSchema.safeParse({ ...validPetMedical, id: "record-1", updatedAt: "2026-08-12T01:00:00.000Z" }).success, true);
});

test("Pet Medication schemaは薬名必須、投与量・時刻任意、文字数上限を検証する", () => {
  const parsed = createPetMedicationRecordSchema.parse(validPetMedication);
  assert.equal(parsed.medicationName, "アモキシシリン");
  assert.equal(parsed.dosage, "1錠");
  assert.equal(createPetMedicationRecordSchema.parse({ ...validPetMedication, recordTime: "", dosage: "" }).recordTime, null);
  assert.equal(createPetMedicationRecordSchema.parse({ ...validPetMedication, recordTime: "", dosage: "" }).dosage, null);
  assert.equal(createPetMedicationRecordSchema.safeParse({ ...validPetMedication, medicationName: "" }).success, false);
  assert.equal(createPetMedicationRecordSchema.safeParse({ ...validPetMedication, medicationName: "x".repeat(201) }).success, false);
  assert.equal(createPetMedicationRecordSchema.safeParse({ ...validPetMedication, dosage: "x".repeat(101) }).success, false);
  assert.equal(updatePetMedicationRecordSchema.safeParse({ ...validPetMedication, id: "record-1", updatedAt: "2026-08-12T01:00:00.000Z" }).success, true);
});

test("Pet Vaccination schemaはワクチン名必須、病院・次回予定任意、将来予定を許可する", () => {
  const parsed = createPetVaccinationRecordSchema.parse(validPetVaccination);
  assert.equal(parsed.vaccineName, "混合ワクチン");
  assert.equal(parsed.hospitalName, null);
  assert.equal(parsed.nextDueDate, "2027-08-12");
  assert.equal(createPetVaccinationRecordSchema.parse({ ...validPetVaccination, nextDueDate: "" }).nextDueDate, null);
  assert.equal(createPetVaccinationRecordSchema.safeParse({ ...validPetVaccination, vaccineName: "" }).success, false);
  assert.equal(createPetVaccinationRecordSchema.safeParse({ ...validPetVaccination, nextDueDate: "2026-08-11" }).success, false);
  assert.equal(updatePetVaccinationRecordSchema.safeParse({ ...validPetVaccination, id: "record-1", updatedAt: "2026-08-12T01:00:00.000Z" }).success, true);
});

test("Pet Memory schemaは複数Pet・tag・favoriteを正規化し、作成時の代表Petを必須にする", () => {
  const parsed = createPetMemoryRecordSchema.parse(validPetMemory);
  assert.deepEqual(parsed.petIds, ["pet-1", "pet-2"]);
  assert.deepEqual(parsed.tags, ["海", "旅行"]);
  assert.equal(parsed.isFavorite, true);
  assert.equal(parsed.title, "初めて海へ行った");
  assert.equal(createPetMemoryRecordSchema.safeParse({ ...validPetMemory, petIds: ["pet-2"] }).success, false);
  assert.equal(createPetMemoryRecordSchema.safeParse({ ...validPetMemory, petIds: [] }).success, false);
  assert.equal(createPetMemoryRecordSchema.safeParse({ ...validPetMemory, title: "" }).success, false);
  assert.equal(updatePetMemoryRecordSchema.safeParse({ ...validPetMemory, petIds: ["pet-2"], id: "record-1", updatedAt: "2026-08-12T01:00:00.000Z" }).success, true);
});

test("Pet Records検索textは5種類の入力とMemory tag・関連Pet名を含む", () => {
  const health = createPetHealthRecordSchema.parse(validPetHealth);
  const medical = createPetMedicalRecordSchema.parse(validPetMedical);
  const medication = createPetMedicationRecordSchema.parse(validPetMedication);
  const vaccination = createPetVaccinationRecordSchema.parse(validPetVaccination);
  const memory = createPetMemoryRecordSchema.parse(validPetMemory);
  assert.match(buildPetHealthSearchText(health), /くしゃみ/);
  assert.match(buildPetMedicalSearchText(medical), /しろ動物病院/);
  assert.match(buildPetMedicalSearchText(medical), /整腸剤/);
  assert.match(buildPetMedicationSearchText(medication), /アモキシシリン/);
  assert.match(buildPetMedicationSearchText(medication), /1錠/);
  assert.match(buildPetVaccinationSearchText(vaccination), /混合ワクチン/);
  assert.match(buildPetMemorySearchText(memory, ["こむぎ", "ミミ"]), /こむぎ/);
  assert.match(buildPetMemorySearchText(memory, ["こむぎ", "ミミ"]), /旅行/);
  assert.deepEqual(buildPetMemoryTagSearchValues(["旅行", "ＡＢＣ", "abc"]), ["旅行", "abc"]);
});

test("Pet Records filterは5種類・Pet/Household scope・20件ページングを正規化する", () => {
  assert.equal(normalizePetRecordScope("pet"), "pet");
  assert.equal(normalizePetRecordScope("household"), "household");
  assert.equal(normalizePetRecordScope("hamster"), "pet");
  assert.equal(normalizePetRecordScope("invalid"), "pet");
  assert.equal(normalizePetRecordScope(undefined), "pet");
  for (const [input, expected] of [
    ["health", "HEALTH"], ["medical", "MEDICAL"], ["medication", "MEDICATION"],
    ["vaccination", "VACCINATION"], ["memory", "MEMORY"]
  ] as const) {
    const normalized = normalizePetRecordTypeFilter(input);
    assert.equal(filterToPetRecordType(normalized), expected);
  }
  assert.equal(normalizePetRecordTypeFilter("invalid"), "all");
  assert.equal(filterToPetRecordType("all"), undefined);
  assert.equal(PET_RECORD_PAGE_SIZE, 20);
});

test("Pet scopeは非Memoryをbase petId、Memoryを中間関連で絞り、常にHousehold境界を含む", () => {
  assert.deepEqual(buildPetRecordScopeWhere("pet", "household-1", "pet-1"), {
    pet: { householdId: "household-1" },
    OR: [
      { recordType: { in: ["HEALTH", "MEDICAL", "MEDICATION", "VACCINATION"] }, petId: "pet-1" },
      {
        recordType: "MEMORY",
        memoryDetail: {
          is: { pets: { some: { petId: "pet-1", pet: { householdId: "household-1" } } } }
        }
      }
    ]
  });
  assert.deepEqual(buildPetRecordScopeWhere("household", "household-1", "pet-1"), {
    pet: { householdId: "household-1" }
  });
});

test("Pet scopeとkeywordのOR条件はAND合成され、選択Pet境界を上書きしない", () => {
  assert.deepEqual(buildPetRecordListWhere({
    scope: "pet",
    householdId: "household-1",
    selectedPetId: "pet-1",
    recordType: "all",
    from: "",
    to: "",
    keyword: "needle",
    favoriteOnly: false
  }), {
    pet: { householdId: "household-1" },
    AND: [
      {
        OR: [
          { recordType: { in: ["HEALTH", "MEDICAL", "MEDICATION", "VACCINATION"] }, petId: "pet-1" },
          {
            recordType: "MEMORY",
            memoryDetail: {
              is: { pets: { some: { petId: "pet-1", pet: { householdId: "household-1" } } } }
            }
          }
        ]
      },
      { OR: [{ searchText: { contains: "needle", mode: "insensitive" } }] }
    ]
  });
});

test("Pet Records list条件は種類・JST暦日範囲・検索・favoriteをDB条件へ重ねる", () => {
  assert.deepEqual(buildPetRecordListWhere({
    scope: "household",
    householdId: "household-1",
    selectedPetId: "pet-1",
    recordType: "medication",
    from: "2026-08-01",
    to: "2026-08-31",
    keyword: "アモキシシリン",
    favoriteOnly: false
  }), {
    pet: { householdId: "household-1" },
    recordType: "MEDICATION",
    recordDate: {
      gte: new Date("2026-08-01T00:00:00.000Z"),
      lte: new Date("2026-08-31T00:00:00.000Z")
    },
    OR: [
      { searchText: { contains: "アモキシシリン", mode: "insensitive" } },
      { searchText: { contains: "あもきししりん", mode: "insensitive" } }
    ]
  });
  assert.deepEqual(buildPetRecordListWhere({
    scope: "household", householdId: "household-1", selectedPetId: "pet-1",
    recordType: "health", from: "", to: "", keyword: "", favoriteOnly: true
  }), {
    pet: { householdId: "household-1" },
    recordType: "HEALTH"
  });
  assert.deepEqual(buildPetRecordListWhere({
    scope: "household", householdId: "household-1", selectedPetId: "pet-1",
    recordType: "all", from: "", to: "", keyword: "", favoriteOnly: true
  }), {
    pet: { householdId: "household-1" },
    recordType: "MEMORY",
    memoryDetail: { is: { isFavorite: true } }
  });
});

test("Pet Records keyword/tag検索は各群OR・群間ANDでかなと幅を正規化する", () => {
  assert.deepEqual(parsePetRecordSearchTerms("おくすり, 病院, #旅行"), [
    { value: "おくすり", isTag: false },
    { value: "病院", isTag: false },
    { value: "旅行", isTag: true }
  ]);
  const where = buildPetRecordKeywordWhere("クスリ,#ＡＢＣ");
  assert.ok(where?.AND);
  assert.match(JSON.stringify(where), /クスリ/);
  assert.match(JSON.stringify(where), /くすり/);
  assert.match(JSON.stringify(where), /"recordType":"MEMORY"/);
  assert.match(JSON.stringify(where), /"has":"abc"/);
  assert.deepEqual(collectPetRecordTagSuggestions([{ tags: ["ABC", "旅行"] }, { tags: ["ＡＢＣ", "日常"] }]), ["ABC", "日常", "旅行"]);
});

test("Pet Records URLはscope・管理終了表示・filter・paginationを明示して維持する", () => {
  assert.equal(petRecordsUrl({ petId: "pet-1" }), "/records?petId=pet-1");
  assert.equal(
    petRecordsUrl({
      scope: "pet", includeScope: true, petId: "pet-1", includeInactive: true,
      type: "memory", from: "2026-08-01", to: "2026-08-31", keyword: "#旅行",
      favoriteOnly: true, page: 2
    }),
    "/records?scope=pet&petId=pet-1&includeInactive=1&type=memory&from=2026-08-01&to=2026-08-31&keyword=%23%E6%97%85%E8%A1%8C&favorite=1&page=2"
  );
});

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

test("Pet Memory画像は専用root・Household・UUID WebPへ保存し、旧Hamster画像rootと混在しない", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pet-record-image-"));
  const image = await preparePetRecordImage(await pngFile());
  try {
    assert.match(image.fileName, /^[0-9a-f-]{36}\.webp$/i);
    const stored = await commitWithNewPetRecordImage({
      householdId: "household-1",
      image,
      rootDir: root,
      commit: async (fileName) => fileName
    });
    assert.equal(stored, image.fileName);
    assert.deepEqual(await readPetRecordImage("household-1", image.fileName, root), image.buffer);
    assert.equal(canServePetRecordImage({ currentHouseholdId: "household-1", petHouseholdId: "household-1", fileName: image.fileName }), true);
    assert.equal(canServePetRecordImage({ currentHouseholdId: "household-2", petHouseholdId: "household-1", fileName: image.fileName }), false);
    assert.equal(canServePetRecordImage({ currentHouseholdId: "household-1", petHouseholdId: "household-1", fileName: "../secret.webp" }), false);
    await assert.rejects(readPetRecordImage("../household-1", image.fileName, root));
    await assert.rejects(readPetRecordImage("household-1", "../secret.webp", root));
    await deletePetRecordImage("household-1", image.fileName, root);
    await assert.rejects(readPetRecordImage("household-1", image.fileName, root));

    const rollbackImage = await preparePetRecordImage(await pngFile());
    await assert.rejects(commitWithNewPetRecordImage({
      householdId: "household-1",
      image: rollbackImage,
      rootDir: root,
      commit: async () => { throw new Error("DB failed"); }
    }), /DB failed/);
    await assert.rejects(readPetRecordImage("household-1", rollbackImage.fileName, root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const imageUtility = source("src/lib/pet-record-image.ts");
  const legacyImageUtility = source("src/lib/record-image.ts");
  assert.match(imageUtility, /process\.env\.PET_RECORD_IMAGE_DIR \|\| "\.\/uploads\/pet-records"/);
  assert.doesNotMatch(imageUtility, /process\.env\.RECORD_IMAGE_DIR/);
  assert.match(legacyImageUtility, /process\.env\.RECORD_IMAGE_DIR/);
  assert.doesNotMatch(legacyImageUtility, /PET_RECORD_IMAGE_DIR/);
});

test("Pet Memory画像は入力形式と10MB上限を検証し、WebPを長辺1920px・2MB以下で保存する", async () => {
  await assert.rejects(
    preparePetRecordImage(new File([Buffer.alloc(MAX_PET_RECORD_IMAGE_SIZE_BYTES + 1)], "large.jpg", { type: "image/jpeg" })),
    (error: unknown) => error instanceof PetRecordImageError && error.code === "tooLarge"
  );
  await assert.rejects(
    preparePetRecordImage(new File(["GIF89a"], "memory.gif", { type: "image/gif" })),
    (error: unknown) => error instanceof PetRecordImageError && error.code === "unsupported"
  );

  const converted = await preparePetRecordImage(await largeMemoryPngFile());
  const metadata = await sharp(converted.buffer).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(converted.buffer.byteLength <= MAX_STORED_IMAGE_SIZE_BYTES);
  assert.ok(Math.max(metadata.width ?? 0, metadata.height ?? 0) <= PET_RECORD_IMAGE_MAX_DIMENSION);
});

async function pngFileForDimensions(width: number, height: number) {
  const buffer = await sharp({ create: { width, height, channels: 3, background: "orange" } }).png().toBuffer();
  return new File([buffer], "dimensions.png", { type: "image/png" });
}

test("Pet Recordsは5種類の共通baseと種類別detailを旧Hamster Recordsと分離して持つ", () => {
  const schema = source("prisma/schema.prisma");
  const recordType = prismaBlock(schema, "enum", "PetRecordType");
  const petRecord = prismaBlock(schema, "model", "PetRecord");
  const pet = prismaBlock(schema, "model", "Pet");
  const user = prismaBlock(schema, "model", "User");

  assert.deepEqual(
    [...recordType.matchAll(/^\s{2}(HEALTH|MEDICAL|MEDICATION|VACCINATION|MEMORY)\s*$/gm)].map((match) => match[1]),
    ["HEALTH", "MEDICAL", "MEDICATION", "VACCINATION", "MEMORY"]
  );
  assert.match(petRecord, /pet\s+Pet\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(petRecord, /createdBy\s+User\?\s+@relation\("PetRecordCreator",[^\n]+onDelete: SetNull\)/);
  assert.match(petRecord, /recordDate\s+DateTime\s+@map\("record_date"\) @db\.Date/);
  assert.match(petRecord, /recordTimeMinutes\s+Int\?\s+@map\("record_time_minutes"\) @db\.SmallInt/);
  assert.match(petRecord, /@@index\(\[petId, recordDate, recordTimeMinutes, createdAt\]\)/);
  assert.match(petRecord, /@@index\(\[petId, recordType, recordDate\]\)/);
  assert.match(pet, /records\s+PetRecord\[\]/);
  assert.match(user, /createdPetRecords\s+PetRecord\[\]\s+@relation\("PetRecordCreator"\)/);

  for (const [model, table] of [
    ["PetHealthRecordDetail", "pet_health_record_details"],
    ["PetMedicalVisitDetail", "pet_medical_visit_details"],
    ["PetMedicationRecordDetail", "pet_medication_record_details"],
    ["PetVaccinationRecordDetail", "pet_vaccination_record_details"],
    ["PetMemoryRecordDetail", "pet_memory_record_details"]
  ] as const) {
    const block = prismaBlock(schema, "model", model);
    assert.match(block, /petRecord\s+PetRecord\s+@relation\([^\n]+onDelete: Cascade\)/);
    assert.match(block, new RegExp(`@@map\\("${table}"\\)`));
  }

  const memoryPet = prismaBlock(schema, "model", "PetMemoryRecordPet");
  assert.match(memoryPet, /memoryRecord\s+PetMemoryRecordDetail\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(memoryPet, /pet\s+Pet\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(memoryPet, /@@id\(\[petRecordId, petId\]\)/);
  assert.match(memoryPet, /@@index\(\[petId\]\)/);

  const memoryImage = prismaBlock(schema, "model", "PetMemoryRecordImage");
  assert.match(memoryImage, /memoryRecord\s+PetMemoryRecordDetail\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(memoryImage, /@@unique\(\[memoryRecordId, sortOrder\]\)/);

  for (const legacyModel of [
    "HamsterRecord", "HealthRecordDetail", "MedicalVisitDetail", "MemoryRecordDetail",
    "MemoryRecordHamster", "MemoryRecordImage"
  ]) assert.ok(prismaBlock(schema, "model", legacyModel).length > 0);
  assert.ok(prismaBlock(schema, "enum", "HamsterRecordType").length > 0);
});

test("Pet Records migrationは新規構造・FK・index・15 Activity eventだけを安全に追加する", () => {
  const migration = source("prisma/migrations/20260812230000_add_pet_records/migration.sql");
  assert.match(migration, /CREATE TYPE "PetRecordType" AS ENUM \('HEALTH', 'MEDICAL', 'MEDICATION', 'VACCINATION', 'MEMORY'\)/);
  for (const table of [
    "pet_records", "pet_health_record_details", "pet_medical_visit_details",
    "pet_medication_record_details", "pet_vaccination_record_details",
    "pet_memory_record_details", "pet_memory_record_pets", "pet_memory_record_images"
  ]) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));

  assert.match(migration, /REFERENCES "pets"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "users"\("id"\) ON DELETE SET NULL/);
  assert.ok((migration.match(/REFERENCES "pet_records"\("id"\) ON DELETE CASCADE/g) ?? []).length >= 5);
  assert.match(migration, /pet_records_pet_id_record_date_record_time_minutes_created_at_idx/);
  assert.match(migration, /pet_records_pet_id_record_type_record_date_idx/);
  assert.match(migration, /pet_memory_record_pets_pkey|PRIMARY KEY \("pet_record_id", "pet_id"\)/);
  assert.match(migration, /pet_memory_record_pets_pet_id_idx/);
  assert.match(migration, /pet_memory_record_details_search_tags_idx/);

  const petEvents = ["HEALTH", "MEDICAL", "MEDICATION", "VACCINATION", "MEMORY"]
    .flatMap((type) => ["CREATED", "UPDATED", "DELETED"].map((verb) => `PET_${type}_RECORD_${verb}`));
  for (const event of petEvents) assert.match(migration, new RegExp(`ADD VALUE '${event}'`));
  assert.equal(petEvents.length, 15);

  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|RENAME\s+(?:TABLE|COLUMN)/i);
  assert.doesNotMatch(
    migration,
    /ALTER TABLE "(?:hamster_records|health_record_details|medical_visit_details|memory_record_details|memory_record_hamsters|memory_record_images|hamsters|feeding_records|water_replacement_records|cleaning_records|weight_records|pets|users)"/i
  );
});

test("Pet Records migration追加後も直前のPet Care migrationと旧Hamster Records migrationを変更対象にしない", () => {
  const petCare = source("prisma/migrations/20260812203000_add_pet_care_records/migration.sql");
  const speciesCare = source("prisma/migrations/20260812214000_add_pet_species_care_records/migration.sql");
  const hamsterRecords = source("prisma/migrations/20260715120000_add_hamster_records/migration.sql");
  assert.doesNotMatch(petCare, /PetRecordType|pet_records|pet_(?:health|medical|medication|vaccination|memory)_record/);
  assert.doesNotMatch(speciesCare, /PetRecordType|pet_records|pet_(?:health|medical|medication|vaccination|memory)_record/);
  assert.match(hamsterRecords, /CREATE TABLE "hamster_records"/);
  assert.doesNotMatch(hamsterRecords, /PetRecordType|pet_records/);
});

test("Pet Records queryはPet候補・Household境界・scope・filter・安定順・20件ページングをDBへ適用する", () => {
  const query = source("src/lib/pet-record-queries.ts");
  assert.match(query, /where: \{ householdId: context\.household\.id \}/);
  assert.match(query, /filters\.includeInactive \? allPets : allPets\.filter\(\(pet\) => pet\.isActive\)/);
  assert.match(query, /normalizePetRecordScope\(filters\.scopeParam\)/);
  assert.match(query, /buildPetRecordListWhere\(\{[\s\S]*householdId: context\.household\.id[\s\S]*selectedPetId: selectedPet\.id/);
  assert.match(query, /prisma\.petRecord\.count\(\{ where \}\)/);
  assert.match(query, /prisma\.petRecord\.findMany\(\{[\s\S]*where,/);
  assert.match(query, /recordDate: "desc"[\s\S]*recordTimeMinutes: \{ sort: "desc", nulls: "last" \}[\s\S]*createdAt: "desc"[\s\S]*id: "desc"/);
  assert.match(query, /skip: \(currentPage - 1\) \* PET_RECORD_PAGE_SIZE/);
  assert.match(query, /take: PET_RECORD_PAGE_SIZE/);
  assert.match(query, /petMemoryRecordDetail\.findMany\(\{[\s\S]*petRecord: buildPetRecordScopeWhere\(scope, context\.household\.id, selectedPet\.id\)/);
  assert.match(query, /pets: \{[\s\S]*orderBy: \[\{ sortOrder: "asc" \}, \{ petId: "asc" \}\]/);
  assert.match(query, /pets: record\.memoryDetail\.pets\.map\(\(entry\) => entry\.pet\)/);
  assert.doesNotMatch(query, /petMemoryRecordPet\.findMany/);
});

test("Pet Record画像APIは未認証401、権限外・不正record・画像欠損404でWebPだけを非公開配信する", () => {
  const route = source("src/app/api/pet-records/[id]/image/route.ts");
  assert.match(route, /getHouseholdContextForRoute\(\)/);
  assert.match(route, /if \(!context\)[\s\S]*status: 401/);
  assert.match(route, /prisma\.petRecord\.findFirst\(\{[\s\S]*id,[\s\S]*recordType: "MEMORY"[\s\S]*pet: \{ householdId: context\.household\.id \}/);
  assert.match(route, /canServePetRecordImage\(\{[\s\S]*currentHouseholdId: context\.household\.id/);
  assert.match(route, /readPetRecordImage\(context\.household\.id, fileName!\)/);
  assert.match(route, /status: 404/);
  assert.match(route, /"Content-Type": "image\/webp"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
});

test("Pet Record共通mutationはtransaction内で最新membership・全Pet境界/active・recordType・updatedAtを確認する", () => {
  const mutations = source("src/lib/pet-record-mutations.ts");
  assert.match(mutations, /householdId_userId: \{ householdId, userId \}/);
  assert.match(mutations, /canEditHouseholdSharedData\(membership\.role\)/);
  assert.match(mutations, /membership\.household\.isDemo/);
  assert.match(mutations, /where: \{ id: \{ in: uniquePetIds \}, householdId \}/);
  assert.match(mutations, /pets\.length !== uniquePetIds\.length/);
  assert.match(mutations, /pets\.some\(\(pet\) => !pet\.isActive\)/);
  assert.match(mutations, /where: \{ id: recordId, recordType: expectedType, pet: \{ householdId \} \}/);
  assert.match(mutations, /record\.updatedAt\.getTime\(\) !== expectedUpdatedAt\.getTime\(\)/);
  assert.match(mutations, /publishHouseholdChangeSafely\(change\)/);
  assert.match(mutations, /\{ path: "\/records" \}[\s\S]*\{ path: "\/settings\/members" \}[\s\S]*\{ path: "\/settings\/members\/activity" \}/);
  assert.doesNotMatch(mutations, /\{ path: "\/dashboard" \}/);
});

test("Health・Medical・Medication・Vaccination Actionはtype固定でCRUD境界・future・unchanged・楽観ロックを保証する", () => {
  for (const [kind, type] of [
    ["health", "HEALTH"], ["medical", "MEDICAL"],
    ["medication", "MEDICATION"], ["vaccination", "VACCINATION"]
  ] as const) {
    const actions = source(`src/app/actions/pet-${kind}-records.ts`);
    const pascalKind = `${kind[0].toUpperCase()}${kind.slice(1)}`;
    const create = actionSource(actions, `createPet${pascalKind}Record`);
    const update = actionSource(actions, `updatePet${pascalKind}Record`);

    assert.match(create, new RegExp(`createPet${pascalKind}RecordSchema\\.safeParse`));
    assert.match(create, /isFutureDateInput\(parsed\.data\.recordDate\)/);
    assert.match(create, /isFutureRecordTime\(parsed\.data\.recordDate, parsed\.data\.recordTime\)/);
    assert.match(create, new RegExp(`recordType: "${type}"`));
    assert.match(create, /commitHouseholdMutation\(\{/);
    assert.match(create, /source: "petRecord"/);
    assert.match(create, /assertCurrentPetRecordMutationPermission\(tx, context\.household\.id, context\.user\.id\)/);
    assert.match(create, /getActiveMutationPets\(tx, \[parsed\.data\.petId\], context\.household\.id\)/);
    assert.match(create, /petRecordActivity\("created", created\)/);
    assert.match(create, /publishAndRevalidatePetRecord\(change/);

    assert.match(update, new RegExp(`updatePet${pascalKind}RecordSchema\\.safeParse`));
    assert.match(update, new RegExp(`id: parsed\\.data\\.id, petId: parsed\\.data\\.petId, recordType: "${type}", pet: \\{ householdId: context\\.household\\.id \\}`));
    assert.match(update, /current\.updatedAt\.getTime\(\) !== parsed\.data\.updatedAt\.getTime\(\)/);
    assert.match(update, /"unchanged"/);
    assert.match(update, new RegExp(`assertExpectedPetRecordVersion\\(tx, parsed\\.data\\.id, parsed\\.data\\.updatedAt, context\\.household\\.id, "${type}"\\)`));
    assert.match(update, /tx\.petRecord\.updateMany\(\{[\s\S]*updatedAt: parsed\.data\.updatedAt[\s\S]*pet: \{ householdId: context\.household\.id, isActive: true \}/);
    assert.match(update, /updated\.count !== 1/);
    assert.match(update, /petRecordActivity\("updated", updated\)/);
    assert.match(update, /publishAndRevalidatePetRecord\(change/);
    assert.doesNotMatch(actions, /formData\.get\("recordType"\)/);
  }
});

test("Pet Memory Actionは複数Pet全件のHousehold/active・tag・favorite・画像をtransactionと後処理で整合させる", () => {
  const actions = source("src/app/actions/pet-memory-records.ts");
  const mutations = source("src/lib/pet-record-mutations.ts");
  const create = actionSource(actions, "createPetMemoryRecord");
  const update = actionSource(actions, "updatePetMemoryRecord");

  assert.match(actions, /parsePetMemoryRecordForm\(formData\)/);
  assert.match(mutations, /petIds: formData\.getAll\("petIds"\)/);
  assert.match(create, /isFutureDateInput\(parsed\.data\.recordDate\)/);
  assert.match(create, /isFutureRecordTime\(parsed\.data\.recordDate, parsed\.data\.recordTime\)/);
  assert.match(create, /getActiveMutationPets\(tx, parsed\.data\.petIds, context\.household\.id\)/);
  assert.match(create, /parsed\.data\.petIds\.includes\(parsed\.data\.petId\)/);
  assert.match(create, /recordType: "MEMORY"/);
  assert.match(create, /pets: \{[\s\S]*create: parsed\.data\.petIds\.map\(\(targetPetId, sortOrder\)/);
  assert.match(create, /savedMemoryTag\.createMany\(\{[\s\S]*skipDuplicates: true/);
  assert.match(create, /searchTags: buildPetMemoryTagSearchValues\(parsed\.data\.tags\)/);
  assert.match(create, /commitWithNewPetRecordImage\(\{ householdId: context\.household\.id, image: preparedImage, commit \}\)/);
  assert.match(create, /petRecordActivity\("created", created\)/);

  assert.match(update, /recordType: "MEMORY", pet: \{ householdId: context\.household\.id \}/);
  assert.match(update, /current\.memoryDetail\.pets\.map\(\(entry\) => entry\.petId\)/);
  assert.match(update, /getActiveMutationPets\(tx, allPetIds, context\.household\.id\)/);
  assert.match(update, /assertExpectedPetRecordVersion\(tx, parsed\.data\.id, parsed\.data\.updatedAt, context\.household\.id, "MEMORY"\)/);
  assert.match(update, /representativePetId = parsed\.data\.petIds\.includes\(current\.petId\) \? current\.petId : parsed\.data\.petIds\[0\]/);
  assert.match(update, /isSameOrderedStringArray\(currentPetIds, parsed\.data\.petIds\)/);
  assert.match(update, /"unchanged"/);
  assert.match(update, /petMemoryRecordPet\.deleteMany/);
  assert.match(update, /petMemoryRecordPet\.createMany/);
  assert.match(update, /petMemoryRecordImage\.deleteMany/);
  assert.match(update, /petMemoryRecordImage\.create/);
  assert.match(update, /commitWithNewPetRecordImage/);
  assert.match(update, /publishAndRevalidatePetRecord\([\s\S]*if \(\(preparedImage \|\| removeImage\) && oldImageFileName\)/);
  assert.match(update, /deleteImageAfterCommit\([\s\S]*oldImageFileName/);
  assert.match(update, /petRecordActivity\("updated", updated\)/);
  assert.doesNotMatch(actions, /formData\.get\("recordType"\)/);
});

test("Pet Record削除はDB上のtypeと全関連Petを再確認し、commit後だけ画像を削除する", () => {
  const actions = source("src/app/actions/pet-records.ts");
  const remove = actionSource(actions, "deletePetRecord");
  assert.match(remove, /deletePetRecordSchema\.safeParse\(Object\.fromEntries\(formData\)\)/);
  assert.match(remove, /assertCurrentPetRecordMutationPermission\(tx, context\.household\.id, context\.user\.id\)/);
  assert.match(remove, /where: \{ id: parsed\.data\.id, petId: parsed\.data\.petId, pet: \{ householdId: context\.household\.id \} \}/);
  assert.match(remove, /record\.recordType === "MEMORY"[\s\S]*record\.memoryDetail\?\.pets\.map/);
  assert.match(remove, /record\.memoryDetail\?\.pets\.some\(\(entry\) => entry\.pet\.householdId !== context\.household\.id\)/);
  assert.match(remove, /getActiveMutationPets\(tx, relatedPetIds, context\.household\.id\)/);
  assert.match(remove, /tx\.petRecord\.deleteMany\(\{[\s\S]*pet: \{ householdId: context\.household\.id, isActive: true \}/);
  assert.match(remove, /petRecordActivity\("deleted", record\)/);
  assert.match(remove, /publishAndRevalidatePetRecord\([\s\S]*deleteImageAfterCommit\(context\.household\.id, result\.imageFileName/);
  assert.doesNotMatch(remove, /formData\.get\("recordType"\)/);
});

test("Pet SavedMemoryTag削除は現在Household・最新membership・revisionと同一transactionに限定する", () => {
  const actions = source("src/app/actions/pet-memory-records.ts");
  const remove = actionSource(actions, "deletePetSavedMemoryTags");
  assert.match(remove, /deletePetSavedMemoryTagsSchema\.safeParse\(\{ tags: formData\.getAll\("tags"\) \}\)/);
  assert.match(remove, /commitHouseholdMutation\(\{/);
  assert.match(remove, /source: "petRecord"/);
  assert.match(remove, /assertCurrentPetRecordMutationPermission\(tx, context\.household\.id, context\.user\.id\)/);
  assert.match(remove, /savedMemoryTag\.deleteMany\(\{[\s\S]*householdId: context\.household\.id/);
  assert.match(remove, /publishAndRevalidatePetRecord\(change/);
  assert.doesNotMatch(remove, /petRecord\.delete|petMemoryRecordDetail\.delete/);
});

test("Pet Records UIは5種類の作成フォームと5種類のtimelineを持ち、recordTypeをFormDataから信用しない", () => {
  const forms = source("src/components/pet-record-create-forms.tsx");
  const timeline = source("src/components/pet-record-timeline.tsx");
  const memorySelector = source("src/components/memory-pet-selector.tsx");
  for (const [kind, action] of [
    ["health", "createPetHealthRecord"], ["medical", "createPetMedicalRecord"],
    ["medication", "createPetMedicationRecord"], ["vaccination", "createPetVaccinationRecord"],
    ["memory", "createPetMemoryRecord"]
  ] as const) {
    assert.match(forms, new RegExp(`submitRecord\\("${kind}", ${action}\\)`));
  }
  for (const type of ["HEALTH", "MEDICAL", "MEDICATION", "VACCINATION", "MEMORY"]) {
    assert.match(timeline, new RegExp(`record\\.recordType === "${type}"`));
  }
  for (const name of [
    "recordDate", "overallCondition", "reason", "consultationFee",
    "medicationName", "dosage", "vaccineName", "nextDueDate", "petIds", "title",
    "content", "isFavorite"
  ]) assert.match(`${forms}\n${timeline}\n${memorySelector}`, new RegExp(`name="${name}"`));
  assert.match(forms, /<RecordTimeInput \/>/);
  assert.match(forms, /<RecordImageField imageApiBase="\/api\/pet-records" \/>/);
  assert.doesNotMatch(forms, /name="recordType"/);
});

test("Pet記録フィルターはPet・日付・keyword・favoriteを自動適用し、不正範囲と未来日を表示する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const form = source("src/components/auto-submit-filter-form.tsx");
  assert.match(page, /<AutoSubmitFilterForm[\s\S]*?action="\/records"/);
  assert.doesNotMatch(page, />絞り込む<\/button>/);
  assert.match(form, /form\.requestSubmit\(\)/);
  assert.match(form, /scroll=\{false\}/);
  assert.match(page, /<select name="petId" defaultValue=\{selectedPetId\}/);
  assert.match(page, /name="from" defaultValue=\{filters\.from\} max=\{today\}/);
  assert.match(page, /name="to" defaultValue=\{filters\.to\} max=\{today\}/);
  assert.match(page, /name="includeInactive" value="1"/);
  assert.match(page, /<div className="grid gap-3 md:grid-cols-\[1fr_auto\]">/);
  assert.match(page, /お気に入りの思い出のみ<\/label>/);
  assert.match(page, /disabled=\{filters\.type !== "all" && filters\.type !== "memory"\}/);
  assert.match(page, /favoriteOnly: \(tab\.value === "all" \|\| tab\.value === "memory"\) && currentFilters\.favoriteOnly/);
  assert.match(page, /invalidRange[\s\S]*開始日は終了日以前の日付を指定してください。/);
  assert.match(page, /futureDateFilter[\s\S]*未来日は絞り込みに指定できません。/);
});

test("共通タイムラインは共通ページングを使用し、検索条件とスクロール位置を維持する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const pagination = source("src/components/pagination.tsx");
  const records = source("src/lib/pet-records.ts");

  assert.equal(page.match(/<PaginationLayout/g)?.length, 2);
  assert.match(page, /<PaginationLayout[\s\S]*?<PetRecordTimeline[\s\S]*?<PaginationLayout/);
  assert.match(page, /ariaLabel="記録一覧のページ移動"/);
  assert.match(page, /visibleCount=\{data\.records\.length\}/);
  assert.equal(page.match(/buildHref=\{buildRecordsPageHref\}/g)?.length, 2);
  assert.equal(page.match(/preserveScroll/g)?.length, 2);
  assert.equal(
    page.match(/<PaginationLayout[\s\S]*?scroll=\{false\}[\s\S]*?preserveScroll[\s\S]*?\/>/g)?.length,
    2
  );
  assert.match(page, /const buildRecordsPageHref = \(page: number\) => petRecordsUrl\(\{ \.\.\.currentFilters, page \}\)/);
  for (const filter of ["petId", "includeInactive", "type", "from", "to", "keyword", "favoriteOnly"]) {
    assert.match(records, new RegExp(`if \\(options\\.${filter}`));
  }
  assert.match(records, /options\.scope === "household" \|\| \(options\.includeScope && options\.scope === "pet"\)/);
  assert.doesNotMatch(page, /\{data\.pagination\.totalCount\}件の記録/);
  assert.doesNotMatch(page, /ChevronsLeft|ChevronsRight|aria-label="最初のページ"|aria-label="最後のページ"/);
  assert.match(pagination, /getPaginationItems/);
  assert.match(pagination, /aria-current="page"/);
  assert.match(pagination, /currentPage > 1/);
  assert.match(pagination, /currentPage < totalPages/);
  assert.match(pagination, /pagination\.totalCount > 0/);
});

test("Pet記録の更新・削除後も安全に正規化した絞り込みとページを維持する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const timeline = source("src/components/pet-record-timeline.tsx");
  const mutations = source("src/lib/pet-record-mutations.ts");

  assert.match(page, /returnFilters=\{\{/);
  for (const field of ["type", "from", "to", "keyword", "favoriteOnly", "page"]) {
    assert.match(page, new RegExp(`${field}: (?:filters\\.${field}|data\\.pagination\\.currentPage)`));
  }
  for (const field of ["Type", "From", "To", "Keyword", "Favorite", "Page"]) {
    assert.match(timeline, new RegExp(`name="return${field}"`));
    assert.match(mutations, new RegExp(`formData\\?\\.get\\("return${field}"\\)`));
  }
  assert.match(mutations, /normalizePetRecordTypeFilter/);
  assert.match(mutations, /normalizePetRecordDateFilter/);
  assert.match(mutations, /normalizePetRecordKeyword/);
  assert.match(mutations, /normalizePetRecordPage/);
});

test("/recordsはPet selector・species・管理終了切替・2 scope・6種類tabを提供する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const query = source("src/lib/pet-record-queries.ts");
  assert.match(page, /scopeParam: getParam\(params\.scope\)/);
  assert.match(query, /normalizePetRecordScope\(filters\.scopeParam\)/);
  assert.match(page, /タイムラインの表示範囲/);
  assert.match(page, /scope: "pet", label: "選択中のPet"/);
  assert.match(page, /scope: "household", label: "共有グループ全体"/);
  assert.match(page, /aria-current=\{scope === option\.scope \? "page" : undefined\}/);
  assert.match(page, /petRecordsUrl\(\{ \.\.\.currentFilters, scope: option\.scope, page: 1 \}\)/);
  assert.match(page, /<input type="hidden" name="scope" value=\{scope\} \/>/);
  assert.match(page, /<select name="petId"[\s\S]*pet\.name\}（\{speciesLabel\[pet\.species\]\}）/);
  assert.match(page, /<PetThumbnail petId=\{data\.selectedPet\.id\}/);
  assert.match(page, /管理終了したPetも含む/);
  for (const tab of ["すべて", "健康・体調", "通院", "投薬", "ワクチン", "思い出"]) {
    assert.match(page, new RegExp(`label: "${tab}"`));
  }
  assert.match(page, /<PetRecordTimeline[\s\S]*records=\{data\.records\}[\s\S]*pets=\{data\.pets\}[\s\S]*scope=\{scope\}[\s\S]*returnPetId=\{selectedPetId\}/);
  assert.doesNotMatch(page, /ハムスター|hamsterId|scope: "hamster"/);
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

test("VIEWERと管理終了Petはフォームを描画せず、Pet timelineを閲覧専用にする", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const timeline = source("src/components/pet-record-timeline.tsx");
  assert.match(page, /const canEdit = canEditHouseholdSharedData\(data\.context\.membership\.role\)/);
  assert.match(page, /!canEdit[\s\S]*閲覧者は記録の検索・閲覧のみ利用できます。/);
  assert.match(page, /!data\.selectedPet\.isActive[\s\S]*このPetは管理終了済みのため、記録の閲覧のみ可能です。/);
  assert.match(page, /<PetRecordTimeline[\s\S]*canEdit=\{canEdit\}/);
  assert.match(timeline, /const editable = canEdit && record\.pet\.isActive && relatedPets\.every\(\(pet\) => pet\.isActive\)/);
  assert.match(timeline, /\{editable \? <form action=\{deletePetRecord\}/);
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

test("記録画面はPet selectorへspeciesを表示し、クリア時に絞り込み入力を初期化して再取得する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const form = source("src/components/auto-submit-filter-form.tsx");
  assert.match(page, /<select name="petId" defaultValue=\{selectedPetId\}/);
  assert.match(page, /pet\.name\}（\{speciesLabel\[pet\.species\]\}）/);
  assert.doesNotMatch(page, /<option value="">/);
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

test("Pet思い出登録・編集フォームは複数Pet selectorで全Household候補と管理終了を表示する", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const forms = source("src/components/pet-record-create-forms.tsx");
  const timeline = source("src/components/pet-record-timeline.tsx");
  const selector = source("src/components/memory-pet-selector.tsx");
  assert.match(page, /pets=\{data\.pets\}/);
  assert.match(forms, /<MemoryPetSelector[\s\S]*selectedIds=\{\[petId\]\}[\s\S]*lockRepresentative[\s\S]*hasError=\{submitErrors\.memory\?\.field === "petIds"\}/);
  assert.match(timeline, /selectedIds=\{record\.memoryDetail\.pets\.map\(\(pet\) => pet\.id\)\}/);
  assert.match(timeline, /representativeId=\{record\.pet\.id\}[\s\S]*isEditing/);
  assert.match(selector, /対象Pet（複数選択可）/);
  assert.match(selector, /max-h-64 gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-none sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(selector, /type="checkbox"[\s\S]*name=\{!readOnly && !isLockedRepresentative \? "petIds" : undefined\}/);
  assert.match(selector, /現在選択中のPetを代表/);
  assert.match(selector, /管理終了/);
  assert.doesNotMatch(selector, /<select|multiple/);
  assert.match(selector, /required=\{!readOnly && summary\.selectedCount === 0 && index === 0\}/);
  assert.match(selector, /<details[\s\S]*open=\{hasError \|\| isOpen\}[\s\S]*onToggle=\{\(event\) => setIsOpen\(event\.currentTarget\.open\)\}[\s\S]*<summary/);
  assert.match(selector, /<summary[^>]*>[\s\S]*対象Pet（複数選択可）[\s\S]*aria-live="polite"/);
  assert.match(selector, /detailsRef\.current\.open = true/);
  assert.doesNotMatch(selector, /ChevronDown|aria-expanded|>変更<|>閉じる|<summary[^>]*>[\s\S]*<button/);
  assert.doesNotMatch(selector, /expanded \? "mt-3" : "hidden"/);
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
