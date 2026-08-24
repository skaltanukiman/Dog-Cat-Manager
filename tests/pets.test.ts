import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPetSchema, updatePetSchema } from "../src/lib/schemas";
import { toDateInputValue } from "../src/lib/date";
import { breedMatchesQuery, findExactBreed, normalizeBreedSearch, type BreedOption } from "../src/lib/breed-search";
import { dogBreeds } from "../prisma/data/dog-breeds";
import { catBreeds } from "../prisma/data/cat-breeds";

const validPet = {
  name: "こむぎ",
  species: "DOG",
  breedId: "breed-dog-shiba",
  customBreedName: "",
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

test("Pet名は新規登録・更新ともに1文字以上15文字以下を許可する", () => {
  const maxLengthName = "あ".repeat(15);
  const tooLongName = "あ".repeat(16);

  assert.equal(createPetSchema.safeParse({ ...validPet, name: maxLengthName }).success, true);
  assert.equal(createPetSchema.safeParse({ ...validPet, name: tooLongName }).success, false);
  assert.equal(createPetSchema.safeParse({ ...validPet, name: "   " }).success, false);
  assert.equal(updatePetSchema.safeParse({ ...validPet, id: "pet-1", name: maxLengthName }).success, true);
  assert.equal(updatePetSchema.safeParse({ ...validPet, id: "pet-1", name: tooLongName }).success, false);
});

test("Pet更新入力はspeciesを受け付けず、改変されたspeciesを出力から除外する", () => {
  const result = updatePetSchema.safeParse({ ...validPet, id: "pet-1", species: "CAT" });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal("species" in result.data, false);
  assert.deepEqual(result.data, {
    id: "pet-1",
    name: validPet.name,
    breedId: validPet.breedId,
    customBreedName: null,
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

test("Pet更新ActionはDBのspeciesで品種を検証し、更新データへspeciesを含めない", async () => {
  const actions = await source("src/app/actions/pets.ts");
  const start = actions.indexOf("export async function updatePet");
  const end = actions.indexOf("export async function updatePetActiveStatus", start);
  const action = actions.slice(start, end);

  assert.match(action, /updatePetSchema\.safeParse\(Object\.fromEntries\(formData\)\)/);
  assert.match(action, /species:\s*true/);
  assert.match(action, /assertValidBreedChoice\(tx, data, pet\.species, pet\.breedId\)/);
  assert.doesNotMatch(action, /data\.species/);
  assert.match(action, /data: \{\s*\.\.\.data,/);
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
  const createForm = await source("src/components/pet-create-form.tsx");
  const combobox = await source("src/components/breed-combobox.tsx");

  assert.match(page, /where: \{ householdId: context\.household\.id \}/);
  for (const field of ["name", "sex", "birthDate", "adoptionDate", "memo"]) {
    assert.match(`${page}\n${createForm}`, new RegExp(`name="${field}"`));
  }
  for (const field of ["breedId", "customBreedName"]) assert.match(combobox, new RegExp(`name="${field}"`));
  assert.equal((combobox.match(/name="species"/g) ?? []).length, 1);
  assert.match(page, /<PetCreateForm breeds=\{breeds\} today=\{today\} \/>/);
  assert.match(createForm, /<PetCreateSpeciesBreedFields breeds=\{breeds\} \/>/);
  assert.match(page, /import \{ PetSpeciesBadge \} from "@\/components\/pet-species-badge";/);
  assert.match(page, /<PetSpeciesBadge species=\{pet\.species\} \/>/);
  assert.ok((`${page}\n${createForm}`.match(/className="h-10"/g) ?? []).length >= 10);
  assert.match(page, /<span className="flex h-10 w-full items-center rounded-md border border-slate-200 bg-slate-50 px-3">/);
  assert.match(page, /className="grid items-start gap-3 md:grid-cols-2 lg:grid-cols-4"/);
  assert.match(page, /種類は登録後変更できません/);
  for (const label of ["犬", "猫", "オス", "メス", "不明", "管理中", "管理終了"]) {
    assert.match(`${page}\n${createForm}\n${combobox}`, new RegExp(label));
  }
  assert.match(createForm, /<PetImageField petName="新しいPet"/);
  assert.match(page, /currentFileName=\{pet\.profileImageFileName\}/);
  assert.equal((`${page}\n${createForm}`.match(/name="name"[\s\S]{0,100}required[\s\S]{0,100}maxLength=\{15\}/g) ?? []).length, 2);
});

test("Petプロフィールの任意項目は新規登録・編集で統一して表示する", async () => {
  const [page, createForm, combobox, imageField] = await Promise.all([
    source("src/app/(app)/pets/page.tsx"),
    source("src/components/pet-create-form.tsx"),
    source("src/components/breed-combobox.tsx"),
    source("src/components/pet-image-field.tsx")
  ]);

  for (const label of ["性別", "誕生日", "お迎え日", "メモ"]) {
    assert.equal((`${page}\n${createForm}`.match(new RegExp(`${label}\\s*<span[^>]*>（任意）`, "g")) ?? []).length, 2);
  }
  assert.equal((combobox.match(/品種\s*<span[^>]*>（任意）/g) ?? []).length, 2);
  assert.match(imageField, /プロフィール画像\s*<span[^>]*>（任意）/);
  assert.doesNotMatch(`${page}\n${createForm}`, /名前\s*<span[^>]*>（任意）/);
  assert.doesNotMatch(combobox, /種類\s*<span[^>]*>（任意）/);
});

test("Pet新規登録は修正可能エラーでredirectせず、同じフォーム状態から再送信できる", async () => {
  const [actions, createForm, combobox] = await Promise.all([
    source("src/app/actions/pets.ts"),
    source("src/components/pet-create-form.tsx"),
    source("src/components/breed-combobox.tsx")
  ]);
  const createStart = actions.indexOf("export async function createPet");
  const updateStart = actions.indexOf("export async function updatePet", createStart);
  const createAction = actions.slice(createStart, updateStart);

  assert.match(createAction, /previousState: PetCreateActionState/);
  for (const status of ["petDuplicate", "petBreedInvalid"]) {
    assert.match(createAction, new RegExp(`createPetErrorState\\(previousState, [^)]*${status}`));
  }
  assert.match(createAction, /createPetErrorState\(previousState, petValidationStatus/);
  assert.match(createAction, /createPetErrorState\(previousState, petImageValidationStatus\(error\)\)/);
  assert.doesNotMatch(createAction, /redirect\(`?\/pets\?status=\$?\{?(?:petValidationStatus|petImageValidationStatus)/);
  assert.match(
    createAction,
    /redirect\(`\/pets\?status=created&createdPetId=\$\{encodeURIComponent\(createdPet\.id\)\}`\)/
  );

  assert.match(createForm, /useActionState\(createPet, INITIAL_ACTION_STATE\)/);
  assert.match(createForm, /event\.preventDefault\(\)/);
  assert.match(createForm, /new FormData\(event\.currentTarget\)/);
  assert.match(createForm, /startTransition\(\(\) => action\(formData\)\)/);
  assert.match(createForm, /<StatusMessage status=\{state\.status\} \/>/);
  for (const field of ["name", "sex", "birthDate", "adoptionDate", "memo"]) {
    assert.match(createForm, new RegExp(`value=\\{values\\.${field}\\}`));
  }
  assert.doesNotMatch(createForm, /form\.reset\(|setValues\(INITIAL_VALUES\)/);
  assert.match(combobox, /value=\{species\}/);
  assert.match(combobox, /value=\{query\}/);
  assert.match(combobox, /value=\{breedId\}/);
  assert.match(combobox, /value=\{customBreedName\}/);
});

test("品種入力はマスタ、自由入力、未入力を許可し、同時指定と100文字超を拒否する", () => {
  assert.equal(createPetSchema.safeParse(validPet).success, true);
  assert.equal(createPetSchema.safeParse({ ...validPet, breedId: "", customBreedName: "チワプー" }).success, true);
  assert.equal(createPetSchema.safeParse({ ...validPet, breedId: "", customBreedName: "" }).success, true);
  assert.equal(createPetSchema.safeParse({ ...validPet, customBreedName: "チワプー" }).success, false);
  assert.equal(createPetSchema.safeParse({ ...validPet, breedId: "", customBreedName: "あ".repeat(100) }).success, true);
  assert.equal(createPetSchema.safeParse({ ...validPet, breedId: "", customBreedName: "あ".repeat(101) }).success, false);
});

const shiba: BreedOption = {
  id: "shiba", species: "DOG", nameJa: "柴犬", nameKana: "しばいぬ", nameEn: "Shiba Inu",
  isPopular: true, sortOrder: 0
};

test("品種検索は日本語・かな・英語の部分一致と表記正規化に対応する", () => {
  for (const query of ["柴", "しば", "Shiba", "SHIBA", "Ｓｈｉｂａ"]) {
    assert.equal(breedMatchesQuery(shiba, query), true);
  }
  assert.equal(normalizeBreedSearch("トイ・プードル"), normalizeBreedSearch("トイ プードル"));
  assert.equal(findExactBreed([shiba], "shiba inu")?.id, "shiba");
});

test("Breed seedデータはspecies内でcanonical名が重複せず、十分な範囲を持つ", () => {
  assert.ok(dogBreeds.length >= 200);
  assert.ok(catBreeds.length >= 60);
  assert.equal(new Set(dogBreeds.map((breed) => breed.nameJa)).size, dogBreeds.length);
  assert.equal(new Set(catBreeds.map((breed) => breed.nameJa)).size, catBreeds.length);
});

test("新migrationは旧breedを自由入力へ退避してから削除し、排他制約と安全な外部キーを作る", async () => {
  const migration = await source("prisma/migrations/20260824120000_add_breed_master/migration.sql");
  const copyIndex = migration.indexOf('UPDATE "pets" SET "custom_breed_name" = "breed"');
  const dropIndex = migration.indexOf('ALTER TABLE "pets" DROP COLUMN "breed"');
  assert.ok(copyIndex >= 0 && dropIndex > copyIndex);
  assert.match(migration, /pets_breed_choice_check/);
  assert.match(migration, /ON DELETE RESTRICT/);
});

test("Breed seedはupsertで再実行可能かつspecies完全一致だけをbackfillする", async () => {
  const seed = await source("prisma/seed-breeds.ts");
  assert.match(seed, /prisma\.breed\.upsert/);
  assert.match(seed, /species:\s*breed\.species/);
  assert.match(seed, /customBreedName:\s*breed\.nameJa/);
  assert.doesNotMatch(seed, /contains:|startsWith:|levenshtein|similarity/);
});

test("Pet ActionはbreedIdの存在・species・activeを検証し、既存inactive参照だけ維持する", async () => {
  const actions = await source("src/app/actions/pets.ts");
  assert.match(actions, /tx\.breed\.findFirst/);
  assert.match(actions, /species,/);
  assert.match(actions, /isActive:\s*true/);
  assert.match(actions, /allowInactiveBreedId/);
  assert.match(actions, /pet\.breedId === data\.breedId/);
  assert.match(actions, /pet\.customBreedName === data\.customBreedName/);
});

test("品種コンボボックスはspecies変更で再生成され、ARIAとキーボード操作を備える", async () => {
  const component = await source("src/components/breed-combobox.tsx");
  assert.match(component, /key=\{species \|\| "unset"\}/);
  assert.match(component, /role="combobox"/);
  assert.match(component, /role="listbox"/);
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) assert.match(component, new RegExp(key));
  assert.match(component, /data-dirty-control/);
});
