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
  assert.doesNotMatch(markup, /type="checkbox"|<details|<summary|>変更<|>閉じる</);
});

test("新規2〜4匹はdetailsが開き、新規5匹以上と編集は閉じて始まる", () => {
  const expandedMarkup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters.slice(0, 4)} selectedIds={["h1"]} representativeId="h1" lockRepresentative />
  );
  const collapsedMarkup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters} selectedIds={hamsters.map((hamster) => hamster.id)} representativeId="h1" lockRepresentative />
  );
  const editingMarkup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters.slice(0, 2)} selectedIds={["h1", "h2"]} representativeId="h1" isEditing />
  );
  assert.match(expandedMarkup, /<details[^>]*open=""/);
  assert.doesNotMatch(collapsedMarkup, /<details[^>]*open=""/);
  assert.doesNotMatch(editingMarkup, /<details[^>]*open=""/);
  assert.match(collapsedMarkup, /<summary[^>]*>[\s\S]*対象ハムスター（複数選択可）/);
  assert.match(collapsedMarkup, /ほか3匹/);
  assert.match(collapsedMarkup, /5匹選択中/);
  assert.match(collapsedMarkup, /きなこ（代表）[\s\S]*もなか/);
  assert.doesNotMatch(collapsedMarkup, /<button|>変更<|>閉じる/);
});

test("独自マーカーは先頭行と同じ高さのラッパー内で中央に揃え、選択内容を自然に折り返す", () => {
  const markup = renderToStaticMarkup(
    <MemoryHamsterSelector
      hamsters={hamsters}
      selectedIds={["h1", "h2", "h3"]}
      representativeId="h1"
      lockRepresentative
    />
  );
  const summaryMarkup = markup.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0];

  assert.ok(summaryMarkup);
  assert.match(summaryMarkup, /\blist-none\b/);
  assert.match(summaryMarkup, /webkit-details-marker/);
  assert.match(summaryMarkup, /lucide-chevron-right/);
  assert.match(summaryMarkup, /aria-hidden="true"/);
  assert.match(summaryMarkup, /group-open:rotate-90/);
  assert.match(
    summaryMarkup,
    /<span class="grid min-w-0 grid-cols-\[auto_minmax\(0,1fr\)\] gap-x-2">\s*<span class="flex h-5 shrink-0 items-center">\s*<svg[^>]*class="[^"]*h-3\.5 w-3\.5[^"]*"[^>]*>[\s\S]*?<\/svg>\s*<\/span>\s*<span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0\.5 leading-5">/
  );
  assert.match(
    summaryMarkup,
    /<span class="flex min-w-0 flex-1 flex-wrap[^>]*">\s*<span class="font-semibold[^>]*">対象ハムスター（複数選択可）<\/span>\s*<span class="min-w-0 break-words text-slate-600"[^>]*>[\s\S]*きなこ（代表）[\s\S]*もなか[\s\S]*ほか1匹[\s\S]*3匹選択中/
  );
  assert.doesNotMatch(summaryMarkup, /\bitems-start\b|\bmt-0\.5\b/);
  assert.doesNotMatch(summaryMarkup, /<button/);
});

test("折りたたみ時もチェックボックスとhamsterIdsをDOMに保持する", () => {
  const markup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters} selectedIds={["h1", "h2"]} representativeId="h1" lockRepresentative />
  );
  assert.doesNotMatch(markup, /<details[^>]*open=""/);
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
  assert.match(markup, /<details[^>]*open=""/);
});

test("デモ用は要約の開閉だけを許可し、選択操作と送信名を無効にする", () => {
  const markup = renderToStaticMarkup(
    <MemoryHamsterSelector hamsters={hamsters} selectedIds={["h1"]} representativeId="h1" lockRepresentative readOnly />
  );
  assert.match(markup, /きなこ/);
  assert.match(markup, /1匹選択中/);
  assert.match(markup, /<details[\s\S]*<summary/);
  assert.doesNotMatch(markup, /<details[^>]*open=""|<button|>変更<|>閉じる/);
  assert.doesNotMatch(markup, /name="hamsterIds"/);
  for (const checkbox of markup.match(/<input type="checkbox"[^>]*>/g) ?? []) {
    assert.match(checkbox, /disabled=""/);
  }
});
