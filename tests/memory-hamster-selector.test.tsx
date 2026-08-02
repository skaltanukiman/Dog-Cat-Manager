import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  getMemoryHamsterSelectionSummary,
  MemoryHamsterSelector,
  shouldInitiallyExpand,
  updateMemoryHamsterSelection,
  type MemoryHamsterOption
} from "../src/components/memory-hamster-selector";

const hamsters: MemoryHamsterOption[] = [
  { id: "h1", name: "きなこ", isActive: true },
  { id: "h2", name: "もなか", isActive: true },
  { id: "h3", name: "しらたま", isActive: false },
  { id: "h4", name: "こむぎ", isActive: true },
  { id: "h5", name: "とても長い名前のハムスター", isActive: true }
];

test("初期開閉状態は新規の2〜4匹だけ展開し、編集と5匹以上は折りたたむ", () => {
  assert.equal(shouldInitiallyExpand({ hamsterCount: 1, isEditing: false }), false);
  assert.equal(shouldInitiallyExpand({ hamsterCount: 2, isEditing: false }), true);
  assert.equal(shouldInitiallyExpand({ hamsterCount: 4, isEditing: false }), true);
  assert.equal(shouldInitiallyExpand({ hamsterCount: 5, isEditing: false }), false);
  assert.equal(shouldInitiallyExpand({ hamsterCount: 2, isEditing: true }), false);
});

test("要約は代表を先頭に最大2匹を表示し、残数と合計を返す", () => {
  const summary = getMemoryHamsterSelectionSummary({
    hamsters,
    selectedIds: ["h1", "h2", "h3", "h4", "h5"],
    representativeId: "h1"
  });
  assert.deepEqual(summary.visibleHamsters.map((hamster) => hamster.name), ["きなこ", "もなか"]);
  assert.equal(summary.effectiveRepresentativeId, "h1");
  assert.equal(summary.additionalCount, 3);
  assert.equal(summary.selectedCount, 5);
});

test("編集で旧代表を外した要約は選択中の先頭を新しい代表として扱う", () => {
  const summary = getMemoryHamsterSelectionSummary({
    hamsters,
    selectedIds: ["h2", "h3"],
    representativeId: "h1"
  });
  assert.equal(summary.effectiveRepresentativeId, "h2");
  assert.deepEqual(summary.visibleHamsters.map((hamster) => hamster.id), ["h2", "h3"]);
});

test("チェック状態の変更は元の選択を壊さず要約の名前と件数へ即時反映できる", () => {
  const original = new Set(["h1"]);
  const added = updateMemoryHamsterSelection(original, "h2", true);
  const removed = updateMemoryHamsterSelection(added, "h1", false);
  const summary = getMemoryHamsterSelectionSummary({
    hamsters,
    selectedIds: removed,
    representativeId: "h1"
  });

  assert.deepEqual([...original], ["h1"]);
  assert.deepEqual([...added], ["h1", "h2"]);
  assert.deepEqual(summary.visibleHamsters.map((hamster) => hamster.name), ["もなか"]);
  assert.equal(summary.selectedCount, 1);
  assert.equal(summary.effectiveRepresentativeId, "h2");
});

test("1匹だけの場合は固定表示と送信値だけを描画する", () => {
  const markup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={[hamsters[2]]} selectedIds={["h3"]} representativeId="h3" lockRepresentative />
  );
  assert.match(markup, /対象ハムスター/);
  assert.match(markup, /しらたま/);
  assert.match(markup, /代表/);
  assert.match(markup, /管理外/);
  assert.match(markup, /type="hidden" name="hamsterIds" value="h3"/);
  assert.doesNotMatch(markup, /type="checkbox"|aria-expanded|>変更<|>閉じる</);
});

test("新規2〜4匹は展開し、新規5匹以上と編集は要約状態で始まる", () => {
  const expandedMarkup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters.slice(0, 4)} selectedIds={["h1"]} representativeId="h1" lockRepresentative />
  );
  const collapsedMarkup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters} selectedIds={hamsters.map((hamster) => hamster.id)} representativeId="h1" lockRepresentative />
  );
  const editingMarkup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters.slice(0, 2)} selectedIds={["h1", "h2"]} representativeId="h1" isEditing />
  );
  assert.match(expandedMarkup, /aria-expanded="true"/);
  assert.match(expandedMarkup, />閉じる</);
  assert.match(collapsedMarkup, /aria-expanded="false"/);
  assert.match(collapsedMarkup, />変更</);
  assert.match(collapsedMarkup, /ほか3匹/);
  assert.match(collapsedMarkup, /5匹選択中/);
  assert.match(collapsedMarkup, /きなこ[\s\S]*代表[\s\S]*もなか/);
  assert.match(editingMarkup, /aria-expanded="false"/);
});

test("折りたたみ時もチェックボックスとhamsterIdsをDOMに保持する", () => {
  const markup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters} selectedIds={["h1", "h2"]} representativeId="h1" lockRepresentative />
  );
  assert.match(markup, /class="hidden"/);
  assert.match(markup, /type="hidden" name="hamsterIds" value="h1"/);
  assert.match(markup, /type="checkbox" name="hamsterIds" checked="" value="h2"/);
  assert.equal((markup.match(/name="hamsterIds"/g) ?? []).length, 5);
});

test("対象ハムスターのエラー時は初期条件より優先して一覧を展開する", () => {
  const markup = renderToStaticMarkup(
    <MemoryHamsterSelector
      hamsters={hamsters}
      selectedIds={["h1"]}
      representativeId="h1"
      lockRepresentative
      hasError
    />
  );
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /aria-expanded="true"/);
  assert.doesNotMatch(markup, /id="[^"]+" class="hidden" aria-label="対象ハムスターの選択一覧"/);
});

test("デモ用は要約の開閉だけを許可し、選択操作と送信名を無効にする", () => {
  const markup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters} selectedIds={["h1"]} representativeId="h1" lockRepresentative readOnly />
  );
  assert.match(markup, /きなこ/);
  assert.match(markup, /1匹選択中/);
  assert.match(markup, /aria-expanded="false"[^>]*data-preview-toggle="true"/);
  assert.doesNotMatch(markup, /name="hamsterIds"/);
  for (const checkbox of markup.match(/<input type="checkbox"[^>]*>/g) ?? []) {
    assert.match(checkbox, /disabled=""/);
  }
});
