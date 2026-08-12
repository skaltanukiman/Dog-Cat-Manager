import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPetSchema, updatePetSchema } from "../src/lib/schemas";
import { toDateInputValue } from "../src/lib/date";

const validPet = {
  name: "こむぎ",
  species: "DOG",
  breed: "柴犬",
  sex: "UNKNOWN",
  birthDate: "2024-05-06",
  adoptionDate: "2024-07-08",
  memo: "元気"
};

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("DOGとCATだけをPetとして登録入力に使用できる", () => {
  assert.equal(createPetSchema.safeParse(validPet).success, true);
  assert.equal(createPetSchema.safeParse({ ...validPet, species: "CAT" }).success, true);
  assert.equal(createPetSchema.safeParse({ ...validPet, species: undefined }).success, false);
  assert.equal(createPetSchema.safeParse({ ...validPet, species: "BIRD" }).success, false);
});

test("Pet更新入力はspeciesを受け付けず、改変されたspeciesを出力から除外する", () => {
  const result = updatePetSchema.safeParse({ ...validPet, id: "pet-1", species: "CAT" });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal("species" in result.data, false);
  assert.deepEqual(result.data, {
    id: "pet-1",
    name: validPet.name,
    breed: validPet.breed,
    sex: validPet.sex,
    birthDate: new Date("2024-05-06T00:00:00.000Z"),
    adoptionDate: new Date("2024-07-08T00:00:00.000Z"),
    memo: validPet.memo
  });
});

test("Petの性別はMALE、FEMALE、UNKNOWNだけを許可する", () => {
  for (const sex of ["MALE", "FEMALE", "UNKNOWN"]) {
    assert.equal(createPetSchema.safeParse({ ...validPet, sex }).success, true);
  }
  assert.equal(createPetSchema.safeParse({ ...validPet, sex: "OTHER" }).success, false);
});

test("誕生日とお迎え日の暦日をタイムゾーン変換せず維持する", () => {
  const result = createPetSchema.safeParse(validPet);
  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(toDateInputValue(result.data.birthDate!), "2024-05-06");
  assert.equal(toDateInputValue(result.data.adoptionDate!), "2024-07-08");
});

test("PetモデルはHousehold必須・Household内名前一意・指定indexを持つ", async () => {
  const schema = await source("prisma/schema.prisma");
  const petModel = schema.slice(schema.indexOf("model Pet {"), schema.indexOf("enum PetSpecies"));

  assert.match(petModel, /householdId\s+String\s+@map\("household_id"\)/);
  assert.match(petModel, /onDelete: Cascade/);
  assert.match(petModel, /@@unique\(\[householdId, name\]\)/);
  assert.match(petModel, /@@index\(\[householdId, createdAt\]\)/);
  assert.match(petModel, /@@index\(\[householdId, species\]\)/);
  assert.match(petModel, /profileImageFileName\s+String\?/);
  assert.match(schema, /pets\s+Pet\[\]/);
});

test("migrationはPetだけを追加しHousehold単位の同名制約を作る", async () => {
  const migration = await source("prisma/migrations/20260811120000_add_pets/migration.sql");

  assert.match(migration, /CREATE TYPE "PetSpecies" AS ENUM \('DOG', 'CAT'\)/);
  assert.match(migration, /CREATE TYPE "PetSex" AS ENUM \('MALE', 'FEMALE', 'UNKNOWN'\)/);
  assert.match(migration, /UNIQUE INDEX "pets_household_id_name_key" ON "pets"\("household_id", "name"\)/);
  assert.match(migration, /REFERENCES "households"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM "hamsters"|ALTER TABLE "hamsters"/);
});

test("Pet ActionはVIEWERとHousehold境界を登録・更新・状態変更で再確認する", async () => {
  const actions = await source("src/app/actions/pets.ts");

  for (const actionName of ["createPet", "updatePet", "updatePetActiveStatus"]) {
    const start = actions.indexOf(`export async function ${actionName}`);
    assert.notEqual(start, -1);
    const next = actions.indexOf("export async function", start + 1);
    const action = actions.slice(start, next === -1 ? undefined : next);
    assert.match(action, /getRequiredHouseholdMutationContext\("\/pets"\)/);
    assert.match(action, /assertCurrentPetMutationPermission\(tx, context\.household\.id, context\.user\.id\)/);
  }

  assert.match(actions, /where: \{ id, householdId: context\.household\.id \}/);
  assert.match(actions, /where: \{ id, householdId: context\.household\.id, updatedAt: pet\.updatedAt \}/);
  assert.match(actions, /where: \{ id: result\.data\.id, householdId: context\.household\.id \}/);
  assert.match(actions, /canEditHouseholdSharedData\(membership\.role\)/);
});

test("Pet更新Actionはspeciesを取得・差分判定・更新データに含めない", async () => {
  const actions = await source("src/app/actions/pets.ts");
  const start = actions.indexOf("export async function updatePet");
  const end = actions.indexOf("export async function updatePetActiveStatus", start);
  const action = actions.slice(start, end);

  assert.match(action, /updatePetSchema\.safeParse\(Object\.fromEntries\(formData\)\)/);
  assert.doesNotMatch(action, /species:\s*true/);
  assert.doesNotMatch(action, /pet\.species|data\.species/);
  assert.match(action, /data\s*$/m);
});

test("管理終了はisActive更新だけを行いPet本体を保持する", async () => {
  const actions = await source("src/app/actions/pets.ts");
  const start = actions.indexOf("export async function updatePetActiveStatus");
  const action = actions.slice(start);

  assert.match(action, /data: \{ isActive: result\.data\.isActive \}/);
  assert.doesNotMatch(action, /pet\.delete|deleteMany/);
});

test("Pet画面は選択中Householdだけを一覧表示し、speciesを新規登録時のみ選択できる", async () => {
  const page = await source("src/app/(app)/pets/page.tsx");

  assert.match(page, /where: \{ householdId: context\.household\.id \}/);
  for (const field of ["name", "breed", "sex", "birthDate", "adoptionDate", "memo"]) {
    assert.match(page, new RegExp(`name="${field}"`));
  }
  assert.match(page, /<select name="species" required defaultValue="">/);
  assert.equal((page.match(/name="species"/g) ?? []).length, 1);
  assert.match(page, /SPECIES_LABELS\[pet\.species\]/);
  assert.match(page, /種類は登録後変更できません/);
  for (const label of ["犬", "猫", "オス", "メス", "不明", "管理中", "管理終了"]) {
    assert.match(page, new RegExp(label));
  }
  assert.doesNotMatch(page, /profileImage/);
});
