import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function source(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("プルダウンは外部selectedIdと表示値を同期し、ユーザー変更時だけ自動送信する", () => {
  const selector = source("src/components/hamster-selector-input.tsx");
  const autoSubmitSelect = source("src/components/auto-submit-select.tsx");
  const syncBlock = selector.slice(
    selector.indexOf("const [previousSelectedId"),
    selector.indexOf('if (mode === "select")')
  );

  assert.match(selector, /const \[previousSelectedId, setPreviousSelectedId\] = useState\(selectedId\)/);
  assert.match(selector, /const \[selectValue, setSelectValue\] = useState\(selectedId\)/);
  assert.match(syncBlock, /if \(previousSelectedId !== selectedId\)/);
  assert.match(syncBlock, /setPreviousSelectedId\(selectedId\)/);
  assert.match(syncBlock, /setSelectValue\(selectedId\)/);
  assert.doesNotMatch(syncBlock, /requestSubmit|submitForm/);
  assert.equal(selector.match(/value=\{selectValue\}/g)?.length, 2);
  assert.equal(selector.match(/onChange=\{\(event\) => setSelectValue\(event\.currentTarget\.value\)\}/g)?.length, 2);
  assert.doesNotMatch(selector, /defaultValue=\{selectedId\}/);
  assert.match(autoSubmitSelect, /onChange\?\.\(event\)/);
  assert.match(autoSubmitSelect, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(selector, /disabled=\{disabled\}/);
  assert.match(selector, /allOptionLabel \? <option value="">/);
  assert.match(selector, /showEmptyOption \? <option value="">/);
  assert.match(selector, /\{hamster\.isActive \? "" : "（管理外）"\}/);
});

test("コンボボックスは外部selectedIdに名称・内部ID・hidden input・aria選択を同期する", () => {
  const combobox = source("src/components/hamster-combobox.tsx");
  const syncBlock = combobox.slice(
    combobox.indexOf("const selectedOptionName"),
    combobox.indexOf("const currentSelectedOption")
  );

  assert.match(combobox, /comboboxOptions\.find\(\(option\) => option\.id === selectedId\) \?\? null/);
  assert.match(syncBlock, /const selectedOptionName = selectedOption\?\.name \?\? ""/);
  assert.match(syncBlock, /const \[previousSelectedId, setPreviousSelectedId\] = useState\(selectedId\)/);
  assert.match(syncBlock, /const \[previousSelectedName, setPreviousSelectedName\] = useState\(selectedOptionName\)/);
  assert.match(syncBlock, /if \(previousSelectedId !== selectedId \|\| previousSelectedName !== selectedOptionName\)/);
  assert.match(syncBlock, /setSelectedValue\(selectedOption\?\.id \?\? ""\)/);
  assert.match(syncBlock, /setInputValue\(selectedOptionName\)/);
  assert.doesNotMatch(syncBlock, /requestSubmit|submitForm/);
  assert.match(combobox, /type="hidden" name=\{name\} value=\{selectedValue\} readOnly/);
  assert.match(combobox, /value=\{inputValue\}/);
  assert.match(combobox, /aria-selected=\{selectedValue === option\.id\}/);
  assert.match(combobox, /!option\.isAllOption && !option\.isActive/);
});

test("コンボボックスのprops同期は送信せず、ユーザーが候補を選んだ場合は従来どおり送信する", () => {
  const combobox = source("src/components/hamster-combobox.tsx");
  const selectOption = combobox.slice(
    combobox.indexOf("function selectOption"),
    combobox.indexOf("function findExactOption")
  );

  assert.match(selectOption, /setInputValue\(option\.name\)/);
  assert.match(selectOption, /setSelectedValue\(option\.id\)/);
  assert.match(selectOption, /syncHiddenInput\(option\.id\)/);
  assert.match(selectOption, /if \(shouldSubmit && autoSubmit\) \{\s*submitForm\(\)/);
  assert.match(combobox, /onClick=\{\(\) => selectOption\(option\)\}/);
});

test("Pet記録カードのリンク後はURL・選択UI・登録先・取得対象が同じIDになる", () => {
  const page = source("src/app/(app)/records/page.tsx");
  const timeline = source("src/components/pet-record-timeline.tsx");
  const queries = source("src/lib/pet-record-queries.ts");
  const records = source("src/lib/pet-records.ts");

  assert.match(
    timeline,
    /petRecordsUrl\(\{ scope: "pet", includeScope: true, petId: pet\.id, includeInactive: includeInactive \|\| !pet\.isActive \}\)/
  );
  assert.match(timeline, /\{pet\.name\}（\{speciesLabel\[pet\.species\]\}）<\/Link>/);
  assert.match(
    records,
    /options\.scope === "household" \|\| \(options\.includeScope && options\.scope === "pet"\)/
  );
  assert.match(page, /selectedPetId: filters\.petId/);
  assert.match(queries, /pets\.find\(\(pet\) => pet\.id === filters\.selectedPetId\)/);
  assert.match(page, /defaultValue=\{selectedPetId\}/);
  assert.match(page, /<PetRecordCreateForms key=\{data\.selectedPet\.id\} petId=\{data\.selectedPet\.id\}/);
  assert.match(page, /<PetRecordTimeline[\s\S]*records=\{data\.records\}[\s\S]*pets=\{data\.pets\}[\s\S]*scope=\{scope\}[\s\S]*returnPetId=\{selectedPetId\}/);
});

test("共通Hamster選択コンポーネントを使う清掃・CSV出力の既存利用形態を維持する", () => {
  const selector = source("src/components/hamster-selector-input.tsx");
  const cleaning = source("src/app/(app)/cleaning/page.tsx");
  const exportForm = source("src/components/weight-csv-export-form.tsx");

  assert.match(cleaning, /<HamsterSelectorInput[\s\S]*selectedId=\{selectedHamster\?\.id \?\? ""\}/);
  assert.match(exportForm, /<HamsterSelectorInput[\s\S]*allOptionLabel="すべて"[\s\S]*autoSubmit=\{false\}/);
  assert.match(selector, /if \(!autoSubmit\)/);
  assert.match(selector, /<select[\s\S]*onChange=\{\(event\) => setSelectValue\(event\.currentTarget\.value\)\}/);
});

test("通常画面は現在ユーザー・Householdのダッシュボード設定で共通の候補順を生成する", () => {
  const queries = source("src/lib/queries.ts");
  const recordQueries = source("src/lib/record-queries.ts");
  const cleaningPage = source("src/app/(app)/cleaning/page.tsx");
  const weightsPage = source("src/app/(app)/weights/page.tsx");
  const petWeightQueries = source("src/lib/pet-weight-queries.ts");
  const getOptionsSource = queries.slice(
    queries.indexOf("export async function getHamsterOptions"),
    queries.indexOf("export async function getHamsterSelectorMode")
  );
  const cleaningSource = queries.slice(
    queries.indexOf("export async function getCleaningPageData"),
    queries.indexOf("type WeightHistoryFilterMode")
  );
  const weightSource = queries.slice(
    queries.indexOf("export async function getWeightPageData"),
    queries.indexOf("export async function getDashboardSettingsPageData")
  );

  for (const querySource of [getOptionsSource, cleaningSource, weightSource, recordQueries]) {
    assert.match(
      querySource,
      /userId_householdId:\s*\{\s*userId: context\.user\.id,\s*householdId: context\.household\.id\s*\}/
    );
    assert.match(querySource, /dashboardBoardCount: true/);
    assert.match(querySource, /dashboardHamsters:\s*\{\s*orderBy: \{ sortOrder: "asc" \}/);
    assert.match(querySource, /orderHamstersForSelector\(/);
    assert.match(querySource, /setting\?\.dashboardHamsters\.map\(\(entry\) => entry\.hamsterId\) \?\? \[\]/);
  }

  assert.match(cleaningSource, /orderHamstersForSelector\([\s\S]*includeInactive\s*\)/);
  assert.match(weightSource, /orderHamstersForSelector\([\s\S]*includeInactive\s*\)/);
  assert.match(recordQueries, /orderHamstersForSelector\([\s\S]*true\s*\)/);
  assert.match(cleaningPage, /options=\{hamsters\}/);
  assert.match(petWeightQueries, /where: \{ householdId: context\.household\.id \}/);
  assert.match(weightsPage, /pets\.map\(\(pet\) =>/);
});

test("プルダウンとコンボボックスは候補配列順を共有し、検索時にも並べ替えない", () => {
  const selector = source("src/components/hamster-selector-input.tsx");
  const combobox = source("src/components/hamster-combobox.tsx");
  const filteredOptionsSource = combobox.slice(
    combobox.indexOf("const filteredOptions"),
    combobox.indexOf("function syncHiddenInput")
  );

  assert.match(selector, /options\.map\(\(hamster\) =>/);
  assert.match(filteredOptionsSource, /comboboxOptions\.filter\(/);
  assert.doesNotMatch(filteredOptionsSource, /\.sort\(/);
});

test("CSVの「すべて」は候補先頭を維持し、デモ取得処理には通常画面の候補順を適用しない", () => {
  const combobox = source("src/components/hamster-combobox.tsx");
  const exportForm = source("src/components/weight-csv-export-form.tsx");
  const demoQueries = source("src/lib/public-demo-queries.ts");

  assert.match(combobox, /\[\{ id: "", name: allOptionLabel,[\s\S]*\}, \.\.\.options\]/);
  assert.match(exportForm, /allOptionLabel="すべて"/);
  assert.doesNotMatch(demoQueries, /orderHamstersForSelector/);
});
