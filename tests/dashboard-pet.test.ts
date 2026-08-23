import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getDashboardPetRemovalPosition,
  getDashboardPetSelectionError,
  moveDashboardPetId,
  normalizeDashboardPetIds,
  pickDashboardPets,
  resizeDashboardPetIds,
  toggleDashboardPetId
} from "../src/lib/dashboard-settings";

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = readSource("src/app/(app)/page.tsx");
const speciesBadge = readSource("src/components/pet-species-badge.tsx");
const queries = readSource("src/lib/queries.ts");
const settingsAction = readSource("src/app/actions/settings.ts");
const settingsForm = readSource("src/components/dashboard-settings-form.tsx");
const schema = readSource("prisma/schema.prisma");
const migration = readSource("prisma/migrations/20260813090000_add_dashboard_pets/migration.sql");

test("Pet表示順は保存順を優先し、削除済みIDを除いてfallbackで補完する", () => {
  assert.deepEqual(
    normalizeDashboardPetIds(["active-1", "active-2", "inactive-1"], 3, ["inactive-1", "deleted", "active-2"]),
    ["inactive-1", "active-2", "active-1"]
  );
  assert.deepEqual(normalizeDashboardPetIds(["active-1", "active-2", "inactive-1"], 2, []), ["active-1", "active-2"]);
});

test("boardCount以下は全Pet、超過時は選択順を返し、管理終了Petも保存済みなら表示する", () => {
  const pets = [
    { id: "active-1", isActive: true },
    { id: "active-2", isActive: true },
    { id: "inactive-1", isActive: false }
  ];

  assert.deepEqual(pickDashboardPets(pets, 30, []).map((pet) => pet.id), ["active-1", "active-2", "inactive-1"]);
  assert.deepEqual(pickDashboardPets(pets, 2, ["inactive-1", "active-2"]).map((pet) => pet.id), ["inactive-1", "active-2"]);
});

test("Pet選択の解除・再選択・並び替え・表示数縮小は順序を維持する", () => {
  const initial = ["pet-1", "pet-2", "pet-3"];
  const position = getDashboardPetRemovalPosition(initial, "pet-2");
  const removed = toggleDashboardPetId(initial, "pet-2", 3);

  assert.deepEqual(removed, ["pet-1", "pet-3"]);
  assert.deepEqual(toggleDashboardPetId(removed, "pet-2", 3, position), initial);
  assert.deepEqual(moveDashboardPetId(initial, "pet-3", "pet-1", "before"), ["pet-3", "pet-1", "pet-2"]);
  assert.deepEqual(resizeDashboardPetIds(initial, ["pet-3", "pet-1", "pet-2"], 2), ["pet-3", "pet-1"]);
});

test("Pet選択検証はduplicate・unknown・他Household相当ID・過不足を拒否する", () => {
  const validIds = ["pet-a", "pet-b"];

  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-a", "pet-a"]), "duplicate");
  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-a", "unknown"]), "unknown");
  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-a", "other-household-pet"]), "unknown");
  assert.equal(getDashboardPetSelectionError(validIds, 1, ["pet-a", "pet-b"]), "tooMany");
  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-a"]), "tooFew");
  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-b", "pet-a"]), null);
});

test("Dashboard queryは現在HouseholdのPetだけを取得し、管理中優先の決定的fallbackを使う", () => {
  assert.match(queries, /prisma\.pet\.findMany\(\{\s*where: \{ householdId: context\.household\.id \}/);
  assert.match(queries, /orderBy: \[\{ isActive: "desc" \}, \{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(queries, /dashboardPets: \{\s*orderBy: \{ sortOrder: "asc" \}/);
  assert.match(queries, /pickDashboardPets\(pets, boardCount, selectedIds\)/);
});

test("Care集計は現在のお世話日と表示Pet IDを種類別一括queryへ渡す", () => {
  assert.match(queries, /getCareDayRecordDate\(new Date\(\), careDayStartMinutes\)/);
  for (const model of ["petFeedingRecord", "petWaterRecord", "petWalkRecord", "petLitterRecord"]) {
    assert.match(queries, new RegExp(`prisma\\.${model}\\.findMany\\([\\s\\S]*?petId: \\{ in: dashboardPetIds \\}`));
  }
  assert.match(queries, /pet: \{ householdId: context\.household\.id, species: "DOG" \}/);
  assert.match(queries, /pet: \{ householdId: context\.household\.id, species: "CAT" \}/);
  assert.match(queries, /summarizePetCareRecords\(feedingRecords\)/);
  assert.match(queries, /summarizePetCareRecords\(waterRecords\)/);
});

test("カードは食事・水・DOG散歩・CATトイレの件数と最新内容、未入力を表示する", () => {
  assert.match(page, /\$\{count\}回｜\$\{formatTimeJst\(occurredAt\)\}/);
  assert.match(page, /suffix \? `｜\$\{suffix\}` : ""/);
  assert.doesNotMatch(page, /回 \/ 最終/);
  assert.match(page, /careSummary\(pet\.todayFeeding\.count, pet\.todayFeeding\.latest\.fedAt\)/);
  assert.match(page, /pet\.todayWater\.latest\.caredAt[\s\S]*PET_WATER_ACTION_LABELS/);
  assert.match(page, /pet\.species === "DOG"/);
  assert.match(page, /pet\.todayWalk\.latest\.startedAt/);
  assert.match(page, /pet\.todayWalk\.latest\.durationMinutes == null/);
  assert.match(page, /PET_LITTER_ACTION_LABELS\[pet\.todayLitter\.latest\.action\]/);
  assert.equal((page.match(/"未入力"/g) ?? []).length, 5);
});

test("DashboardのCareサマリー値は共通badgeで折り返さない", () => {
  assert.match(page, /const DASHBOARD_VALUE_CLASS =\s*"[^"]*whitespace-nowrap/);
  assert.match(page, /const DASHBOARD_EMPTY_VALUE_CLASS =\s*"[^"]*whitespace-nowrap/);
  assert.doesNotMatch(page, /DASHBOARD_(?:EMPTY_)?VALUE_CLASS =\s*"[^"]*(?:whitespace-normal|break-words)/);
});

test("Dashboard Care rows wrap only when the label and value no longer fit", () => {
  const careRowClass = /flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-3/g;

  assert.equal(page.match(careRowClass)?.length, 5);
  assert.equal(page.match(/<dd className="text-right">/g)?.length, 5);
  assert.doesNotMatch(page, /<dd className="ml-auto text-right">/);
  assert.doesNotMatch(page, /sm:flex-row|sm:items-center|min-\[\d+px\]:flex-row/);
});

test("Dashboard species badge and Care icon colors use semantic tokens", () => {
  assert.match(speciesBadge, /DOG: "border-species-dog\/20 bg-species-dog-soft text-species-dog"/);
  assert.match(speciesBadge, /CAT: "border-species-cat\/20 bg-species-cat-soft text-species-cat"/);
  assert.match(speciesBadge, /inline-flex rounded-full border px-2 py-0\.5 text-xs font-medium/);
  assert.match(page, /<PetSpeciesBadge species=\{pet\.species\} \/>/);
  assert.match(page, /<Scale className="h-4 w-4 text-brand-dark"/);
  assert.match(page, /<Utensils className="h-4 w-4 text-accent"/);
  assert.match(page, /<Droplets className="h-4 w-4 text-brand"/);
  assert.match(page, /<Footprints className="h-4 w-4 text-care-walk"/);
  assert.match(page, /<ClipboardCheck className="h-4 w-4 text-care-litter"/);
});

test("最新体重だけをDecimalのまま表示し、PetThumbnailと犬猫・管理状態を描画する", () => {
  assert.match(queries, /weightRecords: \{[\s\S]*take: 1[\s\S]*weightKg: true/);
  assert.match(page, /latestWeight\.weightKg\.toString\(\)/);
  assert.doesNotMatch(page, /Number\(latestWeight\.weightKg\)|parseFloat/);
  assert.match(page, /<PetThumbnail/);
  assert.match(page, /import \{ PetSpeciesBadge \} from "@\/components\/pet-species-badge";/);
  assert.match(page, /pet\.isActive \? "管理中" : "管理終了"/);
});

test("管理中PetだけCare導線を持ち、Recordsと空Householdのペット登録導線を維持する", () => {
  assert.match(page, /pet\.isActive \? \([\s\S]*href=\{`\/care\?petId=/);
  assert.match(page, /`\/records\?petId=\$\{encodeURIComponent\(pet\.id\)\}&scope=pet&includeInactive=1`/);
  assert.match(page, /<EmptyState title="ペットがまだ登録されていません。" href="\/pets"/);
  assert.match(page, /href="\/pets"[\s\S]*ペット登録/);
});

test("DashboardPet migrationはadditiveでunique・index・両Cascadeだけを追加する", () => {
  assert.match(schema, /dashboardPets\s+DashboardPet\[\]/);
  assert.match(schema, /dashboardEntries\s+DashboardPet\[\]/);
  assert.match(schema, /model DashboardPet[\s\S]*@@unique\(\[settingId, petId\]\)[\s\S]*@@index\(\[petId\]\)/);
  assert.match(migration, /CREATE TABLE "dashboard_pets"/);
  assert.match(migration, /REFERENCES "app_settings"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "pets"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /DROP|TRUNCATE|RENAME/i);
});

test("設定UIと保存ActionはpetIds・species・状態・sortOrderを使う", () => {
  assert.match(settingsForm, /name="petIds"/);
  assert.match(settingsForm, /SPECIES_LABELS\[pet\.species\]/);
  assert.match(settingsForm, /管理終了/);
  assert.match(settingsAction, /petIds: formData\.getAll\("petIds"\)/);
  assert.match(settingsAction, /prisma\.pet\.findMany\([\s\S]*householdId: context\.household\.id/);
  assert.match(settingsAction, /tx\.dashboardPet\.deleteMany/);
  assert.match(settingsAction, /tx\.dashboardPet\.create\([\s\S]*sortOrder: index/);
  assert.match(settingsAction, /updateHouseholdRevisions/);
  assert.match(settingsAction, /publishHouseholdChangesSafely/);
  assert.match(settingsAction, /\{ path: "\/", type: "layout" \}/);
});
