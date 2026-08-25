
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
  DEFAULT_PET_RECORD_SCOPE,
  normalizePetRecordScope,
  normalizePetRecordTypeFilter,
  parsePetRecordSearchTerms,
  PET_RECORD_PAGE_SIZE,
  petRecordsUrl,
  resolvePetRecordScope
} from "../src/lib/pet-records";
import { MAX_STORED_IMAGE_SIZE_BYTES } from "../src/lib/image-constraints";
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
  assert.equal(parseRecordTimeInput("07:05"), 425);
  assert.equal(formatRecordTime(425), "07:05");
  assert.equal(formatRecordTime(null), null);
  assert.equal(createPetHealthRecordSchema.safeParse({ ...validPetHealth, recordTime: "" }).success, true);
  assert.equal(createPetHealthRecordSchema.safeParse({ ...validPetHealth, symptoms: ["INVALID"] }).success, false);
  assert.equal(createPetHealthRecordSchema.safeParse({ ...validPetHealth, memo: "x".repeat(2001) }).success, false);
  assert.equal(createPetHealthRecordSchema.safeParse({ ...validPetHealth, recordDate: "2026-02-30" }).success, false);
  assert.equal(updatePetHealthRecordSchema.safeParse({ ...validPetHealth, id: "record-1", updatedAt: "2026-08-12T01:00:00.000Z" }).success, true);
});

test("Pet Recordの任意時刻はJSTの現在時刻より未来の場合だけ拒否する", () => {
  const now = new Date("2026-08-12T03:34:45.000Z"); // JST 2026-08-12 12:34
  assert.equal(isFutureRecordTime("2026-08-12", 12 * 60 + 35, now), true);
  assert.equal(isFutureRecordTime("2026-08-12", 12 * 60 + 34, now), false);
  assert.equal(isFutureRecordTime("2026-08-11", 23 * 60 + 59, now), false);
  assert.equal(isFutureRecordTime("2026-08-13", 0, now), true);
  assert.equal(isFutureRecordTime("2026-08-12", null, now), false);
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
  assert.equal(normalizeTagStorageValue("　ＡｂＣ１２３　"), "AbC123");
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
  assert.equal(DEFAULT_PET_RECORD_SCOPE, "household");
  assert.equal(normalizePetRecordScope("pet"), "pet");
  assert.equal(normalizePetRecordScope("household"), "household");
  assert.equal(normalizePetRecordScope("invalid"), "household");
  assert.equal(normalizePetRecordScope(undefined), "household");
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

test("Pet Records scopeはURL指定、保存設定、household fallbackの順で解決する", () => {
  assert.equal(resolvePetRecordScope({ hasScopeParam: false, defaultScope: "household" }), "household");
  assert.equal(resolvePetRecordScope({ hasScopeParam: false, defaultScope: "pet" }), "pet");
  assert.equal(
    resolvePetRecordScope({ hasScopeParam: true, scopeParam: "pet", defaultScope: "household" }),
    "pet"
  );
  assert.equal(
    resolvePetRecordScope({ hasScopeParam: true, scopeParam: "household", defaultScope: "pet" }),
    "household"
  );
  assert.equal(resolvePetRecordScope({ hasScopeParam: false }), "household");
  assert.equal(resolvePetRecordScope({ hasScopeParam: false, defaultScope: "invalid" }), "household");
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

test("Pet Memory画像はPet専用root・Household・UUID WebPへ保存する", async () => {
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
  assert.match(imageUtility, /process\.env\.PET_RECORD_IMAGE_DIR \|\| "\.\/uploads\/pet-records"/);
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

  const wide = await preparePetRecordImage(await pngFileForDimensions(2400, 1200));
  const wideMetadata = await sharp(wide.buffer).metadata();
  assert.equal(wideMetadata.width, PET_RECORD_IMAGE_MAX_DIMENSION);
  assert.equal(wideMetadata.height, PET_RECORD_IMAGE_MAX_DIMENSION / 2);

  const small = await preparePetRecordImage(await pngFileForDimensions(320, 180));
  const smallMetadata = await sharp(small.buffer).metadata();
  assert.equal(smallMetadata.width, 320);
  assert.equal(smallMetadata.height, 180);
});

async function pngFileForDimensions(width: number, height: number) {
  const buffer = await sharp({ create: { width, height, channels: 3, background: "orange" } }).png().toBuffer();
  return new File([buffer], "dimensions.png", { type: "image/png" });
}

test("Pet Recordsは5種類の共通baseと種類別detailを持つ", () => {
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
  assert.doesNotMatch(migration, /ALTER TABLE "(?:pets|users)"/i);
});

test("Pet Records queryはPet候補・Household境界・scope・filter・安定順・20件ページングをDBへ適用する", () => {
  const query = source("src/lib/pet-record-queries.ts");
  assert.match(query, /where: \{ householdId: context\.household\.id \}/);
  assert.match(query, /filters\.includeInactive \? allPets : allPets\.filter\(\(pet\) => pet\.isActive\)/);
  assert.match(query, /select: \{ recordTimelineDefaultScope: true \}/);
  assert.match(query, /resolvePetRecordScope\(\{[\s\S]*hasScopeParam: filters\.hasScopeParam[\s\S]*defaultScope: setting\?\.recordTimelineDefaultScope/);
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
  assert.match(remove, /return \{ success: true \}/);
  assert.doesNotMatch(remove, /petRecordReturnUrl\(parsed\.data\.petId, "petRecordDeleted", formData\)/);
  assert.doesNotMatch(remove, /formData\.get\("recordType"\)/);
});

test("Pet Record削除成功はClient側で通知・再取得し、スクロールを保ったまま末尾ページだけ補正する", () => {
  const timeline = source("src/components/pet-record-timeline.tsx");

  assert.match(timeline, /const result = await deletePetRecord\(formData\)/);
  assert.match(timeline, /setDeletedRecordIds\(\(current\) => \[\.\.\.current, recordId\]\)/);
  assert.match(timeline, /AutoDismissSuccessMessage[^>]*message="記録を削除しました。"/);
  assert.match(timeline, /router\.refresh\(\)/);
  assert.match(timeline, /router\.replace\([\s\S]*\{ scroll: false \}/);
  assert.match(timeline, /deleteSuccess\.page === returnFilters\.page/);
  for (const field of ["scope", "petId", "includeInactive", "type", "from", "to", "keyword", "favoriteOnly", "page"]) {
    assert.match(timeline, new RegExp(field));
  }
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
  assert.match(forms, /<RecordImageField \/>/);
  assert.doesNotMatch(forms, /name="recordType"/);
});

test("Pet Record timelineは主情報から本文・操作へ進む単一DOMの情報階層を持つ", () => {
  const timeline = source("src/components/pet-record-timeline.tsx");

  assert.match(
    timeline,
    /PET_RECORD_TYPE_LABELS\[record\.recordType\][\s\S]*record\.title[\s\S]*record\.recordDate[\s\S]*relatedPets\.map[\s\S]*record\.memoryDetail\?\.isFavorite[\s\S]*record\.memo[\s\S]*<details[\s\S]*<form onSubmit=/
  );
  assert.equal(timeline.match(/<form onSubmit=\{\(event\) => handleDelete\(event, record\.id\)\}/g)?.length, 1);
  assert.equal(timeline.match(/relatedPets\.map/g)?.length, 1);
});

test("Pet Recordsの作成selectorは全幅で5列を維持し、短い表示ラベルとsemantic colorを使う", () => {
  const forms = source("src/components/pet-record-create-forms.tsx");
  const timeline = source("src/components/pet-record-timeline.tsx");
  const styles = source("src/lib/pet-record-style.ts");
  const selectorStart = forms.indexOf('aria-label="登録する記録種類"');
  const selector = forms.slice(forms.lastIndexOf("<div", selectorStart), forms.indexOf('<div className={kind === "health"'));

  assert.match(selector, /grid grid-cols-5/);
  assert.doesNotMatch(selector, /sm:flex|sm:flex-wrap|grid-cols-2/);
  assert.match(selector, /min-h-12[\s\S]*whitespace-nowrap/);
  assert.match(selector, /md:flex-row/);
  assert.match(selector, /aria-pressed=\{kind === option\.value\}/);
  for (const [label, actionLabel] of [
    ["体調", "体調を記録"], ["通院", "通院を記録"], ["投薬", "投薬を記録"],
    ["ワクチン", "ワクチンを記録"], ["思い出", "思い出を追加"]
  ]) {
    assert.match(forms, new RegExp(`label: "${label}", actionLabel: "${actionLabel}"`));
  }
  for (const token of ["health", "medical", "medication", "vaccination", "memory"]) {
    assert.match(styles, new RegExp(`record-${token}`));
  }
  assert.match(timeline, /petRecordTypeStyles\[record\.recordType\]/);
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

test("共通タイムラインの記録種類フィルターは1行の横スクロールnavigationにする", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const timelineSection = page.slice(page.indexOf('<section className="grid gap-4">'));

  const globals = source("src/app/globals.css");
  const scroller = source("src/components/record-type-filter-scroller.tsx");

  assert.match(timelineSection, /<div className="grid gap-3">[\s\S]*?<h2[\s\S]*?<nav className="min-w-0 max-w-full" aria-label="記録種類の切り替え">[\s\S]*?<RecordTypeFilterScroller>/);
  assert.doesNotMatch(timelineSection, /flex-wrap|sm:flex-row|sm:items-end|sm:justify-between/);
  assert.match(timelineSection, /typeTabs\.map\(\(tab\) => <Link/);
  assert.match(timelineSection, /scroll=\{false\}/);
  assert.match(timelineSection, /aria-current=\{filters\.type === tab\.value \? "page" : undefined\}/);
  assert.match(timelineSection, /favoriteOnly: \(tab\.value === "all" \|\| tab\.value === "memory"\) && currentFilters\.favoriteOnly, page: 1/);
  assert.match(globals, /\.record-filter-scroll \{[\s\S]*?scrollbar-width: none;/);
  assert.match(globals, /\.record-filter-scroll::\-webkit-scrollbar \{[\s\S]*?display: none;/);
  assert.doesNotMatch(globals, /record-filter-scroll::\-webkit-scrollbar-(?:track|thumb)|scrollbar-color: rgba\(62, 111, 142/);
  assert.match(scroller, /"use client";/);
  assert.match(scroller, /<div className="min-w-0 max-w-full">[\s\S]*?record-filter-scroll min-w-0 max-w-full overflow-x-auto overscroll-x-contain/);
  assert.match(scroller, /ResizeObserver\(updateIndicator\)[\s\S]*?observe\(scrollContainer\)[\s\S]*?observe\(content\)/);
  assert.match(scroller, /scrollWidth <= clientWidth \+ 1/);
  assert.match(scroller, /clientWidth \* \(clientWidth \/ scrollWidth\)/);
  assert.match(scroller, /scrollLeft \/ maxScroll\) \* thumbTravel/);
  assert.match(scroller, /aria-hidden="true"/);
  assert.match(scroller, /removeEventListener\("scroll", updateIndicator\)/);
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
  assert.match(page, /const hasScopeParam = params\.scope !== undefined/);
  assert.match(query, /resolvePetRecordScope\(/);
  assert.match(page, /タイムラインの表示範囲/);
  assert.match(page, /scope: "pet", label: "選択中のPet"/);
  assert.match(page, /scope: "household", label: "共有グループ全体"/);
  assert.match(page, /aria-current=\{scope === option\.scope \? "page" : undefined\}/);
  assert.match(page, /petRecordsUrl\(\{ \.\.\.currentFilters, scope: option\.scope, page: 1 \}\)/);
  assert.match(page, /<input type="hidden" name="scope" value=\{scope\} \/>/);
  assert.match(page, /<select name="petId"[\s\S]*pet\.name\}（\{speciesLabel\[pet\.species\]\}）/);
  assert.match(page, /<PetThumbnail petId=\{data\.selectedPet\.id\}/);
  assert.match(page, /import \{ PetSpeciesBadge \} from "@\/components\/pet-species-badge";/);
  assert.match(page, /<PetSpeciesBadge species=\{data\.selectedPet\.species\} \/>/);
  assert.match(page, /管理終了したPetも含む/);
  for (const tab of ["すべて", "健康・体調", "通院", "投薬", "ワクチン", "思い出"]) {
    assert.match(page, new RegExp(`label: "${tab}"`));
  }
  assert.match(page, /<PetRecordTimeline[\s\S]*records=\{data\.records\}[\s\S]*pets=\{data\.pets\}[\s\S]*scope=\{scope\}[\s\S]*returnPetId=\{selectedPetId\}/);
});

test("VIEWERと管理終了Petはフォームを描画せず、Pet timelineを閲覧専用にする", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const timeline = source("src/components/pet-record-timeline.tsx");
  assert.match(page, /const canEdit = canEditHouseholdSharedData\(data\.context\.membership\.role\)/);
  assert.match(page, /!canEdit[\s\S]*閲覧者は記録の検索・閲覧のみ利用できます。/);
  assert.match(page, /!data\.selectedPet\.isActive[\s\S]*このPetは管理終了済みのため、記録の閲覧のみ可能です。/);
  assert.match(page, /<PetRecordTimeline[\s\S]*canEdit=\{canEdit\}/);
  assert.match(timeline, /const editable = canEdit && record\.pet\.isActive && relatedPets\.every\(\(pet\) => pet\.isActive\)/);
  assert.match(timeline, /\{editable \? <form onSubmit=\{\(event\) => handleDelete\(event, record\.id\)\}/);
  assert.match(timeline, /\{editable \? <details/);
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

test("思い出フォームはPet用の保存済みタグを再利用・削除できる", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const forms = source("src/components/pet-record-create-forms.tsx");
  const tagInput = source("src/components/memory-tag-input.tsx");
  assert.match(page, /savedMemoryTags=\{data\.savedMemoryTags\}/);
  assert.match(forms, /<MemoryTagInput savedTags=\{savedMemoryTags\} \/>/);
  assert.match(tagInput, /deletePetSavedMemoryTags/);
  assert.match(tagInput, /PET_MEMORY_TAG_SUGGESTIONS/);
  assert.match(tagInput, /name="saveTags"/);
  assert.match(tagInput, /入力したタグを保存して再利用する/);
  assert.doesNotMatch(tagInput, /recordDomain/);
});
