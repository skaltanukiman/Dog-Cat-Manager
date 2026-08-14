import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function actionSource(actions: string, name: string) {
  const start = actions.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} が見つかりません。`);
  const next = actions.indexOf("export async function", start + 1);
  return actions.slice(start, next === -1 ? undefined : next);
}

test("PetWeightRecordはPet専用Decimalモデルを持つ", async () => {
  const schema = await source("prisma/schema.prisma");
  const petWeight = schema.slice(schema.indexOf("model PetWeightRecord {"), schema.indexOf("enum PetSpecies"));

  assert.match(petWeight, /petId\s+String\s+@map\("pet_id"\)/);
  assert.match(petWeight, /Pet\s+@relation\(fields: \[petId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(petWeight, /recordDate\s+DateTime\s+@map\("record_date"\) @db\.Date/);
  assert.match(petWeight, /weightKg\s+Decimal\s+@map\("weight_kg"\) @db\.Decimal\(5, 2\)/);
  assert.match(petWeight, /memo\s+String\?\s+@db\.VarChar\(500\)/);
  assert.match(petWeight, /@@unique\(\[petId, recordDate\]\)/);
  assert.match(petWeight, /@@index\(\[recordDate\]\)/);
  assert.doesNotMatch(petWeight, /@@index\(\[petId, recordDate\]\)/);
  assert.match(schema, /weightRecords\s+PetWeightRecord\[\]/);
});

test("新規migrationはPet体重テーブル・一意制約・Cascade FKだけを追加する", async () => {
  const migration = await source("prisma/migrations/20260812120000_add_pet_weight_records/migration.sql");
  assert.match(migration, /CREATE TABLE "pet_weight_records"/);
  assert.match(migration, /"weight_kg" DECIMAL\(5,2\) NOT NULL/);
  assert.match(migration, /UNIQUE INDEX "pet_weight_records_pet_id_record_date_key"/);
  assert.match(migration, /INDEX "pet_weight_records_record_date_idx"/);
  assert.match(migration, /REFERENCES "pets"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /PET_WEIGHT_CREATED/);
  assert.match(migration, /PET_WEIGHT_UPDATED/);
  assert.match(migration, /PET_WEIGHT_DELETED/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE "pets"/);
});

test("Pet体重Actionは全更新でVIEWERと最新membershipを拒否する", async () => {
  const actions = await source("src/app/actions/pet-weights.ts");
  for (const name of ["createPetWeightRecord", "updatePetWeightRecord", "deletePetWeightRecord"]) {
    const action = actionSource(actions, name);
    assert.match(action, /getRequiredHouseholdMutationContext\("\/weights"\)/);
    assert.match(action, /assertCurrentPetWeightMutationPermission\(tx, context\.household\.id, context\.user\.id\)/);
  }
  assert.match(actions, /canEditHouseholdSharedData\(membership\.role\)/);
});

test("Pet体重ActionはPet・記録を現在Householdと管理中状態で絞る", async () => {
  const actions = await source("src/app/actions/pet-weights.ts");
  const create = actionSource(actions, "createPetWeightRecord");
  const update = actionSource(actions, "updatePetWeightRecord");
  const remove = actionSource(actions, "deletePetWeightRecord");

  assert.match(create, /where: \{ id: result\.data\.petId, householdId: context\.household\.id \}/);
  assert.match(create, /if \(!pet\.isActive\) throw new InactivePetWeightMutationError/);
  for (const action of [update, remove]) {
    assert.match(action, /id: result\.data\.id, petId: result\.data\.petId, pet: \{ householdId: context\.household\.id \}/);
    assert.match(action, /if \(!record\.pet\.isActive\) throw new InactivePetWeightMutationError/);
    assert.match(action, /pet: \{ householdId: context\.household\.id, isActive: true \}/);
  }
});

test("Pet体重Actionは同日重複を利用者向けstatusへ変換し、変更なし更新を避ける", async () => {
  const actions = await source("src/app/actions/pet-weights.ts");
  assert.match(actions, /isPrismaUniqueConstraintError\(error\).*petWeightRedirect\(petId, "duplicate"/);
  assert.match(actions, /record\.weightKg\.equals\(nextWeight\)/);
  assert.match(actions, /record\.memo === result\.data\.memo/);
  assert.match(actions, /throw new PetWeightUnchangedError/);
});

test("Pet体重queryはHousehold境界・管理終了閲覧・20件ページング・グラフ上限を持つ", async () => {
  const query = await source("src/lib/pet-weight-queries.ts");
  assert.match(query, /where: \{ householdId: context\.household\.id \}/);
  assert.match(query, /includeInactive \? allPets : allPets\.filter\(\(pet\) => pet\.isActive\)/);
  assert.match(query, /PET_WEIGHT_HISTORY_PAGE_SIZE = 20/);
  assert.match(query, /skip: \(currentPage - 1\) \* PET_WEIGHT_HISTORY_PAGE_SIZE/);
  assert.match(query, /take: PET_WEIGHT_HISTORY_PAGE_SIZE/);
  assert.match(query, /PET_WEIGHT_CHART_MAX_POINTS = 365/);
});

test("Pet版weights画面はkg・species・管理終了閲覧を提供する", async () => {
  const page = await source("src/app/(app)/weights/page.tsx");
  const chart = await source("src/components/pet-weight-chart.tsx");
  const history = await source("src/components/pet-weight-history-list.tsx");

  assert.match(page, /犬・猫の日付ごとの体重を記録し、推移を確認します。/);
  assert.match(page, /name="petId"/);
  assert.match(page, /SPECIES_LABELS\[pet\.species\]/);
  assert.match(page, /import \{ PetSpeciesBadge \} from "@\/components\/pet-species-badge";/);
  assert.match(page, /<PetSpeciesBadge species=\{selectedPet\.species\} \/>/);
  assert.match(page, /管理終了したPetも含む/);
  assert.match(page, /href="\/pets"/);
  assert.match(page, /name="weightKg"/);
  assert.match(page, /体重\(kg\)/);
  assert.match(page, /readOnly=\{!canMutateSelectedPet\}/);
  assert.match(chart, /dataKey="weightKg"/);
  assert.match(chart, /unit="kg"/);
  assert.match(history, /name="memo"/);
});
