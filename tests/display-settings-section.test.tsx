import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  DisplaySettingsSection,
  getDisplaySettingsSummary
} from "../src/components/display-settings-section";

function renderDisplaySettings(
  hamsterSelectorMode: "combobox" | "select" = "select",
  recordTimelineDefaultScope: "hamster" | "household" = "hamster",
  cleaningMobileDefaultDateFilter: "today" | "all" = "today"
) {
  return renderToStaticMarkup(
    <form data-dirty-watch>
      <DisplaySettingsSection
        hamsterSelectorMode={hamsterSelectorMode}
        recordTimelineDefaultScope={recordTimelineDefaultScope}
        cleaningMobileDefaultDateFilter={cleaningMobileDefaultDateFilter}
      />
    </form>
  );
}

test("スマホ向け画面表示設定は現在値の日本語要約を持ち、初期状態で閉じている", () => {
  const markup = renderDisplaySettings();

  assert.match(markup, /<button[^>]*type="button"[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
  assert.match(markup, />画面表示の設定</);
  assert.match(markup, /data-display-settings-summary="true">プルダウン式・選択中のハムスター・当日のみ</);
  assert.match(markup, /data-display-settings-content="true" data-mobile-open="false" class="hidden[^"]*md:block/);
});

test("閉じた状態でも既存の3グループ6入力と選択値をDOMに保持する", () => {
  const markup = renderDisplaySettings();
  const expectedInputs = [
    ['hamsterSelectorMode', "combobox"],
    ['hamsterSelectorMode', "select"],
    ['recordTimelineDefaultScope', "hamster"],
    ['recordTimelineDefaultScope', "household"],
    ['cleaningMobileDefaultDateFilter', "today"],
    ['cleaningMobileDefaultDateFilter', "all"]
  ] as const;

  for (const [name, value] of expectedInputs) {
    assert.match(markup, new RegExp(`<input[^>]*type="radio"[^>]*name="${name}"[^>]*value="${value}"`));
  }
  assert.match(
    markup,
    /<input(?=[^>]*name="hamsterSelectorMode")(?=[^>]*value="select")(?=[^>]*checked="")[^>]*>/
  );
  assert.match(
    markup,
    /<input(?=[^>]*name="recordTimelineDefaultScope")(?=[^>]*value="hamster")(?=[^>]*checked="")[^>]*>/
  );
  assert.match(
    markup,
    /<input(?=[^>]*name="cleaningMobileDefaultDateFilter")(?=[^>]*value="today")(?=[^>]*checked="")[^>]*>/
  );
});

test("現在値を変えると要約とスマホ用説明文が対応する値へ切り替わる", () => {
  assert.equal(
    getDisplaySettingsSummary({
      hamsterSelectorMode: "combobox",
      recordTimelineDefaultScope: "household",
      cleaningMobileDefaultDateFilter: "all"
    }),
    "コンボボックス式・グループ全体・すべての日付"
  );

  const markup = renderDisplaySettings("combobox", "household", "all");
  assert.match(markup, /data-display-settings-summary="true">コンボボックス式・グループ全体・すべての日付</);
  assert.match(
    markup,
    /data-selected-description="combobox">文字入力で候補を絞り込みながら選択します。/
  );
  assert.match(
    markup,
    /data-selected-description="household">記録画面を開いたとき、現在の共有グループに所属する全ハムスターの記録を表示します。/
  );
  assert.match(
    markup,
    /data-selected-description="all">衛生管理画面をスマートフォンで開いたとき、その月の入力欄をすべて表示します。/
  );
});

test("スマホは同じラジオを2列セグメント表示し、md以上は内容とカード式ラジオを常時表示する", () => {
  const markup = renderDisplaySettings();

  assert.equal(markup.match(/grid min-w-0 grid-cols-2/g)?.length, 3);
  assert.match(markup, /class="sr-only md:not-sr-only md:mt-0.5"/);
  assert.match(markup, /data-display-settings-content="true"[^>]*class="hidden[^"]*md:block/);
  assert.match(markup, /min-h-11/);
  assert.match(markup, /whitespace-nowrap/);
});

test("設定フォームは表示設定コンポーネントを同じdirty監視フォーム内に置き、保存Actionを維持する", () => {
  const form = readFileSync(
    new URL("../src/components/dashboard-settings-form.tsx", import.meta.url),
    "utf8"
  );

  assert.match(form, /<form action=\{saveSettings\} data-dirty-watch/);
  assert.match(form, /<DisplaySettingsSection[\s\S]*?hamsterSelectorMode=\{hamsterSelectorMode\}/);
  assert.match(form, /recordTimelineDefaultScope=\{recordTimelineDefaultScope\}/);
  assert.match(form, /cleaningMobileDefaultDateFilter=\{cleaningMobileDefaultDateFilter\}/);
  assert.match(form, /<DirtySubmitButton/);
});
