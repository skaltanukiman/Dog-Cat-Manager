import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatHouseholdActivity, type HouseholdActivityListItem } from "../src/lib/household-activity";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function actionSource(actions: string, name: string) {
  const start = actions.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} が見つかりません。`);
  const next = actions.indexOf("export async function", start + 1);
  return actions.slice(start, next === -1 ? undefined : next);
}

function activity(eventType: HouseholdActivityListItem["eventType"], details: HouseholdActivityListItem["details"]) {
  return formatHouseholdActivity({
    id: "activity-1",
    actorNameSnapshot: "林",
    eventType,
    category: "CARE_RECORD",
    targetNameSnapshot: eventType.startsWith("PET_WALK") ? "こむぎ" : "ミミ",
    details,
    createdAt: new Date("2026-08-12T00:00:00.000Z")
  });
}

test("PetWalkRecordとPetLitterRecordは独立したイベント履歴モデルである", async () => {
  const schema = await source("prisma/schema.prisma");
  const walk = schema.slice(schema.indexOf("model PetWalkRecord {"), schema.indexOf("model PetLitterRecord {"));
  const litter = schema.slice(schema.indexOf("model PetLitterRecord {"), schema.indexOf("enum PetLitterAction"));
  assert.match(walk, /startedAt\s+DateTime\s+@map\("started_at"\)/);
  assert.match(walk, /durationMinutes\s+Int\?\s+@map\("duration_minutes"\)/);
  assert.match(walk, /distanceMeters\s+Int\?\s+@map\("distance_meters"\)/);
  assert.match(walk, /@@index\(\[petId, recordDate, startedAt\]\)/);
  assert.doesNotMatch(walk, /@@unique\(\[petId, recordDate\]\)/);
  assert.match(litter, /occurredAt\s+DateTime\s+@map\("occurred_at"\)/);
  assert.match(litter, /action\s+PetLitterAction/);
  assert.match(litter, /@@index\(\[petId, recordDate, occurredAt\]\)/);
  assert.doesNotMatch(litter, /@@unique\(\[petId, recordDate\]\)/);
  assert.match(schema, /enum PetLitterAction \{\s+URINATION\s+DEFECATION\s+BOTH\s+CLEANED\s+\}/);
  assert.match(schema, /walkRecords\s+PetWalkRecord\[\]/);
  assert.match(schema, /litterRecords\s+PetLitterRecord\[\]/);
  assert.match(schema, /createdPetWalkRecords\s+PetWalkRecord\[\]/);
  assert.match(schema, /createdPetLitterRecords\s+PetLitterRecord\[\]/);
});

test("散歩距離migrationはnullableなINTEGER列だけを追加する", async () => {
  const migration = await source("prisma/migrations/20260816090000_add_pet_walk_distance/migration.sql");
  assert.match(migration, /ALTER TABLE "pet_walk_records"/);
  assert.match(migration, /ADD COLUMN "distance_meters" INTEGER/);
  assert.doesNotMatch(migration, /NOT NULL|UPDATE|DELETE|DROP/);
});

test("Phase 3B migrationは新規enum・テーブル・Cascade/SetNull FK・indexだけを追加する", async () => {
  const migration = await source("prisma/migrations/20260812214000_add_pet_species_care_records/migration.sql");
  assert.match(migration, /CREATE TYPE "PetLitterAction" AS ENUM \('URINATION', 'DEFECATION', 'BOTH', 'CLEANED'\)/);
  assert.match(migration, /CREATE TABLE "pet_walk_records"/);
  assert.match(migration, /CREATE TABLE "pet_litter_records"/);
  assert.match(migration, /pet_walk_records_pet_id_record_date_started_at_idx/);
  assert.match(migration, /pet_litter_records_pet_id_record_date_occurred_at_idx/);
  assert.equal((migration.match(/REFERENCES "pets"\("id"\) ON DELETE CASCADE/g) ?? []).length, 2);
  assert.equal((migration.match(/REFERENCES "users"\("id"\) ON DELETE SET NULL/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /UNIQUE INDEX "pet_(?:walk|litter)_records_pet_id_record_date/);
  assert.doesNotMatch(migration, /ALTER TABLE "(?:pets|users|pet_feeding_records|pet_water_records|pet_weight_records)"/);
  for (const event of ["PET_WALK_CREATED", "PET_WALK_UPDATED", "PET_WALK_DELETED", "PET_LITTER_CREATED", "PET_LITTER_UPDATED", "PET_LITTER_DELETED"]) {
    assert.match(migration, new RegExp(event));
  }
});

test("Walk ActionはDB取得したDOGだけを全CRUDで許可しFormData speciesを使わない", async () => {
  const actions = await source("src/app/actions/pet-walk.ts");
  for (const name of ["createPetWalkRecord", "updatePetWalkRecord", "deletePetWalkRecord"]) {
    const action = actionSource(actions, name);
    assert.match(action, /species: true/);
    assert.match(action, /species !== "DOG"/);
    assert.doesNotMatch(action, /formData\.get\("species"\)|result\.data\.species/);
  }
  assert.match(actions, /pet: \{ householdId: context\.household\.id, species: "DOG", isActive: true \}/);
});

test("不正な散歩距離は散歩時間とは別のstatusで案内する", async () => {
  const actions = await source("src/app/actions/pet-walk.ts");
  const statusMessage = await source("src/components/status-message.tsx");
  assert.match(actions, /issue\.path\[0\] === "distanceMeters"\)\) return "petWalkDistanceInvalid"/);
  assert.match(statusMessage, /petWalkDistanceInvalid: "散歩距離は0\.01km単位の正の値で入力してください。"/);
});

test("Litter ActionはDB取得したCATだけを全CRUDで許可しFormData speciesを使わない", async () => {
  const actions = await source("src/app/actions/pet-litter.ts");
  for (const name of ["createPetLitterRecord", "updatePetLitterRecord", "deletePetLitterRecord"]) {
    const action = actionSource(actions, name);
    assert.match(action, /species: true/);
    assert.match(action, /species !== "CAT"/);
    assert.doesNotMatch(action, /formData\.get\("species"\)|result\.data\.species/);
  }
  assert.match(actions, /pet: \{ householdId: context\.household\.id, species: "CAT", isActive: true \}/);
});

test("Walk/Litter ActionはHousehold・careDate・最新membership・管理状態・競合を検証する", async () => {
  for (const [path, names] of [
    ["src/app/actions/pet-walk.ts", ["createPetWalkRecord", "updatePetWalkRecord", "deletePetWalkRecord"]],
    ["src/app/actions/pet-litter.ts", ["createPetLitterRecord", "updatePetLitterRecord", "deletePetLitterRecord"]]
  ] as const) {
    const actions = await source(path);
    assert.match(actions, /householdId_userId: \{ householdId, userId \}/);
    assert.match(actions, /canEditHouseholdSharedData\(membership\.role\)/);
    assert.match(actions, /membership\.household\.isDemo/);
    assert.match(actions, /if \(!record\.pet\.isActive\) throw new InactivePet/);
    for (const name of names) {
      const action = actionSource(actions, name);
      assert.match(action, /getRequiredHouseholdMutationContext\("\/care"\)/);
      assert.match(action, /currentCareDayStartMinutes\(tx, context\.household\.id, context\.user\.id\)/);
      assert.match(action, /context\.household\.id/);
      if (!name.startsWith("create")) assert.match(action, /recordDate: submittedRecordDate/);
      if (name.startsWith("update")) assert.match(action, /updatedAt: record\.updatedAt/);
    }
  }
});

test("Walk/Litter Actionは未来・Care日外・変更なしを拒否しmemoをActivityへ保存しない", async () => {
  const walk = await source("src/app/actions/pet-walk.ts");
  const litter = await source("src/app/actions/pet-litter.ts");
  for (const actions of [walk, litter]) {
    assert.match(actions, /isFuturePetCareTimestamp\(/);
    assert.match(actions, /isTimestampInCareDate\(/);
    assert.match(actions, /getCareDayRecordDate\(/);
    assert.match(actions, /isSameInputMinute\(/);
    assert.match(actions, /UnchangedError/);
    assert.doesNotMatch(actions, /details: \{[^}]*memo/);
  }
  assert.match(walk, /record\.durationMinutes === result\.data\.durationMinutes/);
  assert.match(walk, /record\.distanceMeters === result\.data\.distanceMeters/);
  assert.match(walk, /previousDistanceMeters: record\.distanceMeters/);
  assert.equal((walk.match(/distanceMeters: result\.data\.distanceMeters/g) ?? []).length >= 3, true);
  assert.equal((walk.match(/distanceMeters: record\.distanceMeters/g) ?? []).length >= 2, true);
  assert.match(litter, /record\.action === result\.data\.action/);
});

test("species固有queryはDOGならWalk、CATならLitterだけをpetId+recordDateで取得する", async () => {
  const query = await source("src/lib/pet-care-queries.ts");
  assert.match(query, /selectedPet\.species === "DOG"[\s\S]*petWalkRecord\.findMany/);
  assert.match(query, /selectedPet\.species === "CAT"[\s\S]*petLitterRecord\.findMany/);
  assert.match(query, /petId: selectedPet\.id,[\s\S]*recordDate,[\s\S]*species: "DOG"/);
  assert.match(query, /petId: selectedPet\.id,[\s\S]*recordDate,[\s\S]*species: "CAT"/);
  assert.match(query, /orderBy: \[\{ startedAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(query, /orderBy: \[\{ occurredAt: "asc" \}, \{ id: "asc" \}\]/);
});

test("/careはDOGに散歩、CATに猫トイレを条件表示し共通Care UIを維持する", async () => {
  const page = await source("src/app/(app)/care/page.tsx");
  assert.match(page, /selectedPet\.species === "DOG"[\s\S]*title="散歩"/);
  assert.match(page, /selectedPet\.species === "CAT"[\s\S]*title="猫トイレ"/);
  assert.match(page, /action=\{createPetWalkRecord\}/);
  assert.match(page, /action=\{updatePetWalkRecord\}/);
  assert.match(page, /action=\{deletePetWalkRecord\}/);
  assert.equal((page.match(/name="distanceKm"/g) ?? []).length, 2);
  assert.equal((page.match(/min="0\.01"/g) ?? []).length, 2);
  assert.equal((page.match(/step="0\.01"/g) ?? []).length, 2);
  assert.match(page, /formatWalkDistanceKm\(latestWalkRecord\.distanceMeters\)/);
  assert.match(page, /formatWalkDistanceKm\(record\.distanceMeters\)/);
  assert.equal((page.match(/>お世話時刻</g) ?? []).length, 3);
  assert.equal((page.match(/>開始時刻</g) ?? []).length, 1);
  assert.match(page, /latestWaterRecord[\s\S]*PET_WATER_ACTION_LABELS\[latestWaterRecord\.action\]/);
  assert.match(page, /latestWalkRecord[\s\S]*latestWalkRecord\.durationMinutes[\s\S]*latestWalkRecord\.distanceMeters/);
  assert.match(page, /latestLitterRecord[\s\S]*PET_LITTER_ACTION_LABELS\[latestLitterRecord\.action\]/);
  assert.match(page, /action=\{createPetLitterRecord\}/);
  assert.match(page, /action=\{updatePetLitterRecord\}/);
  assert.match(page, /action=\{deletePetLitterRecord\}/);
  for (const text of ["食事", "水", "PetThumbnail", "今日に戻る", "管理終了したPetも含む"]) assert.match(page, new RegExp(text));
  assert.match(page, /canMutateSelectedPet \? \(/);
});

test("Walk/Litterは専用Realtime sourceと6種類のActivityを同一transactionで使う", async () => {
  const walk = await source("src/app/actions/pet-walk.ts");
  const litter = await source("src/app/actions/pet-litter.ts");
  const realtime = await source("src/lib/realtime.ts");
  assert.match(walk, /source: "petWalk"/);
  assert.match(litter, /source: "petLitter"/);
  assert.match(realtime, /\| "petWalk"/);
  assert.match(realtime, /\| "petLitter"/);
  for (const actions of [walk, litter]) {
    assert.match(actions, /commitHouseholdMutation\(/);
    assert.match(actions, /publishHouseholdChangeSafely\(change\)/);
    assert.match(actions, /\{ path: "\/care" \}[\s\S]*\{ path: "\/settings\/members" \}[\s\S]*\{ path: "\/settings\/members\/activity" \}/);
  }
});

test("Walk/Litter ActivityはJST日時・時間・日本語actionを表示しmemoを展開しない", () => {
  const startedAt = "2026-08-12T12:10:00.000Z";
  const occurredAt = "2026-08-12T11:15:00.000Z";
  assert.deepEqual(activity("PET_WALK_CREATED", { startedAt, durationMinutes: 30, distanceMeters: 2350, memo: "非表示" }), {
    summary: "林さんが「こむぎ」の散歩を記録しました",
    detail: "2026/08/12 21:10・30分・2.35km"
  });
  assert.equal(activity("PET_WALK_UPDATED", { startedAt, durationMinutes: null, distanceMeters: 1500 }).detail, "2026/08/12 21:10・1.5km");
  assert.match(activity("PET_WALK_DELETED", { startedAt }).summary, /散歩記録を削除/);
  assert.deepEqual(activity("PET_LITTER_CREATED", { occurredAt, action: "DEFECATION", memo: "非表示" }), {
    summary: "林さんが「ミミ」の猫トイレを記録しました",
    detail: "2026/08/12 20:15・うんち"
  });
  assert.match(activity("PET_LITTER_UPDATED", { occurredAt, action: "BOTH" }).detail ?? "", /おしっこ・うんち/);
  assert.match(activity("PET_LITTER_DELETED", { occurredAt, action: "CLEANED" }).detail ?? "", /トイレ掃除/);
  assert.doesNotMatch(JSON.stringify(activity("PET_LITTER_CREATED", { occurredAt, action: "DEFECATION", memo: "非表示" })), /非表示/);
});

test("既存Pet Care・Pet体重・画像コードを保持する", async () => {
  for (const path of [
    "src/app/actions/pet-feeding.ts",
    "src/app/actions/pet-water.ts",
    "src/app/actions/pet-weights.ts",
    "src/lib/pet-image.ts"
  ]) assert.ok((await source(path)).length > 0, `${path} は維持する必要があります。`);
});
