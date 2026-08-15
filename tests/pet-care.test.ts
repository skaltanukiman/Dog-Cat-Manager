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
    targetNameSnapshot: "こむぎ",
    details,
    createdAt: new Date("2026-08-12T00:00:00.000Z")
  });
}

test("Pet Careモデルは同日複数イベントを許可する", async () => {
  const schema = await source("prisma/schema.prisma");
  const feeding = schema.slice(schema.indexOf("model PetFeedingRecord {"), schema.indexOf("model PetWaterRecord {"));
  const water = schema.slice(schema.indexOf("model PetWaterRecord {"), schema.indexOf("enum PetWaterAction"));

  assert.match(feeding, /petId\s+String\s+@map\("pet_id"\)/);
  assert.match(feeding, /fedAt\s+DateTime\s+@map\("fed_at"\)/);
  assert.match(feeding, /memo\s+String\?\s+@db\.VarChar\(500\)/);
  assert.match(feeding, /@@index\(\[petId, recordDate, fedAt\]\)/);
  assert.doesNotMatch(feeding, /@@unique\(\[petId, recordDate\]\)/);
  assert.match(water, /action\s+PetWaterAction/);
  assert.match(water, /@@index\(\[petId, recordDate, caredAt\]\)/);
  assert.doesNotMatch(water, /@@unique\(\[petId, recordDate\]\)/);
  assert.match(schema, /enum PetWaterAction \{\s+REPLACED\s+REFILLED\s+\}/);
  assert.match(schema, /feedingRecords\s+PetFeedingRecord\[\]/);
  assert.match(schema, /waterRecords\s+PetWaterRecord\[\]/);
  assert.match(schema, /createdPetFeedingRecords\s+PetFeedingRecord\[\]/);
  assert.match(schema, /createdPetWaterRecords\s+PetWaterRecord\[\]/);
});

test("新規migrationはPet Careテーブル・enum・FK・indexだけを追加する", async () => {
  const migration = await source("prisma/migrations/20260812203000_add_pet_care_records/migration.sql");
  assert.match(migration, /CREATE TYPE "PetWaterAction" AS ENUM \('REPLACED', 'REFILLED'\)/);
  assert.match(migration, /CREATE TABLE "pet_feeding_records"/);
  assert.match(migration, /CREATE TABLE "pet_water_records"/);
  assert.match(migration, /pet_feeding_records_pet_id_record_date_fed_at_idx/);
  assert.match(migration, /pet_water_records_pet_id_record_date_cared_at_idx/);
  assert.match(migration, /REFERENCES "pets"\("id"\) ON DELETE CASCADE/);
  assert.equal((migration.match(/REFERENCES "users"\("id"\) ON DELETE SET NULL/g) ?? []).length, 2);
  assert.doesNotMatch(migration, /UNIQUE INDEX "pet_(?:feeding|water)_records_pet_id_record_date/);
  assert.doesNotMatch(migration, /ALTER TABLE "(?:pet_weight_records|pets)"/);
  for (const event of ["PET_FEEDING_CREATED", "PET_FEEDING_UPDATED", "PET_FEEDING_DELETED", "PET_WATER_CREATED", "PET_WATER_UPDATED", "PET_WATER_DELETED"]) {
    assert.match(migration, new RegExp(event));
  }
});

test("Pet Care Actionは全操作で最新membership・Household境界・管理中状態を再確認する", async () => {
  for (const [path, names] of [
    ["src/app/actions/pet-feeding.ts", ["createPetFeedingRecord", "updatePetFeedingRecord", "deletePetFeedingRecord"]],
    ["src/app/actions/pet-water.ts", ["createPetWaterRecord", "updatePetWaterRecord", "deletePetWaterRecord"]]
  ] as const) {
    const actions = await source(path);
    assert.match(actions, /canEditHouseholdSharedData\(membership\.role\)/);
    assert.match(actions, /householdId_userId: \{ householdId, userId \}/);
    for (const name of names) {
      const action = actionSource(actions, name);
      assert.match(action, /getRequiredHouseholdMutationContext\("\/care"\)/);
      assert.match(action, /context\.household\.id/);
      assert.match(action, /currentCareDayStartMinutes\(tx, context\.household\.id, context\.user\.id\)/);
      if (name.startsWith("create")) {
        assert.match(action, /where: \{ id: result\.data\.petId, householdId: context\.household\.id \}/);
      } else {
        assert.match(action, /pet: \{ householdId: context\.household\.id/);
      }
    }
    assert.match(actions, /if \(!pet\.isActive\) throw new InactivePet/);
    assert.match(actions, /if \(!record\.pet\.isActive\) throw new InactivePet/);
    assert.match(actions, /createdByUserId: context\.user\.id/);
  }
});

test("Pet Care Actionは未来・お世話日不一致・変更なしを拒否する", async () => {
  const feeding = await source("src/app/actions/pet-feeding.ts");
  const water = await source("src/app/actions/pet-water.ts");
  for (const actions of [feeding, water]) {
    assert.match(actions, /isFuturePetCareTimestamp\(/);
    assert.match(actions, /isTimestampInCareDate\(/);
    assert.match(actions, /getCareDayRecordDate\(/);
    assert.match(actions, /isSameInputMinute\(/);
    assert.match(actions, /UnchangedError/);
  }
  assert.match(water, /record\.action === result\.data\.action/);
});

test("業務更新・Activity・revisionは同一transactionで確定しPet専用Realtime sourceを使う", async () => {
  const feeding = await source("src/app/actions/pet-feeding.ts");
  const water = await source("src/app/actions/pet-water.ts");
  const realtime = await source("src/lib/realtime.ts");
  assert.match(feeding, /commitHouseholdMutation\([\s\S]*source: "petFeeding"/);
  assert.match(water, /commitHouseholdMutation\([\s\S]*source: "petWater"/);
  assert.match(realtime, /\| "petFeeding"/);
  assert.match(realtime, /\| "petWater"/);
  for (const actions of [feeding, water]) {
    assert.match(actions, /publishHouseholdChangeSafely\(change\)/);
    assert.match(actions, /\{ path: "\/care" \}[\s\S]*\{ path: "\/settings\/members" \}[\s\S]*\{ path: "\/settings\/members\/activity" \}/);
    assert.doesNotMatch(actions, /details: \{[^}]*memo/);
  }
});

test("Pet Care queryはPet候補と1 Pet・1お世話日の履歴をDBでHousehold絞り込みする", async () => {
  const query = await source("src/lib/pet-care-queries.ts");
  assert.match(query, /where: \{ householdId: context\.household\.id \}/);
  assert.equal((query.match(/petId: selectedPet\.id,/g) ?? []).length >= 2, true);
  assert.equal((query.match(/recordDate,/g) ?? []).length >= 2, true);
  assert.equal((query.match(/pet: \{ householdId: context\.household\.id/g) ?? []).length >= 2, true);
  assert.match(query, /orderBy: \[\{ fedAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(query, /orderBy: \[\{ caredAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(query, /includeInactive \? allPets : allPets\.filter/);
});

test("/careはPet選択・画像・お世話日・食事・水・閲覧専用状態を提供する", async () => {
  const page = await source("src/app/(app)/care/page.tsx");
  for (const text of [
    "お世話管理", "犬・猫の食事や水のお世話を記録します。", "管理終了したPetも含む", "今日に戻る",
    "食事", "水", "水を交換", "水を補充", "先に犬・猫を登録してください。", "閲覧のみ可能です"
  ]) assert.match(page, new RegExp(text));
  assert.match(page, /name="petId"/);
  assert.match(page, /SPECIES_LABELS\[pet\.species\]/);
  assert.match(page, /import \{ PetSpeciesBadge \} from "@\/components\/pet-species-badge";/);
  assert.match(page, /<PetSpeciesBadge species=\{selectedPet\.species\} \/>/);
  assert.match(page, /<Utensils className="[^"]*text-accent"/);
  assert.match(page, /<Droplets className="[^"]*text-brand"/);
  assert.match(page, /<Footprints className="[^"]*text-care-walk"/);
  assert.match(page, /<ClipboardCheck className="[^"]*text-care-litter"/);
  assert.match(page, /<PetThumbnail/);
  assert.match(page, /name="date"/);
  assert.match(page, /name="fedAt"/);
  assert.match(page, /name="caredAt"/);
  assert.match(page, /canMutateSelectedPet/);
  assert.match(page, /max=\{maxDateTime\}/);
});

test("/careは独立Disclosureとallowlist済みのmutation後開状態を提供する", async () => {
  const page = await source("src/app/(app)/care/page.tsx");
  const disclosure = await source("src/components/care-disclosure.tsx");
  assert.equal((page.match(/defaultOpen=\{/g) ?? []).length, 4);
  assert.match(page, /const CARE_SECTIONS = \["feeding", "water", "walk", "litter"\] as const/);
  assert.match(page, /<CareDisclosureHeader/);
  assert.match(page, /記録なし/);
  assert.doesNotMatch(page, /^"use client"/);
  assert.match(disclosure, /^"use client"/);
  assert.match(disclosure, /aria-expanded=\{open\}/);
  assert.match(disclosure, /aria-controls=\{contentId\}/);
  assert.match(disclosure, /inert=\{!open\}/);
  assert.match(disclosure, /grid-rows-\[0fr\]/);
  assert.match(disclosure, /grid-rows-\[1fr\]/);
  assert.match(disclosure, /motion-reduce:transition-none/);
  for (const [path, careSection] of [
    ["src/app/actions/pet-feeding.ts", "feeding"],
    ["src/app/actions/pet-water.ts", "water"],
    ["src/app/actions/pet-walk.ts", "walk"],
    ["src/app/actions/pet-litter.ts", "litter"]
  ]) {
    const actions = await source(path);
    assert.match(actions, new RegExp(`params\\.set\\("careSection", "${careSection}"\\)`));
  }
});

test("主要ナビは5項目を維持してPet Care導線を表示する", async () => {
  const nav = await source("src/components/app-nav.tsx");
  assert.match(nav, /href: "\/care", label: "お世話管理", mobileLabel: "お世話"/);
  assert.equal((nav.match(/mobileLabel:/g) ?? []).length, 5);
});

test("6種類のActivity表示はJST日時と水actionを示しmemoを表示しない", () => {
  const fedAt = "2026-08-11T23:05:00.000Z";
  const caredAt = "2026-08-12T00:20:00.000Z";
  assert.deepEqual(activity("PET_FEEDING_CREATED", { fedAt }), {
    summary: "林さんが「こむぎ」の食事を記録しました",
    detail: "2026/08/12 08:05"
  });
  assert.match(activity("PET_FEEDING_UPDATED", { fedAt }).summary, /食事を更新/);
  assert.match(activity("PET_FEEDING_DELETED", { fedAt }).summary, /食事記録を削除/);
  assert.equal(activity("PET_WATER_CREATED", { caredAt, action: "REPLACED", memo: "表示禁止" }).summary, "林さんが「こむぎ」の水を交換しました");
  assert.match(activity("PET_WATER_UPDATED", { caredAt, action: "REFILLED" }).detail ?? "", /補充/);
  assert.match(activity("PET_WATER_DELETED", { caredAt, action: "REFILLED" }).summary, /補充記録を削除/);
  assert.doesNotMatch(JSON.stringify(activity("PET_WATER_CREATED", { caredAt, action: "REPLACED", memo: "表示禁止" })), /表示禁止/);
});
