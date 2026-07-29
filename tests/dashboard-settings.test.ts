import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_HAMSTER_SELECTOR_MODE,
  getDashboardHamsterSelectionError,
  moveDashboardHamsterId,
  normalizeDashboardHamsterIds,
  normalizeHamsterSelectorMode,
  pickDashboardHamsters,
  resizeDashboardHamsterIds,
  toggleDashboardHamsterId
} from "../src/lib/dashboard-settings";

const dashboardSettingsFormSource = readFileSync(
  new URL("../src/components/dashboard-settings-form.tsx", import.meta.url),
  "utf8"
);
const dashboardPageSource = readFileSync(new URL("../src/app/(app)/page.tsx", import.meta.url), "utf8");
const dashboardQueriesSource = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const settingsActionSource = readFileSync(
  new URL("../src/app/actions/settings.ts", import.meta.url),
  "utf8"
);
const tailwindConfigSource = readFileSync(new URL("../tailwind.config.ts", import.meta.url), "utf8");

test("ハムスター選択方式はコンボボックス式とプルダウン式を維持する", () => {
  assert.equal(normalizeHamsterSelectorMode("combobox"), "combobox");
  assert.equal(normalizeHamsterSelectorMode("select"), "select");
});

test("不正または未設定のハムスター選択方式は既定値に戻す", () => {
  assert.equal(normalizeHamsterSelectorMode("invalid"), DEFAULT_HAMSTER_SELECTOR_MODE);
  assert.equal(normalizeHamsterSelectorMode(null), DEFAULT_HAMSTER_SELECTOR_MODE);
  assert.equal(normalizeHamsterSelectorMode(undefined), DEFAULT_HAMSTER_SELECTOR_MODE);
});

test("ダッシュボード表示対象の検索と状態フィルターを同時に適用する", () => {
  assert.match(dashboardSettingsFormSource, /normalizeSearchText\(hamster\.name\)\.includes\(normalizedSearchTerm\)/);
  assert.match(dashboardSettingsFormSource, /return matchesSearch && matchesStatus/);
  assert.match(dashboardSettingsFormSource, /statusFilter === "active" && hamster\.isActive/);
  assert.match(dashboardSettingsFormSource, /statusFilter === "inactive" && !hamster\.isActive/);
  assert.match(dashboardSettingsFormSource, /statusFilter === "selected" && selectedIdSet\.has\(hamster\.id\)/);
});

test("状態フィルターは操作可能なボタンで、一覧の行領域だけをスクロールする", () => {
  assert.match(dashboardSettingsFormSource, /aria-pressed=\{isSelected\}/);
  assert.match(
    dashboardSettingsFormSource,
    /grid grid-cols-4 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-wrap sm:gap-2 sm:rounded-none sm:bg-transparent sm:p-0/
  );
  assert.match(dashboardSettingsFormSource, /max-h-\[50vh\].*overflow-y-auto.*sm:max-h-96.*lg:max-h-\[28rem\]/);
});

test("保存済み順序を維持し、削除済みIDを除外して新規ハムスターを末尾へ補う", () => {
  assert.deepEqual(
    normalizeDashboardHamsterIds(["hamster-1", "hamster-2", "hamster-3"], 3, [
      "hamster-2",
      "deleted-hamster",
      "hamster-1"
    ]),
    ["hamster-2", "hamster-1", "hamster-3"]
  );
});

test("表示ボード数で先頭から切り詰め、全件表示でも登録順へ戻さない", () => {
  assert.deepEqual(
    normalizeDashboardHamsterIds(["hamster-1", "hamster-2", "hamster-3"], 2, [
      "hamster-3",
      "hamster-1",
      "hamster-2"
    ]),
    ["hamster-3", "hamster-1"]
  );
  assert.deepEqual(
    normalizeDashboardHamsterIds(["hamster-1", "hamster-2", "hamster-3"], 6, [
      "hamster-3",
      "hamster-1",
      "hamster-2"
    ]),
    ["hamster-3", "hamster-1", "hamster-2"]
  );
});

test("管理状態に関係なく保存順でダッシュボード対象を返す", () => {
  const hamsters = [
    { id: "active-1", isActive: true },
    { id: "inactive-1", isActive: false },
    { id: "active-2", isActive: true }
  ];

  assert.deepEqual(
    pickDashboardHamsters(hamsters, 3, ["inactive-1", "active-2", "active-1"]).map((hamster) => hamster.id),
    ["inactive-1", "active-2", "active-1"]
  );
});

test("上下移動、表示対象の追加・解除、表示数減少は現在の順序を基準にする", () => {
  assert.deepEqual(
    moveDashboardHamsterId(["hamster-1", "hamster-2", "hamster-3"], "hamster-2", "hamster-1"),
    ["hamster-2", "hamster-1", "hamster-3"]
  );
  assert.deepEqual(toggleDashboardHamsterId(["hamster-2"], "hamster-3", 2), ["hamster-2", "hamster-3"]);
  assert.deepEqual(toggleDashboardHamsterId(["hamster-2", "hamster-3"], "hamster-2", 2), ["hamster-3"]);
  assert.deepEqual(
    resizeDashboardHamsterIds(
      ["hamster-1", "hamster-2", "hamster-3"],
      ["hamster-3", "hamster-1", "hamster-2"],
      2
    ),
    ["hamster-3", "hamster-1"]
  );
});

test("並び順一覧は選択済みだけをDOM順に描画し、末尾追加とhidden input順を共有する", () => {
  assert.match(dashboardSettingsFormSource, /const orderedHamsters = useMemo\([\s\S]*selectedIds[\s\S]*hamsterById\.get/);
  assert.match(dashboardSettingsFormSource, /toggleDashboardHamsterId\(current, hamsterId, limit\)/);
  assert.match(dashboardSettingsFormSource, /\{orderedHamsters\.map\(\(hamster, index\) =>/);
  assert.match(dashboardSettingsFormSource, /\{selectedIds\.map\(\(id\) =>\s*\(\s*<input key=\{id\} type="hidden" name="hamsterIds"/);
});

test("並び順操作はPC用ハンドル、全画面幅用の上下ボタン、無効状態と支援技術向け説明を持つ", () => {
  assert.doesNotMatch(tailwindConfigSource, /screens\s*:/);
  assert.match(dashboardSettingsFormSource, /draggable[\s\S]*aria-roledescription="並び替えハンドル"/);
  assert.match(
    dashboardSettingsFormSource,
    /className="hidden h-11 w-11[^"]*sm:inline-flex"/
  );
  assert.match(dashboardSettingsFormSource, /disabled=\{index === 0\}/);
  assert.match(dashboardSettingsFormSource, /disabled=\{index === orderedHamsters\.length - 1\}/);
  assert.match(dashboardSettingsFormSource, /aria-label=\{`\$\{hamster\.name\}を上へ移動`\}/);
  assert.match(dashboardSettingsFormSource, /aria-label=\{`\$\{hamster\.name\}を下へ移動`\}/);
  assert.match(dashboardSettingsFormSource, /className=\{`inline-flex h-11 w-11/);
  assert.match(dashboardSettingsFormSource, /aria-live="polite"/);
  assert.match(
    dashboardSettingsFormSource,
    /formRef\.current\?\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/
  );
});

test("Altと矢印キーのショートカット処理・属性・説明を残さない", () => {
  assert.doesNotMatch(dashboardSettingsFormSource, /KeyboardEvent/);
  assert.doesNotMatch(dashboardSettingsFormSource, /handleDragHandleKeyDown/);
  assert.doesNotMatch(dashboardSettingsFormSource, /onKeyDown=/);
  assert.doesNotMatch(dashboardSettingsFormSource, /aria-keyshortcuts/);
  assert.doesNotMatch(dashboardSettingsFormSource, /Alt \+ ↑|Alt\+Arrow/);
  assert.match(
    dashboardSettingsFormSource,
    /PCではドラッグハンドルまたは上下ボタンで並び替えられます。スマートフォンでは上下ボタンを使用してください。/
  );
});

test("PCホバー、移動直後、ドロップ先の順に行の視覚状態を強める", () => {
  assert.match(
    dashboardSettingsFormSource,
    /const rowStateClass = isDropTarget\s*\?\s*"border-moss bg-moss\/10 ring-2 ring-moss\/20"\s*:\s*isRecentlyMoved\s*\?\s*"border-moss\/70 bg-moss\/10"\s*:\s*"border-slate-200 bg-white sm:hover:border-slate-300 sm:hover:bg-slate-50"/
  );
  assert.match(dashboardSettingsFormSource, /transition-colors duration-200 motion-reduce:transition-none/);
});

test("上下移動成功時は行と押した方向のボタンを800ms強調し、連続操作の古い解除を無効化する", () => {
  const feedbackDuration = dashboardSettingsFormSource.match(/MOVE_FEEDBACK_DURATION_MS = (\d+)/);
  assert.ok(feedbackDuration);
  assert.ok(Number(feedbackDuration[1]) >= 600);
  assert.ok(Number(feedbackDuration[1]) <= 1000);
  assert.match(dashboardSettingsFormSource, /type RecentMove = \{\s*hamsterId: string;\s*direction: MoveDirection;/);
  assert.match(dashboardSettingsFormSource, /setRecentMove\(\{ hamsterId, direction \}\)/);
  assert.match(dashboardSettingsFormSource, /data-recently-moved=\{isRecentlyMoved \? "true" : undefined\}/);
  assert.match(
    dashboardSettingsFormSource,
    /data-move-feedback=\{isRecentlyMoved && recentMove\.direction === "up" \? "true" : undefined\}/
  );
  assert.match(
    dashboardSettingsFormSource,
    /data-move-feedback=\{isRecentlyMoved && recentMove\.direction === "down" \? "true" : undefined\}/
  );
  assert.match(dashboardSettingsFormSource, /feedbackSequenceRef\.current === feedbackSequence/);
  assert.match(dashboardSettingsFormSource, /window\.clearTimeout\(feedbackTimerRef\.current\)/);
  assert.match(
    dashboardSettingsFormSource,
    /const targetId = selectedIds\[currentIndex \+ offset\];\s*if \(!targetId\) \{\s*return;\s*\}[\s\S]*startMoveFeedback/
  );
});

test("上下移動はFLIP方式で位置をアニメーションし、動きを抑制する設定では実行しない", () => {
  assert.match(dashboardSettingsFormSource, /pendingOrderPositionsRef\.current = captureOrderPositions\(\)/);
  assert.match(dashboardSettingsFormSource, /useLayoutEffect\(\(\) =>/);
  assert.match(
    dashboardSettingsFormSource,
    /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/
  );
  assert.match(
    dashboardSettingsFormSource,
    /const offsetY = previousTop - row\.getBoundingClientRect\(\)\.top/
  );
  assert.match(
    dashboardSettingsFormSource,
    /row\.animate\(\s*\[\{ transform: `translateY\(\$\{offsetY\}px\)` \}, \{ transform: "translateY\(0\)" \}\]/
  );
  assert.match(dashboardSettingsFormSource, /row\.getAnimations\(\)\.forEach\(\(animation\) => animation\.cancel\(\)\)/);
});

test("サーバー検証は重複、他Household相当の未知ID、件数超過・不足を拒否する", () => {
  const validIds = ["hamster-1", "hamster-2"];

  assert.equal(getDashboardHamsterSelectionError(validIds, 2, ["hamster-1", "hamster-1"]), "duplicate");
  assert.equal(getDashboardHamsterSelectionError(validIds, 2, ["hamster-1", "other-household"]), "unknown");
  assert.equal(getDashboardHamsterSelectionError(validIds, 1, ["hamster-1", "hamster-2"]), "tooMany");
  assert.equal(getDashboardHamsterSelectionError(validIds, 2, ["hamster-1"]), "tooFew");
  assert.equal(getDashboardHamsterSelectionError(validIds, 2, ["hamster-2", "hamster-1"]), null);
});

test("保存Actionは送信順のインデックスをsortOrderとして個人設定へ保存する", () => {
  assert.match(settingsActionSource, /const selectedHamsterIds = dashboardResult\.data\.hamsterIds/);
  assert.match(settingsActionSource, /getDashboardHamsterSelectionError\(/);
  assert.match(
    settingsActionSource,
    /for \(const \[index, hamsterId\] of selectedHamsterIds\.entries\(\)\) \{[\s\S]*sortOrder: index/
  );
  assert.match(
    settingsActionSource,
    /userId_householdId: \{ userId: context\.user\.id, householdId: context\.household\.id \}/
  );
});

test("ダッシュボードはsortOrderで読み込んだ順序をカードのDOM順へ反映する", () => {
  assert.match(
    dashboardQueriesSource,
    /dashboardHamsters: \{\s*orderBy: \{ sortOrder: "asc" \}\s*\}/
  );
  assert.match(dashboardQueriesSource, /pickDashboardHamsters\(hamsters, boardCount, selectedIds\)/);
  assert.match(dashboardPageSource, /\{hamsters\.map\(\(hamster\) =>/);
});
