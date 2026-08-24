import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { getCareDayDateInputJst, getCareDayRecordDate } from "../src/lib/care-day";
import { parseDateInput, todayInputJst } from "../src/lib/date";
import { savePetImage } from "../src/lib/pet-image";
import { savePetRecordImage } from "../src/lib/pet-record-image";
import {
  assertCurrentDatabaseName,
  assertSpeciesCareRules,
  assertUiFixtureDatabaseUrl,
  assertUniqueWeightDates,
  selectTargetUser,
  UI_FIXTURE_ADMIN_HOUSEHOLD_IDS,
  UI_FIXTURE_ADMIN_USER_IDS,
  UI_FIXTURE_CONTACT_PUBLIC_IDS,
  UI_FIXTURE_HOUSEHOLD_ID,
  UI_FIXTURE_HOUSEHOLD_NAME,
  UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES,
  UI_FIXTURE_MEMBER_USER_IDS,
  UI_FIXTURE_PET_IMAGE_FILE_NAMES
} from "./ui-fixture-logic";

const CARE_DAY_START_MINUTES = 240;
const ADMIN_HOUSEHOLD_COUNT = UI_FIXTURE_ADMIN_HOUSEHOLD_IDS.length;
const ADMIN_USER_COUNT = UI_FIXTURE_ADMIN_USER_IDS.length;
const LONG_MEMO =
  "朝はいつも通り元気に過ごし、窓辺で日向ぼっこをしたあと家族とゆっくり遊びました。夕方にはお気に入りのおもちゃを持ってきて、何度も遊びに誘う様子が見られました。カードの折り返し、余白、一覧での高さを確認するための少し長めのUI確認用メモです。";

const args = new Set(process.argv.slice(2));
const cleanupMode = args.has("--cleanup");
const applyMode = args.has("--apply");
if (cleanupMode && applyMode) throw new Error("--cleanupと--applyは同時に指定できません。");

function parseEnvFile(filePath: string) {
  if (!existsSync(filePath)) return {} as Record<string, string>;
  const values: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

function dockerPublishedDatabasePort() {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const match = /127\.0\.0\.1:(\d+):5432/.exec(compose);
  if (!match) throw new Error("docker-compose.ymlからdevelopment DBの公開ポートを確認できません。");
  return match[1];
}

/** 明示overrideを最優先し、ホスト実行時だけcomposeの公開ポートへ安全に変換する。 */
function resolveDatabaseUrl(developmentEnv: Record<string, string>, defaultEnv: Record<string, string>) {
  const raw =
    process.env.UI_FIXTURE_DATABASE_URL ||
    developmentEnv.DATABASE_URL ||
    process.env.DATABASE_URL ||
    defaultEnv.DATABASE_URL;
  if (!raw) throw new Error("UI fixture用DATABASE_URLがありません。");

  const parsed = new URL(raw);
  if (!existsSync("/.dockerenv") && parsed.hostname === "db" && parsed.port === "5432") {
    parsed.hostname = "127.0.0.1";
    parsed.port = dockerPublishedDatabasePort();
  }
  const resolved = parsed.toString();
  assertUiFixtureDatabaseUrl(resolved);
  return resolved;
}

function resolveImageRoot(
  override: string | undefined,
  configured: string | undefined,
  relativeRoot: "uploads/pets" | "uploads/pet-records"
) {
  if (override) return path.resolve(override);
  if (existsSync("/.dockerenv")) return path.resolve(configured || `/${relativeRoot}`);
  // development envの/app/uploadsはcomposeでリポジトリの./uploadsへmountされる。
  if (!configured || configured.startsWith("/app/uploads/")) return path.resolve(relativeRoot);
  return path.resolve(configured);
}

const developmentEnv = parseEnvFile(".env.development");
const defaultEnv = parseEnvFile(".env");
const databaseUrl = resolveDatabaseUrl(developmentEnv, defaultEnv);
const databaseName = assertUiFixtureDatabaseUrl(databaseUrl);
const petImageRoot = resolveImageRoot(
  process.env.UI_FIXTURE_PET_IMAGE_DIR,
  developmentEnv.PET_IMAGE_DIR || process.env.PET_IMAGE_DIR,
  "uploads/pets"
);
const petRecordImageRoot = resolveImageRoot(
  process.env.UI_FIXTURE_PET_RECORD_IMAGE_DIR,
  developmentEnv.PET_RECORD_IMAGE_DIR || process.env.PET_RECORD_IMAGE_DIR,
  "uploads/pet-records"
);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function dateOffset(dateInput: string, days: number) {
  const date = parseDateInput(dateInput);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function jstTimestamp(dateInput: string, hour: number, minute: number) {
  const [year, month, day] = dateInput.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
}

function currentCareTimestamp(now: Date, careDate: string, ordinal: number, total = 12) {
  const start = jstTimestamp(careDate, 4, 0).getTime();
  const available = Math.max(now.getTime() - start, 1_000);
  return new Date(start + Math.floor((available * ordinal) / (total + 1)));
}

function createdAgo(now: Date, hours: number) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function petId(suffix: string) {
  return `UI_FIXTURE_PET_${suffix}`;
}

function fixtureSummary() {
  return {
    households: 1,
    pets: 8,
    weights: 37,
    feeding: 10,
    water: 9,
    walk: 8,
    litter: 8,
    records: 35,
    health: 8,
    medical: 6,
    medication: 6,
    vaccination: 5,
    memory: 10,
    savedMemoryTags: 10,
    members: 5,
    invitations: 4,
    activities: 26,
    contacts: 22,
    adminUsers: ADMIN_USER_COUNT,
    adminHouseholds: ADMIN_HOUSEHOLD_COUNT,
    adminInvitations: ADMIN_HOUSEHOLD_COUNT,
    petImages: UI_FIXTURE_PET_IMAGE_FILE_NAMES.length,
    memoryImages: UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES.length
  };
}

async function assertConnectedDevelopmentDatabase() {
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  const actual = rows[0]?.current_database || "不明";
  assertCurrentDatabaseName(actual);
  return actual;
}

async function findTargetUser() {
  const candidates = await prisma.user.findMany({
    where: {
      accounts: { some: {} },
      id: { notIn: [...UI_FIXTURE_MEMBER_USER_IDS, ...UI_FIXTURE_ADMIN_USER_IDS] }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, email: true, appRole: true, accessStatus: true }
  });
  return selectTargetUser(candidates, process.env.UI_FIXTURE_TARGET_USER_ID);
}

function printPreview(target: Awaited<ReturnType<typeof findTargetUser>>) {
  const summary = fixtureSummary();
  console.log(`UI fixture preview（${applyMode ? "確認後に投入" : "書き込みなし"}）`);
  console.log(`対象DB: ${databaseName}`);
  console.log(`対象User: ${target.name?.trim() || "名前未設定"} (${target.appRole}/${target.accessStatus})`);
  console.log(`作成Household: ${UI_FIXTURE_HOUSEHOLD_NAME}`);
  console.log(`Pet: ${summary.pets}, Weight: ${summary.weights}`);
  console.log(
    `Care: Feeding ${summary.feeding}, Water ${summary.water}, Walk ${summary.walk}, Litter ${summary.litter}`
  );
  console.log(
    `Pet Records: ${summary.records} (Health ${summary.health}, Medical ${summary.medical}, Medication ${summary.medication}, Vaccination ${summary.vaccination}, Memory ${summary.memory})`
  );
  console.log(
    `Member: ${summary.members}, Invitation: ${summary.invitations}, Activity: ${summary.activities}, Contact: ${summary.contacts}`
  );
  console.log(
    `Admin fixture: User ${summary.adminUsers}, Household ${summary.adminHouseholds}, Invitation ${summary.adminInvitations}`
  );
  console.log(`画像: Pet ${summary.petImages}, Memory ${summary.memoryImages}`);
  if (!applyMode) console.log("投入する場合: npm run seed:ui -- --apply");
}

async function generateFixtureImage(label: string, background: string, width: number, height: number) {
  const safeLabel = label.replace(/[<>&]/g, "");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/><circle cx="${width / 2}" cy="${height * 0.38}" r="${Math.min(width, height) * 0.17}" fill="#ffffff" fill-opacity="0.28"/><text x="50%" y="68%" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(width, height) * 0.105)}" font-weight="700">${safeLabel}</text><text x="50%" y="80%" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(width, height) * 0.045)}">UI FIXTURE</text></svg>`
  );
  return sharp(svg).webp({ quality: 82 }).toBuffer();
}

async function writeFixtureImages() {
  const profileLabels = ["DOG KOTARO", "DOG LEO", "CAT MIKE", "CAT MOMO"];
  const profileColors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b"];
  for (let index = 0; index < UI_FIXTURE_PET_IMAGE_FILE_NAMES.length; index += 1) {
    await savePetImage(
      UI_FIXTURE_HOUSEHOLD_ID,
      {
        fileName: UI_FIXTURE_PET_IMAGE_FILE_NAMES[index],
        buffer: await generateFixtureImage(profileLabels[index], profileColors[index], 720, 720)
      },
      petImageRoot
    );
  }

  const memoryColors = ["#0f766e", "#0369a1", "#be123c", "#6d28d9"];
  for (let index = 0; index < UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES.length; index += 1) {
    await savePetRecordImage(
      UI_FIXTURE_HOUSEHOLD_ID,
      {
        fileName: UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES[index],
        buffer: await generateFixtureImage(`MEMORY ${index + 1}`, memoryColors[index], 1280, 900)
      },
      petRecordImageRoot
    );
  }
}

async function removeFixtureImages() {
  for (const fileName of UI_FIXTURE_PET_IMAGE_FILE_NAMES) {
    await rm(path.join(petImageRoot, UI_FIXTURE_HOUSEHOLD_ID, fileName), { force: true });
  }
  for (const fileName of UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES) {
    await rm(path.join(petRecordImageRoot, UI_FIXTURE_HOUSEHOLD_ID, fileName), { force: true });
  }
  await rmdir(path.join(petImageRoot, UI_FIXTURE_HOUSEHOLD_ID)).catch(() => undefined);
  await rmdir(path.join(petRecordImageRoot, UI_FIXTURE_HOUSEHOLD_ID)).catch(() => undefined);
}

async function deleteFixtureRows(tx: Prisma.TransactionClient) {
  const fixtureUserIds = [...UI_FIXTURE_MEMBER_USER_IDS, ...UI_FIXTURE_ADMIN_USER_IDS];
  const fixtureHouseholdIds = [UI_FIXTURE_HOUSEHOLD_ID, ...UI_FIXTURE_ADMIN_HOUSEHOLD_IDS];
  await tx.contactInquiry.deleteMany({ where: { publicId: { in: UI_FIXTURE_CONTACT_PUBLIC_IDS } } });
  await tx.userAccessAction.deleteMany({
    where: { OR: [{ actorUserId: { in: fixtureUserIds } }, { targetUserId: { in: fixtureUserIds } }] }
  });
  await tx.household.deleteMany({ where: { id: { in: fixtureHouseholdIds } } });
  await tx.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
}

async function cleanupFixtures() {
  await prisma.$transaction((tx) => deleteFixtureRows(tx), { timeout: 60_000 });
  await removeFixtureImages();
  console.log(`UI fixtureを削除しました: ${UI_FIXTURE_HOUSEHOLD_NAME}`);
}

async function createFixtures(target: Awaited<ReturnType<typeof findTargetUser>>, now: Date) {
  const today = todayInputJst(now);
  const careDate = getCareDayDateInputJst(now, CARE_DAY_START_MINUTES);
  const yesterdayCareDate = dateOffset(careDate, -1);
  const olderCareDate = dateOffset(careDate, -4);
  const profileByPet = new Map([
    [petId("KOTARO"), UI_FIXTURE_PET_IMAGE_FILE_NAMES[0]],
    [petId("LEO_LONG"), UI_FIXTURE_PET_IMAGE_FILE_NAMES[1]],
    [petId("MIKE"), UI_FIXTURE_PET_IMAGE_FILE_NAMES[2]],
    [petId("MOMO"), UI_FIXTURE_PET_IMAGE_FILE_NAMES[3]]
  ]);

  const pets: Prisma.PetCreateManyInput[] = [
    { id: petId("KOTARO"), householdId: UI_FIXTURE_HOUSEHOLD_ID, name: "コタロウ", species: "DOG", customBreedName: "柴犬", sex: "MALE", birthDate: parseDateInput(dateOffset(today, -365 * 5)), adoptionDate: parseDateInput(dateOffset(today, -365 * 4)), memo: "散歩とボール遊びが大好きです。", profileImageFileName: profileByPet.get(petId("KOTARO")), createdAt: createdAgo(now, 24 * 70) },
    { id: petId("HANA"), householdId: UI_FIXTURE_HOUSEHOLD_ID, name: "ハナ", species: "DOG", customBreedName: null, sex: "FEMALE", birthDate: parseDateInput(dateOffset(today, -365 * 3)), adoptionDate: null, memo: null, profileImageFileName: null, createdAt: createdAgo(now, 24 * 60) },
    { id: petId("LEO_LONG"), householdId: UI_FIXTURE_HOUSEHOLD_ID, name: "レオナルド・わんぱく・ジュニア", species: "DOG", customBreedName: "グレート・ピレニーズとゴールデン・レトリーバーのミックス", sex: "UNKNOWN", birthDate: null, adoptionDate: parseDateInput(dateOffset(today, -800)), memo: LONG_MEMO, profileImageFileName: profileByPet.get(petId("LEO_LONG")), createdAt: createdAgo(now, 24 * 50) },
    { id: petId("CHAKO_INACTIVE"), householdId: UI_FIXTURE_HOUSEHOLD_ID, name: "チャコ", species: "DOG", customBreedName: "ミニチュア・ダックスフンド", sex: "FEMALE", birthDate: parseDateInput(dateOffset(today, -365 * 12)), adoptionDate: null, memo: "過去の記録確認用に管理終了状態を維持しています。", isActive: false, profileImageFileName: null, createdAt: createdAgo(now, 24 * 40) },
    { id: petId("MIKE"), householdId: UI_FIXTURE_HOUSEHOLD_ID, name: "ミケ", species: "CAT", customBreedName: "三毛猫", sex: "FEMALE", birthDate: parseDateInput(dateOffset(today, -365 * 4)), adoptionDate: parseDateInput(dateOffset(today, -365 * 3)), memo: "窓辺がお気に入りです。", profileImageFileName: profileByPet.get(petId("MIKE")), createdAt: createdAgo(now, 24 * 30) },
    { id: petId("SORA"), householdId: UI_FIXTURE_HOUSEHOLD_ID, name: "ソラ", species: "CAT", customBreedName: null, sex: "MALE", birthDate: null, adoptionDate: null, memo: null, profileImageFileName: null, createdAt: createdAgo(now, 24 * 20) },
    { id: petId("MOMO"), householdId: UI_FIXTURE_HOUSEHOLD_ID, name: "モモ", species: "CAT", customBreedName: "ブリティッシュショートヘア", sex: "UNKNOWN", birthDate: parseDateInput(dateOffset(today, -540)), adoptionDate: parseDateInput(dateOffset(today, -500)), memo: "ごはんの時間になると小さな声で知らせます。", profileImageFileName: profileByPet.get(petId("MOMO")), createdAt: createdAgo(now, 24 * 10) },
    { id: petId("LUNA_INACTIVE"), householdId: UI_FIXTURE_HOUSEHOLD_ID, name: "ルナ", species: "CAT", customBreedName: "ラグドール", sex: "UNKNOWN", birthDate: null, adoptionDate: parseDateInput(dateOffset(today, -1500)), memo: "管理終了・empty state確認用です。", isActive: false, profileImageFileName: null, createdAt: createdAgo(now, 24 * 5) }
  ];

  const weights: Prisma.PetWeightRecordCreateManyInput[] = [];
  for (let index = 0; index < 26; index += 1) {
    weights.push({ id: `UI_FIXTURE_WEIGHT_DOG_${String(index + 1).padStart(2, "0")}`, petId: petId("KOTARO"), recordDate: parseDateInput(dateOffset(today, -index * 2)), weightKg: new Prisma.Decimal((11.8 + Math.sin(index / 3) * 0.35 + index * 0.015).toFixed(2)), memo: index % 6 === 0 ? "朝ごはん前に測定" : null, createdAt: createdAgo(now, index * 18) });
  }
  for (let index = 0; index < 10; index += 1) {
    weights.push({ id: `UI_FIXTURE_WEIGHT_CAT_${String(index + 1).padStart(2, "0")}`, petId: petId("MIKE"), recordDate: parseDateInput(dateOffset(today, -index * 7)), weightKg: new Prisma.Decimal((4.15 + Math.cos(index / 2) * 0.12).toFixed(2)), memo: index === 3 ? "動物病院の診察台で測定しました。" : null, createdAt: createdAgo(now, index * 30) });
  }
  weights.push({ id: "UI_FIXTURE_WEIGHT_LATEST_ONLY", petId: petId("HANA"), recordDate: parseDateInput(today), weightKg: new Prisma.Decimal("7.45"), memo: "最新の1件だけを表示確認するための記録", createdAt: createdAgo(now, 2) });
  assertUniqueWeightDates(weights);

  const feeding: Prisma.PetFeedingRecordCreateManyInput[] = [
    ["01", "KOTARO", currentCareTimestamp(now, careDate, 2), "朝ごはんはいつも通り完食しました"],
    ["02", "KOTARO", currentCareTimestamp(now, careDate, 8), null],
    ["03", "HANA", currentCareTimestamp(now, careDate, 4), "少しゆっくりでしたが完食しました。食器の周りを何度か確認しながら食べていたため、次回も様子を見ます。"],
    ["04", "MIKE", currentCareTimestamp(now, careDate, 3), null],
    ["05", "MIKE", currentCareTimestamp(now, careDate, 9), "ウェットフードを半分"],
    ["06", "MOMO", currentCareTimestamp(now, careDate, 6), "少量を3回に分けました"],
    ["07", "KOTARO", jstTimestamp(yesterdayCareDate, 8, 5), null],
    ["08", "SORA", jstTimestamp(yesterdayCareDate, 19, 10), "夕食"],
    ["09", "LEO_LONG", jstTimestamp(olderCareDate, 7, 50), LONG_MEMO.slice(0, 240)],
    ["10", "MOMO", jstTimestamp(olderCareDate, 18, 20), null]
  ].map(([suffix, pet, fedAt, memo]) => ({ id: `UI_FIXTURE_FEEDING_${suffix}`, petId: petId(String(pet)), recordDate: getCareDayRecordDate(fedAt as Date, CARE_DAY_START_MINUTES), fedAt: fedAt as Date, memo: memo as string | null, createdByUserId: target.id }));

  const water: Prisma.PetWaterRecordCreateManyInput[] = [
    ["01", "KOTARO", currentCareTimestamp(now, careDate, 1), "REPLACED", null],
    ["02", "KOTARO", currentCareTimestamp(now, careDate, 7), "REFILLED", "散歩のあとに補充"],
    ["03", "HANA", currentCareTimestamp(now, careDate, 5), "REPLACED", null],
    ["04", "MIKE", currentCareTimestamp(now, careDate, 2), "REFILLED", "器の半分ほど補充しました"],
    ["05", "MOMO", currentCareTimestamp(now, careDate, 10), "REPLACED", LONG_MEMO.slice(0, 220)],
    ["06", "KOTARO", jstTimestamp(yesterdayCareDate, 9, 0), "REPLACED", null],
    ["07", "SORA", jstTimestamp(yesterdayCareDate, 16, 30), "REFILLED", null],
    ["08", "LEO_LONG", jstTimestamp(olderCareDate, 12, 0), "REPLACED", "大きい器を洗浄"],
    ["09", "MIKE", jstTimestamp(olderCareDate, 21, 0), "REFILLED", null]
  ].map(([suffix, pet, caredAt, action, memo]) => ({ id: `UI_FIXTURE_WATER_${suffix}`, petId: petId(String(pet)), recordDate: getCareDayRecordDate(caredAt as Date, CARE_DAY_START_MINUTES), caredAt: caredAt as Date, action: action as "REPLACED" | "REFILLED", memo: memo as string | null, createdByUserId: target.id }));

  const walkFixtures = [
    ["01", "KOTARO", currentCareTimestamp(now, careDate, 3), 15, "近所を短く一周", "DOG"],
    ["02", "KOTARO", currentCareTimestamp(now, careDate, 9), 30, "夕方の散歩で公園まで歩きました", "DOG"],
    ["03", "HANA", currentCareTimestamp(now, careDate, 6), null, null, "DOG"],
    ["04", "LEO_LONG", currentCareTimestamp(now, careDate, 8), 60, LONG_MEMO.slice(0, 230), "DOG"],
    ["05", "KOTARO", jstTimestamp(yesterdayCareDate, 7, 10), 30, null, "DOG"],
    ["06", "HANA", jstTimestamp(yesterdayCareDate, 18, 15), 15, "川沿いの道", "DOG"],
    ["07", "LEO_LONG", jstTimestamp(olderCareDate, 10, 0), 60, null, "DOG"],
    ["08", "CHAKO_INACTIVE", jstTimestamp(olderCareDate, 15, 30), null, "過去の散歩記録", "DOG"]
  ].map(([suffix, pet, startedAt, durationMinutes, memo, species]) => ({ species: species as "DOG", id: `UI_FIXTURE_WALK_${suffix}`, petId: petId(String(pet)), recordDate: getCareDayRecordDate(startedAt as Date, CARE_DAY_START_MINUTES), startedAt: startedAt as Date, durationMinutes: durationMinutes as number | null, memo: memo as string | null, createdByUserId: target.id }));

  const litterFixtures = [
    ["01", "MIKE", currentCareTimestamp(now, careDate, 1), "URINATION", null, "CAT"],
    ["02", "MIKE", currentCareTimestamp(now, careDate, 5), "DEFECATION", "いつも通り", "CAT"],
    ["03", "SORA", currentCareTimestamp(now, careDate, 7), "BOTH", null, "CAT"],
    ["04", "MOMO", currentCareTimestamp(now, careDate, 10), "CLEANED", "砂を全量交換しました", "CAT"],
    ["05", "MIKE", jstTimestamp(yesterdayCareDate, 6, 40), "CLEANED", null, "CAT"],
    ["06", "SORA", jstTimestamp(yesterdayCareDate, 20, 30), "URINATION", null, "CAT"],
    ["07", "MOMO", jstTimestamp(olderCareDate, 9, 20), "DEFECATION", LONG_MEMO.slice(0, 210), "CAT"],
    ["08", "LUNA_INACTIVE", jstTimestamp(olderCareDate, 17, 0), "BOTH", "過去のトイレ記録", "CAT"]
  ].map(([suffix, pet, occurredAt, action, memo, species]) => ({ species: species as "CAT", id: `UI_FIXTURE_LITTER_${suffix}`, petId: petId(String(pet)), recordDate: getCareDayRecordDate(occurredAt as Date, CARE_DAY_START_MINUTES), occurredAt: occurredAt as Date, action: action as "URINATION" | "DEFECATION" | "BOTH" | "CLEANED", memo: memo as string | null, createdByUserId: target.id }));
  assertSpeciesCareRules(walkFixtures, litterFixtures);

  await prisma.$transaction(async (tx) => {
    await deleteFixtureRows(tx);

    const fixtureUsers: Prisma.UserCreateManyInput[] = [
      { id: UI_FIXTURE_MEMBER_USER_IDS[0], name: "佐藤 オーナー", email: "ui-owner@example.invalid", appRole: "USER" },
      { id: UI_FIXTURE_MEMBER_USER_IDS[1], name: "鈴木 管理者", email: "ui-admin@example.invalid", appRole: "USER" },
      { id: UI_FIXTURE_MEMBER_USER_IDS[2], name: "高橋 メンバー", email: "ui-member@example.invalid", appRole: "USER" },
      { id: UI_FIXTURE_MEMBER_USER_IDS[3], name: "田中 閲覧者（長めの表示名確認）", email: "ui-viewer@example.invalid", appRole: "USER" }
    ];
    for (let index = 0; index < ADMIN_USER_COUNT; index += 1) {
      const number = index + 1;
      const suspended = number % 5 === 0 && number !== ADMIN_USER_COUNT;
      fixtureUsers.push({
        id: UI_FIXTURE_ADMIN_USER_IDS[index],
        name: number % 6 === 0 ? null : number === 17 ? "管理画面で長い表示名がどのように折り返されるか確認するための利用者" : `管理一覧確認ユーザー ${String(number).padStart(2, "0")}`,
        email: `ui-admin-list-${String(number).padStart(2, "0")}@example.invalid`,
        appRole: number === ADMIN_USER_COUNT ? "SUPER_ADMIN" : number % 8 === 0 ? "ADMIN" : "USER",
        accessStatus: suspended ? "SUSPENDED" : "ACTIVE",
        suspendedAt: suspended ? createdAgo(now, number * 3) : null,
        suspendedByUserId: null,
        suspensionReason: suspended ? "UI確認用fixtureによる一時停止状態" : null,
        createdAt: createdAgo(now, number * 24)
      });
    }
    await tx.user.createMany({ data: fixtureUsers });

    await tx.household.create({
      data: { id: UI_FIXTURE_HOUSEHOLD_ID, name: UI_FIXTURE_HOUSEHOLD_NAME, careDayStartMinutes: CARE_DAY_START_MINUTES, createdAt: createdAgo(now, 24 * 90) }
    });
    await tx.householdMember.createMany({ data: [
      { id: "UI_FIXTURE_MAIN_MEMBER_REAL", householdId: UI_FIXTURE_HOUSEHOLD_ID, userId: target.id, role: "OWNER", createdAt: createdAgo(now, 24 * 90) },
      { id: "UI_FIXTURE_MAIN_MEMBER_OWNER", householdId: UI_FIXTURE_HOUSEHOLD_ID, userId: UI_FIXTURE_MEMBER_USER_IDS[0], role: "OWNER", createdAt: createdAgo(now, 24 * 80) },
      { id: "UI_FIXTURE_MAIN_MEMBER_ADMIN", householdId: UI_FIXTURE_HOUSEHOLD_ID, userId: UI_FIXTURE_MEMBER_USER_IDS[1], role: "ADMIN", createdAt: createdAgo(now, 24 * 70) },
      { id: "UI_FIXTURE_MAIN_MEMBER_MEMBER", householdId: UI_FIXTURE_HOUSEHOLD_ID, userId: UI_FIXTURE_MEMBER_USER_IDS[2], role: "MEMBER", createdAt: createdAgo(now, 24 * 60) },
      { id: "UI_FIXTURE_MAIN_MEMBER_VIEWER", householdId: UI_FIXTURE_HOUSEHOLD_ID, userId: UI_FIXTURE_MEMBER_USER_IDS[3], role: "VIEWER", createdAt: createdAgo(now, 24 * 50) }
    ] });
    await tx.pet.createMany({ data: pets });

    const setting = await tx.appSetting.create({ data: { id: "UI_FIXTURE_APP_SETTING", userId: target.id, householdId: UI_FIXTURE_HOUSEHOLD_ID, dashboardBoardCount: 6 } });
    const dashboardOrder = [petId("MIKE"), petId("KOTARO"), petId("LUNA_INACTIVE"), petId("HANA"), petId("LEO_LONG"), petId("SORA")];
    await tx.dashboardPet.createMany({ data: dashboardOrder.map((id, sortOrder) => ({ id: `UI_FIXTURE_DASHBOARD_${sortOrder + 1}`, settingId: setting.id, petId: id, sortOrder })) });

    await tx.petWeightRecord.createMany({ data: weights });
    await tx.petFeedingRecord.createMany({ data: feeding });
    await tx.petWaterRecord.createMany({ data: water });
    await tx.petWalkRecord.createMany({ data: walkFixtures.map((record) => ({
      id: record.id,
      petId: record.petId,
      recordDate: record.recordDate,
      startedAt: record.startedAt,
      durationMinutes: record.durationMinutes,
      memo: record.memo,
      createdByUserId: record.createdByUserId
    })) });
    await tx.petLitterRecord.createMany({ data: litterFixtures.map((record) => ({
      id: record.id,
      petId: record.petId,
      recordDate: record.recordDate,
      occurredAt: record.occurredAt,
      action: record.action,
      memo: record.memo,
      createdByUserId: record.createdByUserId
    })) });

    await createPetRecords(tx, target.id, now, today);
    await createHouseholdFixtures(tx, target, now, today, careDate);
    await createAdminFixtures(tx, now);
    await createContactFixtures(tx, target, now);
  }, { timeout: 60_000 });
}

async function createPetRecords(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  now: Date,
  today: string
) {
  const records: Prisma.PetRecordCreateManyInput[] = [];
  const healthDetails: Prisma.PetHealthRecordDetailCreateManyInput[] = [];
  const medicalDetails: Prisma.PetMedicalVisitDetailCreateManyInput[] = [];
  const medicationDetails: Prisma.PetMedicationRecordDetailCreateManyInput[] = [];
  const vaccinationDetails: Prisma.PetVaccinationRecordDetailCreateManyInput[] = [];
  const memoryDetails: Prisma.PetMemoryRecordDetailCreateManyInput[] = [];
  const memoryPets: Prisma.PetMemoryRecordPetCreateManyInput[] = [];
  const memoryImages: Prisma.PetMemoryRecordImageCreateManyInput[] = [];

  const addRecord = (input: Omit<Prisma.PetRecordCreateManyInput, "createdByUserId">) => {
    records.push({ ...input, createdByUserId: targetUserId });
  };

  const overall = ["GOOD", "CONCERN", "WARNING"] as const;
  const amounts = ["NORMAL", "LOW", "NONE", "UNKNOWN"] as const;
  const excretions = ["NORMAL", "LOW", "ABNORMAL", "UNKNOWN"] as const;
  const symptomSets = [
    [],
    ["SNEEZING"],
    ["LOSS_OF_APPETITE", "DIARRHEA"],
    ["EYE_DISCHARGE", "RUNNY_NOSE", "OTHER"]
  ] as const;
  for (let index = 0; index < 8; index += 1) {
    const id = `UI_FIXTURE_RECORD_HEALTH_${String(index + 1).padStart(2, "0")}`;
    const memo = index === 2 ? "朝から食欲が少なく、いつもより静かに過ごしていました。水は飲めていますが、念のため夕方まで変化がないか観察します。" : index % 3 === 0 ? null : "朝の健康チェックを行いました。";
    addRecord({
      id,
      petId: index < 6 ? petId("KOTARO") : petId("MIKE"),
      recordType: "HEALTH",
      recordDate: parseDateInput(dateOffset(today, -index * 2)),
      recordTimeMinutes: index % 2 === 0 ? 7 * 60 + index * 5 : null,
      title: index === 2 ? "食欲と元気が少し気になる朝" : `健康チェック ${index + 1}`,
      memo,
      searchText: `健康チェック ${memo || ""}`,
      createdAt: createdAgo(now, index * 18 + 1)
    });
    healthDetails.push({
      petRecordId: id,
      overallCondition: overall[index % overall.length],
      appetite: amounts[index % amounts.length],
      activityLevel: amounts[(index + 1) % amounts.length],
      stoolCondition: excretions[index % excretions.length],
      urineCondition: excretions[(index + 2) % excretions.length],
      symptoms: [...symptomSets[index % symptomSets.length]]
    });
  }

  for (let index = 0; index < 6; index += 1) {
    const id = `UI_FIXTURE_RECORD_MEDICAL_${String(index + 1).padStart(2, "0")}`;
    const longVisit = index === 1;
    const reason = longVisit
      ? "右耳を気にする様子が数日続き、首を振る回数も増えたため受診しました。待合室では落ち着いて過ごし、診察時には耳の内側を丁寧に確認してもらいました。"
      : index % 2 === 0
        ? "定期健診のため受診"
        : "皮膚をかゆがる様子があったため受診";
    addRecord({
      id,
      petId: index < 5 ? petId("KOTARO") : petId("HANA"),
      recordType: "MEDICAL",
      recordDate: parseDateInput(dateOffset(today, -(index * 9 + 3))),
      recordTimeMinutes: index % 2 === 0 ? 10 * 60 + 30 : null,
      title: longVisit ? "右耳の違和感について詳しく診察" : `通院記録 ${index + 1}`,
      memo: index === 4 ? null : "帰宅後は静かに休みました。",
      searchText: `通院 ${reason}`,
      createdAt: createdAgo(now, index * 30 + 4)
    });
    medicalDetails.push({
      petRecordId: id,
      hospitalName: index % 3 === 0 ? null : index === 1 ? "みどり丘どうぶつ医療センター" : "さくら動物病院",
      reason,
      diagnosis: index % 3 === 0 ? null : index === 1 ? "軽度の外耳炎。鼓膜や耳道の深部には大きな異常は見られませんでした。" : "経過観察",
      examination: index % 2 === 0 ? "視診、触診、体温測定" : null,
      treatment: index === 1 ? "耳道を洗浄し、炎症を抑える点耳薬を院内で投与しました。自宅では耳を強くこすらないよう注意します。" : index % 2 === 0 ? "爪切りと耳掃除" : null,
      medication: index % 2 === 0 ? "整腸剤" : index === 1 ? "点耳薬" : null,
      medicationInstructions: index === 1 ? "1日1回、右耳へ2滴。投与後は耳の付け根をやさしくマッサージしてください。" : index % 2 === 0 ? "朝夕の食後" : null,
      consultationFee: index % 2 === 0 ? new Prisma.Decimal(4500 + index * 800) : null,
      nextVisitDate: index < 3 ? parseDateInput(dateOffset(today, 14 + index * 7)) : null
    });
  }

  const medicationNames = ["フィラリア予防薬", "整腸剤", "点耳薬", "関節サプリメント", "抗炎症薬", "目薬"];
  for (let index = 0; index < 6; index += 1) {
    const id = `UI_FIXTURE_RECORD_MEDICATION_${String(index + 1).padStart(2, "0")}`;
    addRecord({
      id,
      petId: index < 4 ? petId("KOTARO") : petId("MIKE"),
      recordType: "MEDICATION",
      recordDate: parseDateInput(dateOffset(today, -(index * 5 + 1))),
      recordTimeMinutes: index % 2 === 0 ? 8 * 60 + 15 : null,
      title: `${medicationNames[index]}を投与`,
      memo: index === 3 ? LONG_MEMO : index % 2 === 0 ? "食後に投与しました。" : null,
      searchText: `投薬 ${medicationNames[index]}`,
      createdAt: createdAgo(now, index * 22 + 3)
    });
    medicationDetails.push({
      petRecordId: id,
      medicationName: medicationNames[index],
      dosage: index % 2 === 0 ? ["1錠", "1包", "右耳に2滴"][index % 3] : null
    });
  }

  const vaccines = ["狂犬病ワクチン", "混合ワクチン（8種）", "猫3種混合ワクチン", "レプトスピラワクチン", "猫白血病ワクチン"];
  for (let index = 0; index < 5; index += 1) {
    const id = `UI_FIXTURE_RECORD_VACCINATION_${String(index + 1).padStart(2, "0")}`;
    addRecord({
      id,
      petId: index < 4 ? petId("KOTARO") : petId("MOMO"),
      recordType: "VACCINATION",
      recordDate: parseDateInput(dateOffset(today, -(index * 40 + 10))),
      recordTimeMinutes: index % 2 === 0 ? 11 * 60 : null,
      title: vaccines[index],
      memo: index === 2 ? "接種後は激しい運動を避けて自宅で過ごしました。" : null,
      searchText: `ワクチン ${vaccines[index]}`,
      createdAt: createdAgo(now, index * 40 + 2)
    });
    vaccinationDetails.push({
      petRecordId: id,
      vaccineName: vaccines[index],
      hospitalName: index % 2 === 0 ? "さくら動物病院" : null,
      nextDueDate: index < 3 ? parseDateInput(dateOffset(today, 180 + index * 30)) : null
    });
  }

  const memoryFixtures = [
    { title: "初めて一緒に海辺へ出かけた日", memo: LONG_MEMO, tags: ["お出かけ", "旅行", "お気に入り"], favorite: true, pets: ["KOTARO", "MIKE", "HANA"] },
    { title: "並んでお昼寝", memo: "窓から入る風を感じながら、二匹で並んで眠っていました。", tags: ["寝顔"], favorite: true, pets: ["KOTARO", "MIKE"] },
    { title: "みんなで誕生日のお祝い", memo: "家族みんなで写真を撮りました。", tags: ["誕生日", "記念日", "ごはん"], favorite: false, pets: ["KOTARO", "HANA", "LEO_LONG", "MIKE"] },
    { title: "いつもの朝", memo: null, tags: [], favorite: false, pets: ["KOTARO"] },
    { title: "公園で見つけた秋の落ち葉", memo: "落ち葉の音を楽しみながら歩きました。", tags: ["散歩", "成長記録"], favorite: false, pets: ["KOTARO", "HANA"] },
    { title: "新しいおもちゃに夢中", memo: LONG_MEMO, tags: ["お気に入り", "成長記録", "記念日", "お出かけ"], favorite: true, pets: ["KOTARO", "SORA", "MOMO"] },
    { title: "ミケのきれいな寝顔", memo: "日向で気持ちよさそうでした。", tags: ["寝顔"], favorite: true, pets: ["MIKE"] },
    { title: "ソラがおうちに来た日", memo: "最初は少し緊張していましたが、夜にはごはんを食べてくれました。", tags: ["記念日", "成長記録"], favorite: false, pets: ["SORA"] },
    { title: "雨の日の室内遊び", memo: null, tags: [], favorite: false, pets: ["HANA", "MOMO"] },
    { title: "昔の家族写真", memo: "管理終了したPetも含む思い出です。", tags: ["お気に入り"], favorite: true, pets: ["CHAKO_INACTIVE", "LUNA_INACTIVE", "KOTARO"] }
  ];
  for (let index = 0; index < memoryFixtures.length; index += 1) {
    const fixture = memoryFixtures[index];
    const id = `UI_FIXTURE_RECORD_MEMORY_${String(index + 1).padStart(2, "0")}`;
    addRecord({
      id,
      petId: petId(fixture.pets[0]),
      recordType: "MEMORY",
      recordDate: parseDateInput(dateOffset(today, -(index * 11 + 2))),
      recordTimeMinutes: index % 3 === 0 ? 14 * 60 + index : null,
      title: fixture.title,
      memo: fixture.memo,
      searchText: `${fixture.title} ${fixture.memo || ""} ${fixture.tags.join(" ")}`,
      createdAt: createdAgo(now, index * 26 + 2)
    });
    memoryDetails.push({ petRecordId: id, tags: fixture.tags, searchTags: fixture.tags.map((tag) => tag.normalize("NFKC").toLowerCase()), isFavorite: fixture.favorite });
    memoryPets.push(...fixture.pets.map((pet, sortOrder) => ({ petRecordId: id, petId: petId(pet), sortOrder })));
    if (index === 0) {
      memoryImages.push(
        { id: "UI_FIXTURE_MEMORY_IMAGE_01", memoryRecordId: id, fileName: UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES[0], sortOrder: 0 },
        { id: "UI_FIXTURE_MEMORY_IMAGE_02", memoryRecordId: id, fileName: UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES[1], sortOrder: 1 }
      );
    } else if (index === 1 || index === 2) {
      memoryImages.push({ id: `UI_FIXTURE_MEMORY_IMAGE_0${index + 2}`, memoryRecordId: id, fileName: UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES[index + 1], sortOrder: 0 });
    }
  }

  await tx.petRecord.createMany({ data: records });
  await tx.petHealthRecordDetail.createMany({ data: healthDetails });
  await tx.petMedicalVisitDetail.createMany({ data: medicalDetails });
  await tx.petMedicationRecordDetail.createMany({ data: medicationDetails });
  await tx.petVaccinationRecordDetail.createMany({ data: vaccinationDetails });
  await tx.petMemoryRecordDetail.createMany({ data: memoryDetails });
  await tx.petMemoryRecordPet.createMany({ data: memoryPets });
  await tx.petMemoryRecordImage.createMany({ data: memoryImages });
}

async function createHouseholdFixtures(
  tx: Prisma.TransactionClient,
  target: Awaited<ReturnType<typeof findTargetUser>>,
  now: Date,
  today: string,
  careDate: string
) {
  const tags = ["散歩", "お出かけ", "誕生日", "病院", "ごはん", "お気に入り", "寝顔", "記念日", "旅行", "成長記録"];
  await tx.savedMemoryTag.createMany({ data: tags.map((name, index) => ({ id: `UI_FIXTURE_SAVED_TAG_${String(index + 1).padStart(2, "0")}`, householdId: UI_FIXTURE_HOUSEHOLD_ID, name, normalizedName: name.normalize("NFKC").toLowerCase(), createdByUserId: target.id, createdAt: createdAgo(now, index + 1) })) });

  await tx.householdInvitation.createMany({ data: [
    { id: "UI_FIXTURE_MAIN_INVITATION_ACTIVE", householdId: UI_FIXTURE_HOUSEHOLD_ID, createdByUserId: target.id, tokenHash: hashToken("UI_FIXTURE_MAIN_INVITATION_ACTIVE"), expiresAt: createdAgo(now, -24 * 7), createdAt: createdAgo(now, 2) },
    { id: "UI_FIXTURE_MAIN_INVITATION_ACCEPTED", householdId: UI_FIXTURE_HOUSEHOLD_ID, createdByUserId: target.id, tokenHash: hashToken("UI_FIXTURE_MAIN_INVITATION_ACCEPTED"), expiresAt: createdAgo(now, -24 * 3), acceptedAt: createdAgo(now, 12), createdAt: createdAgo(now, 48) },
    { id: "UI_FIXTURE_MAIN_INVITATION_EXPIRED", householdId: UI_FIXTURE_HOUSEHOLD_ID, createdByUserId: target.id, tokenHash: hashToken("UI_FIXTURE_MAIN_INVITATION_EXPIRED"), expiresAt: createdAgo(now, 24), createdAt: createdAgo(now, 72) },
    { id: "UI_FIXTURE_MAIN_INVITATION_REVOKED", householdId: UI_FIXTURE_HOUSEHOLD_ID, createdByUserId: target.id, tokenHash: hashToken("UI_FIXTURE_MAIN_INVITATION_REVOKED"), expiresAt: createdAgo(now, -24), revokedAt: createdAgo(now, 6), createdAt: createdAgo(now, 36) }
  ] });

  const activityTemplates: Array<{
    eventType: Prisma.HouseholdActivityCreateManyInput["eventType"];
    category: Prisma.HouseholdActivityCreateManyInput["category"];
    target: string | null;
    details: Prisma.InputJsonValue | undefined;
  }> = [
    { eventType: "HOUSEHOLD_NAME_UPDATED", category: "GROUP_SETTING", target: null, details: undefined },
    { eventType: "INVITATION_CREATED", category: "GROUP_SETTING", target: null, details: undefined },
    { eventType: "INVITATION_REVOKED", category: "GROUP_SETTING", target: null, details: undefined },
    { eventType: "MEMBER_JOINED", category: "MEMBER", target: "高橋 メンバー", details: undefined },
    { eventType: "MEMBER_ROLE_UPDATED", category: "MEMBER", target: "田中 閲覧者（長めの表示名確認）", details: { previousRole: "MEMBER", newRole: "VIEWER" } },
    { eventType: "PET_WEIGHT_CREATED", category: "CARE_RECORD", target: "コタロウ", details: { recordDate: today, weightKg: 11.92 } },
    { eventType: "PET_WEIGHT_UPDATED", category: "CARE_RECORD", target: "ミケ", details: { previousWeightKg: 4.1, newWeightKg: 4.2 } },
    { eventType: "PET_FEEDING_CREATED", category: "CARE_RECORD", target: "コタロウ", details: { fedAt: currentCareTimestamp(now, careDate, 2).toISOString() } },
    { eventType: "PET_WATER_CREATED", category: "CARE_RECORD", target: "ミケ", details: { caredAt: currentCareTimestamp(now, careDate, 4).toISOString(), action: "REPLACED" } },
    { eventType: "PET_WALK_CREATED", category: "CARE_RECORD", target: "ハナ", details: { startedAt: currentCareTimestamp(now, careDate, 6).toISOString(), durationMinutes: 30 } },
    { eventType: "PET_LITTER_CREATED", category: "CARE_RECORD", target: "ソラ", details: { occurredAt: currentCareTimestamp(now, careDate, 7).toISOString(), action: "BOTH" } },
    { eventType: "PET_HEALTH_RECORD_CREATED", category: "CARE_RECORD", target: "コタロウ", details: { recordDate: dateOffset(today, -1) } },
    { eventType: "PET_MEDICAL_RECORD_CREATED", category: "CARE_RECORD", target: "コタロウ", details: { recordDate: dateOffset(today, -3) } },
    { eventType: "PET_MEDICATION_RECORD_CREATED", category: "CARE_RECORD", target: "ミケ", details: { recordDate: dateOffset(today, -5) } },
    { eventType: "PET_VACCINATION_RECORD_CREATED", category: "CARE_RECORD", target: "モモ", details: { recordDate: dateOffset(today, -10) } },
    { eventType: "PET_MEMORY_RECORD_CREATED", category: "CARE_RECORD", target: "コタロウほか", details: { recordDate: dateOffset(today, -2) } }
  ];
  while (activityTemplates.length < 26) {
    const index = activityTemplates.length;
    const eventType = index % 2 === 0 ? "PET_FEEDING_UPDATED" : "PET_WALK_UPDATED";
    activityTemplates.push({
      eventType,
      category: "CARE_RECORD",
      target: index % 2 === 0 ? "コタロウ" : "ハナ",
      details: eventType === "PET_FEEDING_UPDATED"
        ? { fedAt: createdAgo(now, index * 3).toISOString(), previousFedAt: createdAgo(now, index * 3 + 1).toISOString() }
        : { startedAt: createdAgo(now, index * 3).toISOString(), previousStartedAt: createdAgo(now, index * 3 + 1).toISOString(), durationMinutes: index % 3 === 0 ? 60 : 30 }
    });
  }
  await tx.householdActivity.createMany({ data: activityTemplates.map((activity, index) => ({
    id: `UI_FIXTURE_ACTIVITY_${String(index + 1).padStart(2, "0")}`,
    householdId: UI_FIXTURE_HOUSEHOLD_ID,
    actorUserId: index % 4 === 0 ? UI_FIXTURE_MEMBER_USER_IDS[1] : target.id,
    actorNameSnapshot: index % 4 === 0 ? "鈴木 管理者" : target.name?.trim() || "名前未設定",
    eventType: activity.eventType,
    category: activity.category,
    targetType: activity.target ? "Pet" : null,
    targetNameSnapshot: activity.target,
    details: activity.details ?? Prisma.JsonNull,
    createdAt: createdAgo(now, index * 4 + 1)
  })) });
}

async function createAdminFixtures(tx: Prisma.TransactionClient, now: Date) {
  await tx.household.createMany({ data: UI_FIXTURE_ADMIN_HOUSEHOLD_IDS.map((id, index) => ({
    id,
    name: index === 7 ? `管理一覧確認用・とても長い共有グループ名 ${String(index + 1).padStart(2, "0")}（レイアウト折り返し確認）` : `管理一覧確認Household ${String(index + 1).padStart(2, "0")}`,
    careDayStartMinutes: index % 3 === 0 ? 240 : 0,
    createdAt: createdAgo(now, (index + 1) * 12)
  })) });
  const adminMemberships: Prisma.HouseholdMemberCreateManyInput[] = [];
  for (let index = 0; index < ADMIN_HOUSEHOLD_COUNT; index += 1) {
    adminMemberships.push({
      id: `UI_FIXTURE_ADMIN_MEMBERSHIP_${String(index + 1).padStart(2, "0")}_A`,
      householdId: UI_FIXTURE_ADMIN_HOUSEHOLD_IDS[index],
      userId: UI_FIXTURE_ADMIN_USER_IDS[index % ADMIN_USER_COUNT],
      role: index % 4 === 0 ? "ADMIN" : index % 3 === 0 ? "MEMBER" : "OWNER",
      createdAt: createdAgo(now, (index + 1) * 10)
    });
    if (index % 5 === 0) {
      adminMemberships.push({
        id: `UI_FIXTURE_ADMIN_MEMBERSHIP_${String(index + 1).padStart(2, "0")}_B`,
        householdId: UI_FIXTURE_ADMIN_HOUSEHOLD_IDS[index],
        userId: UI_FIXTURE_ADMIN_USER_IDS[(index + 1) % ADMIN_USER_COUNT],
        role: "VIEWER",
        createdAt: createdAgo(now, (index + 1) * 9)
      });
    }
  }
  await tx.householdMember.createMany({ data: adminMemberships });

  const adminPets: Prisma.PetCreateManyInput[] = [];
  for (let index = 0; index < ADMIN_HOUSEHOLD_COUNT; index += 1) {
    if (index % 4 === 0) continue;
    adminPets.push({
      id: `UI_FIXTURE_ADMIN_PET_${String(index + 1).padStart(2, "0")}_A`,
      householdId: UI_FIXTURE_ADMIN_HOUSEHOLD_IDS[index],
      name: `一覧確認Pet ${String(index + 1).padStart(2, "0")}`,
      species: index % 2 === 0 ? "DOG" : "CAT",
      sex: index % 3 === 0 ? "UNKNOWN" : index % 2 === 0 ? "MALE" : "FEMALE",
      memo: "管理Household一覧の件数表示用fixtureです。",
      createdAt: createdAgo(now, index + 1)
    });
    if (index % 5 === 0) {
      adminPets.push({
        id: `UI_FIXTURE_ADMIN_PET_${String(index + 1).padStart(2, "0")}_B`,
        householdId: UI_FIXTURE_ADMIN_HOUSEHOLD_IDS[index],
        name: `同居Pet ${String(index + 1).padStart(2, "0")}`,
        species: index % 2 === 0 ? "CAT" : "DOG",
        isActive: false
      });
    }
  }
  await tx.pet.createMany({ data: adminPets });

  await tx.householdInvitation.createMany({ data: UI_FIXTURE_ADMIN_HOUSEHOLD_IDS.map((householdId, index) => {
    const state = index % 4;
    return {
      id: `UI_FIXTURE_ADMIN_INVITATION_${String(index + 1).padStart(2, "0")}`,
      householdId,
      createdByUserId: UI_FIXTURE_ADMIN_USER_IDS[index % ADMIN_USER_COUNT],
      tokenHash: hashToken(`UI_FIXTURE_ADMIN_INVITATION_${index + 1}`),
      expiresAt: state === 2 ? createdAgo(now, 24) : createdAgo(now, -24 * 7),
      acceptedAt: state === 1 ? createdAgo(now, 8) : null,
      revokedAt: state === 3 ? createdAgo(now, 4) : null,
      createdAt: createdAgo(now, index * 5 + 2)
    };
  }) });

  const suspendedUsers = UI_FIXTURE_ADMIN_USER_IDS.filter((_, index) => (index + 1) % 5 === 0 && index + 1 !== ADMIN_USER_COUNT);
  await tx.userAccessAction.createMany({ data: suspendedUsers.map((targetUserId, index) => ({
    id: `UI_FIXTURE_ACCESS_ACTION_${String(index + 1).padStart(2, "0")}`,
    actionType: "SUSPENDED",
    actorUserId: UI_FIXTURE_ADMIN_USER_IDS[7],
    actorUserIdSnapshot: UI_FIXTURE_ADMIN_USER_IDS[7],
    actorNameSnapshot: "管理一覧確認ユーザー 08",
    targetUserId,
    targetUserIdSnapshot: targetUserId,
    targetNameSnapshot: `管理一覧確認ユーザー ${String((index + 1) * 5).padStart(2, "0")}`,
    reason: "UI確認用fixtureによる一時停止状態",
    createdAt: createdAgo(now, (index + 1) * 6)
  })) });
}

async function createContactFixtures(
  tx: Prisma.TransactionClient,
  target: Awaited<ReturnType<typeof findTargetUser>>,
  now: Date
) {
  const categories = ["BUG", "HOW_TO", "FEATURE_REQUEST", "ACCOUNT", "OTHER"] as const;
  const statuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"] as const;
  const inquiries: Prisma.ContactInquiryCreateManyInput[] = [];
  const messages: Prisma.ContactInquiryMessageCreateManyInput[] = [];
  const userName = target.name?.trim() || "名前未設定";
  for (let index = 0; index < UI_FIXTURE_CONTACT_PUBLIC_IDS.length; index += 1) {
    const number = index + 1;
    const status = statuses[index % statuses.length];
    const createdHoursAgo = index === 0 ? 12 : index === 5 ? 30 : index === 10 ? 72 : number * 5;
    const createdAt = createdAgo(now, createdHoursAgo);
    const updatedAt = createdAgo(now, Math.max(createdHoursAgo - 2, 1));
    const assigned = number % 3 !== 1;
    const subject = number === 7
      ? "一覧カードや詳細画面で長い件名が自然に折り返され、操作ボタンやステータス表示と重ならないことを確認したい問い合わせ"
      : ["記録一覧の表示について", "共有グループ切り替え方法", "体重グラフへの機能要望", "アカウント設定の確認", "その他の利用方法について"][index % 5];
    const firstBody = number === 7
      ? `${LONG_MEMO}\n\n再現手順として、Petを切り替えたあと日付フィルターと種別フィルターを続けて操作しました。画面幅が狭い場合にも本文、件名、バッジが読みやすく表示されるか確認をお願いします。`
      : "画面の表示と操作方法について確認したく、問い合わせを送信しました。UI確認用fixtureのメッセージです。";
    const inquiryId = `UI_FIXTURE_CONTACT_${String(number).padStart(2, "0")}`;
    const publicId = UI_FIXTURE_CONTACT_PUBLIC_IDS[index];
    inquiries.push({
      id: inquiryId,
      publicId,
      userId: target.id,
      userIdSnapshot: target.id,
      userNameSnapshot: userName,
      userEmailSnapshot: target.email,
      category: categories[index % categories.length],
      subject,
      searchText: `${publicId} ${subject} ${userName} ${target.email || ""}`.normalize("NFKC").toLowerCase(),
      status,
      sourcePath: number % 2 === 0 ? ["/records", "/weights", "/settings/members", "/care"][index % 4] : null,
      errorId: number % 4 === 0 ? `UI-FIXTURE-ERROR-${String(number).padStart(3, "0")}` : null,
      assignedAdminUserId: assigned ? UI_FIXTURE_ADMIN_USER_IDS[7] : null,
      assignedAdminNameSnapshot: assigned ? "管理一覧確認ユーザー 08" : null,
      createdAt,
      updatedAt,
      resolvedAt: status === "RESOLVED" ? updatedAt : null,
      closedAt: status === "CLOSED" ? updatedAt : null
    });
    messages.push({
      id: `UI_FIXTURE_CONTACT_MESSAGE_${String(number).padStart(2, "0")}_01`,
      inquiryId,
      senderType: "USER",
      senderUserId: target.id,
      senderUserIdSnapshot: target.id,
      senderNameSnapshot: userName,
      body: firstBody,
      createdAt
    });
    if (assigned) {
      messages.push({
        id: `UI_FIXTURE_CONTACT_MESSAGE_${String(number).padStart(2, "0")}_02`,
        inquiryId,
        senderType: "ADMIN",
        senderUserId: UI_FIXTURE_ADMIN_USER_IDS[7],
        senderUserIdSnapshot: UI_FIXTURE_ADMIN_USER_IDS[7],
        senderNameSnapshot: "管理一覧確認ユーザー 08",
        body: "お問い合わせありがとうございます。状況を確認し、必要な手順をご案内します。",
        createdAt: createdAgo(now, Math.max(createdHoursAgo - 1, 1))
      });
    }
    if (number % 6 === 0) {
      messages.push({
        id: `UI_FIXTURE_CONTACT_MESSAGE_${String(number).padStart(2, "0")}_03`,
        inquiryId,
        senderType: "USER",
        senderUserId: target.id,
        senderUserIdSnapshot: target.id,
        senderNameSnapshot: userName,
        body: "案内された手順を試したところ、表示を確認できました。追加で一点だけ確認をお願いします。",
        createdAt: updatedAt
      });
    }
  }
  await tx.contactInquiry.createMany({ data: inquiries });
  await tx.contactInquiryMessage.createMany({ data: messages });
}

async function verifyFixtures() {
  const mainPetWhere = { householdId: UI_FIXTURE_HOUSEHOLD_ID };
  const [
    household,
    pets,
    weights,
    feeding,
    water,
    walk,
    litter,
    recordGroups,
    memoryRelations,
    savedMemoryTags,
    members,
    invitations,
    activities,
    contacts,
    adminUsers,
    adminHouseholds,
    adminInvitations
  ] = await Promise.all([
    prisma.household.count({ where: { id: UI_FIXTURE_HOUSEHOLD_ID } }),
    prisma.pet.count({ where: mainPetWhere }),
    prisma.petWeightRecord.count({ where: { pet: mainPetWhere } }),
    prisma.petFeedingRecord.count({ where: { pet: mainPetWhere } }),
    prisma.petWaterRecord.count({ where: { pet: mainPetWhere } }),
    prisma.petWalkRecord.count({ where: { pet: mainPetWhere } }),
    prisma.petLitterRecord.count({ where: { pet: mainPetWhere } }),
    prisma.petRecord.groupBy({ by: ["recordType"], where: { pet: mainPetWhere }, _count: true }),
    prisma.petMemoryRecordPet.count({ where: { pet: mainPetWhere } }),
    prisma.savedMemoryTag.count({ where: { householdId: UI_FIXTURE_HOUSEHOLD_ID } }),
    prisma.householdMember.count({ where: { householdId: UI_FIXTURE_HOUSEHOLD_ID } }),
    prisma.householdInvitation.count({ where: { householdId: UI_FIXTURE_HOUSEHOLD_ID } }),
    prisma.householdActivity.count({ where: { householdId: UI_FIXTURE_HOUSEHOLD_ID } }),
    prisma.contactInquiry.count({ where: { publicId: { in: UI_FIXTURE_CONTACT_PUBLIC_IDS } } }),
    prisma.user.count({ where: { id: { in: UI_FIXTURE_ADMIN_USER_IDS } } }),
    prisma.household.count({ where: { id: { in: UI_FIXTURE_ADMIN_HOUSEHOLD_IDS } } }),
    prisma.householdInvitation.count({ where: { householdId: { in: UI_FIXTURE_ADMIN_HOUSEHOLD_IDS } } })
  ]);
  const byType = Object.fromEntries(recordGroups.map((row) => [row.recordType, row._count]));
  const actual = { household, pets, weights, feeding, water, walk, litter, records: recordGroups.reduce((sum, row) => sum + row._count, 0), byType, memoryRelations, savedMemoryTags, members, invitations, activities, contacts, adminUsers, adminHouseholds, adminInvitations };
  const expected = fixtureSummary();
  if (
    household !== 1 || pets !== expected.pets || weights !== expected.weights ||
    feeding !== expected.feeding || water !== expected.water || walk !== expected.walk ||
    litter !== expected.litter || actual.records !== expected.records ||
    byType.HEALTH !== expected.health || byType.MEDICAL !== expected.medical ||
    byType.MEDICATION !== expected.medication || byType.VACCINATION !== expected.vaccination ||
    byType.MEMORY !== expected.memory || savedMemoryTags !== expected.savedMemoryTags ||
    members !== expected.members || invitations !== expected.invitations ||
    activities !== expected.activities || contacts !== expected.contacts ||
    adminUsers !== expected.adminUsers || adminHouseholds !== expected.adminHouseholds ||
    adminInvitations !== expected.adminInvitations
  ) {
    throw new Error(`投入後件数が予定と一致しません: ${JSON.stringify(actual)}`);
  }
  return actual;
}

async function main() {
  const actualDatabase = await assertConnectedDevelopmentDatabase();
  if (cleanupMode) {
    await cleanupFixtures();
    return;
  }

  const target = await findTargetUser();
  printPreview(target);
  if (!applyMode) return;

  const fixtureExisted = Boolean(
    await prisma.household.findUnique({ where: { id: UI_FIXTURE_HOUSEHOLD_ID }, select: { id: true } })
  );
  await writeFixtureImages();
  try {
    await createFixtures(target, new Date());
  } catch (error) {
    // 初回投入失敗時だけ生成画像を補償削除する。再投入時はrollback後の旧fixture参照を維持する。
    if (!fixtureExisted) await removeFixtureImages().catch(() => undefined);
    throw error;
  }
  const verified = await verifyFixtures();
  console.log(`投入先DB: ${actualDatabase}`);
  console.log(`投入完了: ${UI_FIXTURE_HOUSEHOLD_NAME}`);
  console.log(`検証件数: ${JSON.stringify(verified)}`);
  if (target.appRole === "USER") {
    console.log("Admin fixtureは投入済みですが、現在の対象ユーザーではAdmin画面へアクセスできません。");
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : "UI fixture seedで不明なエラーが発生しました。");
    await prisma.$disconnect();
    process.exit(1);
  });
