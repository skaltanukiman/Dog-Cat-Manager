import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPetWeightCsvRows,
  createPetWeightCsvRecordWhere,
  formatPetWeightCsvTimestamp,
  getPetWeightCsvFilename,
  parsePetWeightCsvExportOptions,
  PetWeightCsvExportValidationError,
  toPetWeightCsv,
  type PetWeightCsvRecord
} from "../src/lib/pet-weight-csv-export";

const record: PetWeightCsvRecord = {
  id: "weight-1",
  petId: "pet-1",
  recordDate: new Date("2026-08-01T00:00:00.000Z"),
  weightKg: { toString: () => "5.30" },
  memo: "夕食前",
  createdAt: new Date("2026-08-23T12:15:32.000Z"),
  updatedAt: new Date("2026-08-23T12:16:33.000Z"),
  pet: { id: "pet-1", name: "ソラ", species: "DOG" }
};

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("標準CSVは固定のheader・列順でkg Decimalと空メモを出力する", () => {
  const rows = buildPetWeightCsvRows([{ ...record, memo: null }], "standard");

  assert.deepEqual(rows[0], ["date", "pet_name", "species", "weight_kg", "memo"]);
  assert.deepEqual(rows[1], ["2026-08-01", "ソラ", "DOG", "5.30", null]);
});

test("詳細CSVは将来のimport用固定識別列を定義順で出力する", () => {
  const rows = buildPetWeightCsvRows([record], "detailed");

  assert.deepEqual(rows[0], [
    "app_id", "record_type", "schema_version", "record_id", "pet_id", "date", "pet_name", "species", "weight_kg", "memo", "created_at", "updated_at"
  ]);
  assert.deepEqual(rows[1], [
    "dog-cat-manager", "pet_weight_record", "1", "weight-1", "pet-1", "2026-08-01", "ソラ", "DOG", "5.30", "夕食前", "2026-08-23T21:15:32.000+09:00", "2026-08-23T21:16:33.000+09:00"
  ]);
  assert.equal(formatPetWeightCsvTimestamp(record.createdAt), "2026-08-23T21:15:32.000+09:00");
});

test("CSVはBOM付きで、入力文字のCSV escapingとFormula Injection対策を両立する", () => {
  const csv = toPetWeightCsv([
    { ...record, pet: { ...record.pet, name: "=SUM(1,1),\n\"ソラ\"" }, memo: "+memo" },
    { ...record, id: "weight-2", petId: "pet-2", pet: { ...record.pet, id: "pet-2", name: "-name" }, memo: "@memo" }
  ], "standard");

  assert.ok(csv.startsWith("\uFEFFdate,pet_name,species,weight_kg,memo\r\n"));
  assert.match(csv, /"'=SUM\(1,1\),\n""ソラ"""/);
  assert.match(csv, /,'\+memo\r\n/);
  assert.match(csv, /,'-name,DOG/);
  assert.match(csv, /,'@memo\r\n/);
});

test("0件でもheaderだけのCSVを出力する", () => {
  assert.equal(toPetWeightCsv([], "detailed"), "\uFEFFapp_id,record_type,schema_version,record_id,pet_id,date,pet_name,species,weight_kg,memo,created_at,updated_at\r\n");
});

test("formatと年月を検証し、未指定formatは標準にする", () => {
  assert.deepEqual(parsePetWeightCsvExportOptions(new URLSearchParams()), { petId: undefined, month: undefined, format: "standard" });
  assert.deepEqual(parsePetWeightCsvExportOptions(new URLSearchParams({ petId: "pet-1", month: "2026-08", format: "detailed" })), { petId: "pet-1", month: "2026-08", format: "detailed" });
  assert.throws(() => parsePetWeightCsvExportOptions(new URLSearchParams({ month: "2026-13" })), PetWeightCsvExportValidationError);
  assert.throws(() => parsePetWeightCsvExportOptions(new URLSearchParams({ format: "unknown" })), PetWeightCsvExportValidationError);
  assert.equal(getPetWeightCsvFilename(undefined, "standard"), "dog_cat_weights.csv");
  assert.equal(getPetWeightCsvFilename("2026-08", "detailed"), "dog_cat_weights_detailed_2026-08.csv");
});

test("Householdを必須にして全Pet・Pet・month・Pet+monthの4条件をDB whereへ組み立てる", () => {
  assert.deepEqual(createPetWeightCsvRecordWhere("household-1", undefined, undefined), {
    pet: { householdId: "household-1" }
  });
  assert.deepEqual(createPetWeightCsvRecordWhere("household-1", "pet-1", undefined), {
    pet: { householdId: "household-1" }, petId: "pet-1"
  });
  assert.deepEqual(createPetWeightCsvRecordWhere("household-1", undefined, "2026-08"), {
    pet: { householdId: "household-1" },
    recordDate: { gte: new Date("2026-08-01T00:00:00.000Z"), lt: new Date("2026-09-01T00:00:00.000Z") }
  });
  assert.deepEqual(createPetWeightCsvRecordWhere("household-1", "pet-1", "2026-08"), {
    pet: { householdId: "household-1" },
    petId: "pet-1",
    recordDate: { gte: new Date("2026-08-01T00:00:00.000Z"), lt: new Date("2026-09-01T00:00:00.000Z") }
  });
});

test("download routeは全Household取得を避け、Pet・month・headersを明示する", async () => {
  const route = await source("src/app/(app)/weights/export/download/route.ts");

  assert.match(route, /getRequiredHouseholdContext\(\)/);
  assert.match(route, /createPetWeightCsvRecordWhere\(context\.household\.id, petId, month\)/);
  assert.match(route, /where: \{ id: petId, householdId: context\.household\.id \}/);
  assert.match(route, /orderBy: \[\{ recordDate: "asc" \}, \{ petId: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(route, /"Content-Type": "text\/csv; charset=utf-8"/);
  assert.match(route, /"Content-Disposition":/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
  assert.doesNotMatch(route, /getRequiredHouseholdMutationContext/);
});

test("export画面は管理終了Petを含む選択肢と標準・詳細の2プリセットだけを提供する", async () => {
  const page = await source("src/app/(app)/weights/export/page.tsx");
  const form = await source("src/components/pet-weight-csv-export-form.tsx");
  const weightsPage = await source("src/app/(app)/weights/page.tsx");

  assert.match(page, /getPetWeightExportPets/);
  assert.match(form, /pet\.isActive \? "" : "・管理終了"/);
  assert.match(form, /name="format" value="standard" defaultChecked/);
  assert.match(form, /name="format" value="detailed"/);
  assert.doesNotMatch(form, /timezone|name="columns"|CSV import/);
  assert.match(weightsPage, /href="\/weights\/export"/);
});
