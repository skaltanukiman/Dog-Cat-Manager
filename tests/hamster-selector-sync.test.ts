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

test("記録カードのハムスターリンク後はURL・選択UI・登録先・取得対象が同じIDになる", () => {
  const page = source("src/app/records/page.tsx");
  const timeline = source("src/components/record-timeline.tsx");
  const queries = source("src/lib/record-queries.ts");
  const records = source("src/lib/records.ts");

  assert.match(
    timeline,
    /recordsUrl\(\{ basePath, scope: "hamster", includeScope: true, hamsterId: record\.hamster\.id \}\)/
  );
  assert.match(timeline, /\{record\.hamster\.name\}<\/Link>/);
  assert.match(
    records,
    /options\.scope === "household" \|\| \(options\.includeScope && options\.scope === "hamster"\)/
  );
  assert.match(page, /selectedHamsterId: filters\.hamsterId/);
  assert.match(queries, /hamsters\.find\(\(hamster\) => hamster\.id === filters\.selectedHamsterId\)/);
  assert.match(page, /selectedId=\{selectedHamsterId\}/);
  assert.match(page, /<RecordCreateForms hamsterId=\{selectedHamsterId\}/);
  assert.match(page, /<RecordTimeline records=\{data\.records\} scope=\{scope\} returnHamsterId=\{selectedHamsterId\}/);
});

test("共通選択コンポーネントを使う記録・清掃・体重・CSV出力の既存利用形態を維持する", () => {
  const selector = source("src/components/hamster-selector-input.tsx");
  const cleaning = source("src/app/cleaning/page.tsx");
  const weights = source("src/app/weights/page.tsx");
  const exportForm = source("src/components/weight-csv-export-form.tsx");

  assert.match(cleaning, /<HamsterSelectorInput[\s\S]*selectedId=\{selectedHamster\?\.id \?\? ""\}/);
  assert.match(weights, /<HamsterSelectorInput[\s\S]*selectedId=\{selectedHamster\?\.id \?\? ""\}/);
  assert.match(exportForm, /<HamsterSelectorInput[\s\S]*allOptionLabel="すべて"[\s\S]*autoSubmit=\{false\}/);
  assert.match(selector, /if \(!autoSubmit\)/);
  assert.match(selector, /<select[\s\S]*onChange=\{\(event\) => setSelectValue\(event\.currentTarget\.value\)\}/);
});
