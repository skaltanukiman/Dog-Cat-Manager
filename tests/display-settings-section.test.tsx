import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  DisplaySettingsSection,
  getDisplaySettingsSummaryLabels
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

test("スマホ向け画面表示設定はカテゴリ情報と現在値のチップを持ち、初期状態で閉じている", () => {
  const markup = renderDisplaySettings();
  const controlsId = markup.match(/aria-controls="([^"]+)"/)?.[1];

  assert.match(markup, /<section[^>]*aria-label="画面の表示設定"[^>]*data-settings-section="display"/);
  assert.match(markup, /<button[^>]*type="button"[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
  assert.ok(controlsId);
  assert.match(markup, new RegExp(`<div id="${controlsId}"[^>]*data-display-settings-content="true"`));
  assert.match(markup, /data-display-settings-toggle="true"/);
  assert.match(markup, /data-display-settings-toggle="true" data-state="closed"/);
  assert.match(markup, /role="heading" aria-level="3">画面の表示設定</);
  assert.match(markup, />画面の表示設定</);
  assert.match(markup, />各画面の初期表示や選択方法を変更します。</);
  assert.match(
    markup,
    /data-display-settings-icon="true"[\s\S]*?<svg[^>]*aria-hidden="true"/
  );
  assert.equal(markup.match(/data-display-settings-summary-chip="true"/g)?.length, 3);
  assert.match(markup, /data-display-settings-summary-chip="true">プルダウン</);
  assert.match(markup, /data-display-settings-summary-chip="true">1匹表示</);
  assert.match(markup, /data-display-settings-summary-chip="true">当日のみ</);
  assert.match(markup, /data-display-settings-action="true">設定を変更</);
  assert.doesNotMatch(markup, /aria-live=/);
  assert.match(
    markup,
    /data-display-settings-content="true" data-mobile-open="false" data-state="closed" class="grid[^"]*invisible grid-rows-\[0fr\] opacity-0 pointer-events-none/
  );
});

test("スマホ用コンテンツは可変高を200msで遷移し、閉状態の操作と動きを安全に制御する", () => {
  const markup = renderDisplaySettings();
  const source = readFileSync(
    new URL("../src/components/display-settings-section.tsx", import.meta.url),
    "utf8"
  );

  assert.match(
    markup,
    /transition-\[grid-template-rows,opacity,visibility\] duration-200 ease-out/
  );
  assert.match(markup, /motion-reduce:transition-none/);
  assert.match(markup, /md:block md:visible md:overflow-visible md:opacity-100 md:pointer-events-auto md:transition-none/);
  assert.match(
    markup,
    /<div(?=[^>]*data-display-settings-panel="true")(?=[^>]*class="min-h-0 overflow-hidden md:overflow-visible")[^>]*>/
  );
  assert.match(markup, /data-display-settings-chevron="true" data-state="closed"/);
  assert.match(markup, /transition-transform duration-200 ease-out motion-reduce:transition-none/);
  assert.match(source, /\? "visible grid-rows-\[1fr\] opacity-100"/);
  assert.match(source, /: "invisible grid-rows-\[0fr\] opacity-0 pointer-events-none"/);
  assert.doesNotMatch(source, /max-h-\[/);
});

test("スマホ用カードはmoss系アクセントを強め、開閉状態でヘッダー背景を変える", () => {
  const markup = renderDisplaySettings();
  const source = readFileSync(
    new URL("../src/components/display-settings-section.tsx", import.meta.url),
    "utf8"
  );

  assert.match(markup, /border-moss\/30/);
  assert.match(markup, /bg-moss\/10 hover:bg-moss\/\[0\.15\]/);
  assert.match(
    markup,
    /<span(?=[^>]*data-display-settings-icon="true")(?=[^>]*class="[^"]*bg-moss\/20)[^>]*>/
  );
  assert.match(source, /\? "bg-moss\/\[0\.15\] hover:bg-moss\/20"/);
  assert.match(source, /: "bg-moss\/10 hover:bg-moss\/\[0\.15\]"/);
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
  assert.deepEqual(
    getDisplaySettingsSummaryLabels({
      hamsterSelectorMode: "combobox",
      recordTimelineDefaultScope: "household",
      cleaningMobileDefaultDateFilter: "all"
    }),
    ["検索選択", "グループ表示", "月全体"]
  );
  assert.deepEqual(
    getDisplaySettingsSummaryLabels({
      hamsterSelectorMode: "select",
      recordTimelineDefaultScope: "hamster",
      cleaningMobileDefaultDateFilter: "today"
    }),
    ["プルダウン", "1匹表示", "当日のみ"]
  );

  const markup = renderDisplaySettings("combobox", "household", "all");
  assert.match(markup, /data-display-settings-summary-chip="true">検索選択</);
  assert.match(markup, /data-display-settings-summary-chip="true">グループ表示</);
  assert.match(markup, /data-display-settings-summary-chip="true">月全体</);
  assert.doesNotMatch(markup, /data-display-settings-summary-chip="true">combobox</);
  assert.doesNotMatch(markup, /data-display-settings-summary-chip="true">household</);
  assert.doesNotMatch(markup, /data-display-settings-summary-chip="true">all</);
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

  assert.match(markup, /<header class="hidden[^"]*md:flex"[\s\S]*?<h3[^>]*>画面の表示設定<\/h3>/);
  assert.equal(markup.match(/grid min-w-0 grid-cols-2/g)?.length, 3);
  assert.match(markup, /class="sr-only md:not-sr-only md:mt-0.5"/);
  assert.match(markup, /data-display-settings-content="true"[^>]*class="grid[^"]*md:block[^"]*md:visible/);
  assert.match(markup, /min-h-11/);
  assert.match(markup, /whitespace-nowrap/);
});

test("設定フォームはプロフィール、画面表示、ダッシュボード、共通保存の順に兄弟配置する", () => {
  const form = readFileSync(
    new URL("../src/components/dashboard-settings-form.tsx", import.meta.url),
    "utf8"
  );
  const profileIndex = form.indexOf("<ProfileSettingsFields");
  const displayIndex = form.indexOf("<DisplaySettingsSection");
  const dashboardIndex = form.indexOf('data-settings-section="dashboard"');
  const boardCountIndex = form.indexOf('name="dashboardBoardCount"');
  const hamsterOrderIndex = form.indexOf("ダッシュボードカードの並び順");
  const hamsterSelectionIndex = form.indexOf("ダッシュボードに表示するハムスター");
  const saveIndex = form.indexOf('id="dashboard-settings-save"');

  assert.match(form, /<form ref=\{formRef\} action=\{saveSettings\} data-dirty-watch/);
  assert.ok(profileIndex < displayIndex);
  assert.ok(displayIndex < dashboardIndex);
  assert.ok(dashboardIndex < boardCountIndex);
  assert.ok(boardCountIndex < hamsterOrderIndex);
  assert.ok(hamsterOrderIndex < hamsterSelectionIndex);
  assert.ok(boardCountIndex < hamsterSelectionIndex);
  assert.ok(hamsterSelectionIndex < saveIndex);
  assert.match(
    form,
    /<DisplaySettingsSection[\s\S]*?cleaningMobileDefaultDateFilter=\{cleaningMobileDefaultDateFilter\}\s*\/>[\s\S]*?<section[\s\S]*?data-settings-section="dashboard"/
  );
  assert.match(form, /<h3[^>]*>[\s\S]*?ダッシュボード設定[\s\S]*?<\/h3>/);
  assert.match(form, /ダッシュボードに表示する件数、カードの並び順とハムスターを設定します。/);
  assert.match(form, /data-dashboard-board-count/);
  assert.match(form, /data-dashboard-hamster-order/);
  assert.match(form, /data-dashboard-hamster-selection/);
  assert.match(form, /name="dashboardBoardCount"/);
  assert.match(form, /name="hamsterIds"/);
  assert.match(form, /type="search"[\s\S]*?placeholder="ハムスター名で検索"/);
  assert.match(form, /aria-label="ハムスターの状態で絞り込む"/);
  assert.equal(form.match(/<DirtySubmitButton/g)?.length, 1);
  assert.match(form, /<\/section>\s*<\/section>\s*<div\s+id="dashboard-settings-save"/);
  assert.match(form, /<DisplaySettingsSection[\s\S]*?hamsterSelectorMode=\{hamsterSelectorMode\}/);
  assert.match(form, /recordTimelineDefaultScope=\{recordTimelineDefaultScope\}/);
  assert.match(form, /cleaningMobileDefaultDateFilter=\{cleaningMobileDefaultDateFilter\}/);
});
