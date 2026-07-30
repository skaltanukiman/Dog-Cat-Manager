import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_HAMSTER_SELECTOR_MODE,
  getDashboardDropPosition,
  getDashboardHamsterSelectionError,
  moveDashboardHamsterId,
  normalizeDashboardHamsterIds,
  normalizeHamsterSelectorMode,
  orderHamstersForSelector,
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
const formDirtyStateSource = readFileSync(
  new URL("../src/components/form-dirty-state.ts", import.meta.url),
  "utf8"
);
const unsavedChangesGuardSource = readFileSync(
  new URL("../src/components/unsaved-changes-guard.tsx", import.meta.url),
  "utf8"
);
const demoDashboardSource = readFileSync(new URL("../src/app/demo/page.tsx", import.meta.url), "utf8");

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

test("通常画面の候補はダッシュボード順を先頭にし、残りを管理状態・登録日時・ID順に並べる", () => {
  const hamsters = [
    { id: "B", isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "E", isActive: false, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    { id: "D", isActive: true, createdAt: new Date("2026-01-03T00:00:00.000Z") },
    { id: "C", isActive: false, createdAt: new Date("2026-01-04T00:00:00.000Z") },
    { id: "A", isActive: true, createdAt: new Date("2026-01-05T00:00:00.000Z") }
  ];

  const ordered = orderHamstersForSelector(hamsters, 2, ["C", "A"], true);

  assert.deepEqual(ordered.map((hamster) => hamster.id), ["C", "A", "B", "D", "E"]);
  assert.equal(new Set(ordered.map((hamster) => hamster.id)).size, ordered.length);
  assert.deepEqual(hamsters.map((hamster) => hamster.id), ["B", "E", "D", "C", "A"]);
});

test("管理外を含めない候補は管理外を除外してダッシュボード上の管理中順を維持する", () => {
  const hamsters = [
    { id: "B", isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
    { id: "C", isActive: false, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    { id: "A", isActive: true, createdAt: new Date("2026-01-03T00:00:00.000Z") },
    { id: "D", isActive: true, createdAt: new Date("2026-01-04T00:00:00.000Z") }
  ];

  assert.deepEqual(
    orderHamstersForSelector(hamsters, 3, ["C", "A", "D"], false).map((hamster) => hamster.id),
    ["A", "D", "B"]
  );
});

test("ダッシュボード外で登録日時が同じ候補はID昇順にする", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const hamsters = [
    { id: "dashboard", isActive: true, createdAt },
    { id: "active-z", isActive: true, createdAt },
    { id: "inactive-a", isActive: false, createdAt },
    { id: "active-a", isActive: true, createdAt },
    { id: "inactive-z", isActive: false, createdAt }
  ];

  assert.deepEqual(
    orderHamstersForSelector(hamsters, 1, ["dashboard"], true).map((hamster) => hamster.id),
    ["dashboard", "active-a", "active-z", "inactive-a", "inactive-z"]
  );
});

test("保存IDの不足・無効ID・設定なしはダッシュボードと同じ補完規則を使う", () => {
  const hamsters = ["A", "B", "C", "D"].map((id, index) => ({
    id,
    isActive: true,
    createdAt: new Date(Date.UTC(2026, 0, index + 1))
  }));

  assert.deepEqual(
    orderHamstersForSelector(hamsters, 3, ["deleted", "C"], true).map((hamster) => hamster.id),
    ["C", "A", "B", "D"]
  );
  assert.deepEqual(
    orderHamstersForSelector(hamsters, undefined, [], true).map((hamster) => hamster.id),
    ["A", "B", "C", "D"]
  );
});

test("同じ共有グループでもユーザーごとの保存順から異なる候補順を生成する", () => {
  const hamsters = ["A", "B", "C"].map((id, index) => ({
    id,
    isActive: true,
    createdAt: new Date(Date.UTC(2026, 0, index + 1))
  }));

  assert.deepEqual(
    orderHamstersForSelector(hamsters, 2, ["C", "A"], true).map((hamster) => hamster.id),
    ["C", "A", "B"]
  );
  assert.deepEqual(
    orderHamstersForSelector(hamsters, 2, ["B", "C"], true).map((hamster) => hamster.id),
    ["B", "C", "A"]
  );
});

test("上下移動、表示対象の追加・解除、表示数減少は現在の順序を基準にする", () => {
  assert.deepEqual(
    moveDashboardHamsterId(
      ["hamster-1", "hamster-2", "hamster-3"],
      "hamster-2",
      "hamster-1",
      "before"
    ),
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

test("ドラッグ移動は移動元を除外した後の対象位置へbeforeまたはafterで挿入する", () => {
  const ids = ["A", "B", "C", "D"];

  assert.deepEqual(moveDashboardHamsterId(ids, "A", "C", "before"), ["B", "A", "C", "D"]);
  assert.deepEqual(moveDashboardHamsterId(ids, "A", "C", "after"), ["B", "C", "A", "D"]);
  assert.deepEqual(moveDashboardHamsterId(ids, "D", "B", "before"), ["A", "D", "B", "C"]);
  assert.deepEqual(moveDashboardHamsterId(ids, "D", "B", "after"), ["A", "B", "D", "C"]);
  assert.deepEqual(moveDashboardHamsterId(["B", "C", "D", "A"], "A", "B", "before"), ids);
  assert.deepEqual(moveDashboardHamsterId(ids, "A", "D", "after"), ["B", "C", "D", "A"]);
  assert.deepEqual(moveDashboardHamsterId(ids, "A", "B", "before"), ids);
  assert.deepEqual(moveDashboardHamsterId(ids, "unknown", "B", "before"), ids);
  assert.deepEqual(moveDashboardHamsterId(ids, "A", "unknown", "after"), ids);
});

test("ポインターが対象行の上半分ならbefore、下半分ならafterを返す", () => {
  const rect = { top: 100, height: 40 };

  assert.equal(getDashboardDropPosition(119, rect), "before");
  assert.equal(getDashboardDropPosition(120, rect), "after");
  assert.equal(getDashboardDropPosition(139, rect), "after");
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
    /requestFormDirtyReevaluation\(formRef\.current\)/
  );
});

test("並び順の行はスマホで情報と操作を2列に並べ、PCでは既存の横並びを維持する", () => {
  assert.match(
    dashboardSettingsFormSource,
    /grid-cols-\[minmax\(0,1fr\)_auto\] items-center gap-x-3 gap-y-1[\s\S]*sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-3/
  );
  assert.match(
    dashboardSettingsFormSource,
    /<div className="contents sm:flex sm:min-w-0 sm:items-center sm:gap-3">/
  );
  assert.match(
    dashboardSettingsFormSource,
    /<span className="contents sm:min-w-0 sm:block">[\s\S]*<span className="col-span-2 block break-words text-sm font-semibold text-ink sm:col-auto">[\s\S]*\{hamster\.name\}/
  );
  assert.match(
    dashboardSettingsFormSource,
    /<div className="grid shrink-0 grid-cols-2 gap-2" aria-label=\{`\$\{hamster\.name\}の並び替え操作`\}>/
  );
  assert.doesNotMatch(dashboardSettingsFormSource, /self-end/);
  assert.match(dashboardSettingsFormSource, /className="hidden h-11 w-11[^"]*sm:inline-flex"/);
  assert.match(dashboardSettingsFormSource, /className=\{`inline-flex h-11 w-11/);
});

test("並び順一覧はスマートフォンだけ高さを制限し、順位と総件数を現在の配列順で表示する", () => {
  assert.match(
    dashboardSettingsFormSource,
    /className="flex max-h-\[var\(--dashboard-order-max-height\)\] flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain [^"]*sm:max-h-none sm:overflow-visible sm:overscroll-auto"/
  );
  assert.match(
    dashboardSettingsFormSource,
    /\[--dashboard-order-max-height:min\(55vh,28rem\)\][^"]*supports-\[height:1dvh\]:\[--dashboard-order-max-height:min\(55dvh,28rem\)\]/
  );
  assert.match(
    dashboardSettingsFormSource,
    /className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-slate-500 sm:hidden">\s*全\{orderedHamsters\.length\}件/
  );
  assert.match(
    dashboardSettingsFormSource,
    /\{orderedHamsters\.map\(\(hamster, index\) =>[\s\S]*aria-label=\{`\$\{index \+ 1\}番目`\}[\s\S]*tabular-nums[^"]*sm:hidden[\s\S]*\{index \+ 1\}[\s\S]*\{hamster\.name\}/
  );
});

test("スマートフォンの上下移動後は更新済みDOMの対象行を必要な分だけスクロール追従する", () => {
  assert.match(dashboardSettingsFormSource, /const pendingScrollHamsterIdRef = useRef<string \| null>\(null\)/);
  assert.match(
    dashboardSettingsFormSource,
    /function moveByOffset[\s\S]*pendingScrollHamsterIdRef\.current = hamsterId;[\s\S]*updateOrder/
  );
  assert.match(
    dashboardSettingsFormSource,
    /window\.matchMedia\("\(max-width: 639px\)"\)\.matches[\s\S]*orderList\.scrollHeight <= orderList\.clientHeight/
  );
  assert.match(
    dashboardSettingsFormSource,
    /window\.requestAnimationFrame\(\(\) => \{[\s\S]*movedRow\.scrollIntoView\(\{[\s\S]*block: "nearest",[\s\S]*behavior: reducedMotion \? "auto" : "smooth"/
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
  assert.match(
    dashboardSettingsFormSource,
    /transition-\[margin,background-color,border-color,opacity\] duration-150 ease-out motion-reduce:transition-none/
  );
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

test("D&Dは行の上下位置を保持し、PCでは余白の中央にbeforeまたはafterの挿入ラインを1本だけ表示する", () => {
  assert.match(
    dashboardSettingsFormSource,
    /getDashboardDropPosition\(event\.clientY, event\.currentTarget\.getBoundingClientRect\(\)\)/
  );
  assert.match(
    dashboardSettingsFormSource,
    /const position = getDashboardDropPosition\([\s\S]*updateDropTarget\(\{ hamsterId, position \}\)/
  );
  assert.match(dashboardSettingsFormSource, /data-drop-position=\{isDropTarget \? dropTarget\.position : undefined\}/);
  assert.match(
    dashboardSettingsFormSource,
    /const dropSpacingClass = isDropBefore \? "sm:mt-2" : isDropAfter \? "sm:mb-2" : ""/
  );
  assert.match(
    dashboardSettingsFormSource,
    /const isDropBefore = isDropTarget && dropTarget\.position === "before";\s*const isDropAfter = isDropTarget && dropTarget\.position === "after";/
  );
  assert.match(
    dashboardSettingsFormSource,
    /const beforeLinePositionClass = index === 0 \? "sm:-top-1\.5" : "sm:-top-2\.5";/
  );
  assert.match(
    dashboardSettingsFormSource,
    /index === orderedHamsters\.length - 1 \? "sm:-bottom-1\.5" : "sm:-bottom-2\.5"/
  );
  assert.match(
    dashboardSettingsFormSource,
    /className="flex max-h-\[var\(--dashboard-order-max-height\)\] flex-col gap-2/
  );
  assert.match(
    dashboardSettingsFormSource,
    /transition-\[margin,background-color,border-color,opacity\] duration-150 ease-out motion-reduce:transition-none/
  );
  assert.match(
    dashboardSettingsFormSource,
    /isDropBefore \? \([\s\S]*data-drop-indicator="before"[\s\S]*absolute -top-1\.5 left-2 right-2[\s\S]*\$\{beforeLinePositionClass\}[\s\S]*\) : null/
  );
  assert.match(
    dashboardSettingsFormSource,
    /isDropAfter \? \([\s\S]*data-drop-indicator="after"[\s\S]*absolute -bottom-1\.5 left-2 right-2[\s\S]*\$\{afterLinePositionClass\}[\s\S]*\) : null/
  );
  assert.doesNotMatch(dashboardSettingsFormSource, /space-y-2/);
  assert.match(dashboardSettingsFormSource, /onDragLeave=\{handleOrderListDragLeave\}/);
  assert.match(
    dashboardSettingsFormSource,
    /if \(!draggedId \|\| draggedId === hamsterId\) \{\s*updateDropTarget\(null\);\s*return;/
  );
  assert.match(dashboardSettingsFormSource, /function clearDragState\(\) \{[\s\S]*updateDropTarget\(null\)/);
  assert.match(dashboardSettingsFormSource, /function handleDragEnd\(\) \{\s*clearDragState\(\)/);
});

test("D&Dのドロップは一覧全体で受け取り、表示中のdropTargetをそのまま使用する", () => {
  const listDropStart = dashboardSettingsFormSource.indexOf("function handleOrderListDrop");
  const listDropEnd = dashboardSettingsFormSource.indexOf("function handleDragEnd", listDropStart);
  const listDropSource = dashboardSettingsFormSource.slice(listDropStart, listDropEnd);

  assert.notEqual(listDropStart, -1);
  assert.notEqual(listDropEnd, -1);
  assert.match(
    dashboardSettingsFormSource,
    /<ol[\s\S]*onDragOver=\{handleOrderListDragOver\}[\s\S]*onDragLeave=\{handleOrderListDragLeave\}[\s\S]*onDrop=\{handleOrderListDrop\}/
  );
  assert.match(
    dashboardSettingsFormSource,
    /function handleOrderListDragOver\([\s\S]*dropTargetRef\.current[\s\S]*event\.preventDefault\(\)/
  );
  assert.match(
    dashboardSettingsFormSource,
    /const dropTargetRef = useRef<DropTarget \| null>\(null\)/
  );
  assert.match(
    dashboardSettingsFormSource,
    /function updateDropTarget\([\s\S]*dropTargetRef\.current = nextTarget;\s*setDropTarget\(nextTarget\)/
  );
  assert.match(listDropSource, /const currentDropTarget = dropTargetRef\.current/);
  assert.match(
    listDropSource,
    /updateOrder\(hamsterId, currentDropTarget\.hamsterId, currentDropTarget\.position\)/
  );
  assert.doesNotMatch(listDropSource, /getDashboardDropPosition|getBoundingClientRect/);
  assert.equal(
    dashboardSettingsFormSource.match(/onDrop=\{handleOrderListDrop\}/g)?.length,
    1
  );
  assert.doesNotMatch(dashboardSettingsFormSource, /<li[\s\S]*?onDrop=/);
  assert.match(listDropSource, /clearDragState\(\)/);
});

test("ドラッグ元を半透明にし、行全体の非操作プレビューを作成して確実に削除する", () => {
  assert.match(dashboardSettingsFormSource, /const isDragging = draggedId === hamster\.id/);
  assert.match(dashboardSettingsFormSource, /data-dragging=\{isDragging \? "true" : undefined\}/);
  assert.match(dashboardSettingsFormSource, /isDragging \? "opacity-50" : "opacity-100"/);
  assert.match(
    dashboardSettingsFormSource,
    /event\.currentTarget\.closest<HTMLElement>\("\[data-dashboard-hamster-order-id\]"\)/
  );
  assert.match(dashboardSettingsFormSource, /const preview = row\.cloneNode\(true\) as HTMLElement/);
  assert.match(dashboardSettingsFormSource, /preview\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(dashboardSettingsFormSource, /preview\.style\.opacity = "0\.8"/);
  assert.match(dashboardSettingsFormSource, /preview\.style\.pointerEvents = "none"/);
  assert.match(dashboardSettingsFormSource, /event\.dataTransfer\.setDragImage\(preview, 24, 24\)/);
  assert.match(dashboardSettingsFormSource, /function clearDragState\(\) \{[\s\S]*removeDragPreview\(\)/);
  assert.match(dashboardSettingsFormSource, /function handleOrderListDrop\([\s\S]*clearDragState\(\)/);
  assert.match(dashboardSettingsFormSource, /function handleDragEnd\(\) \{\s*clearDragState\(\)/);
  assert.match(
    dashboardSettingsFormSource,
    /useEffect\(\(\) => \{[\s\S]*dragPreviewRef\.current\?\.remove\(\)/
  );
});

test("設定画面の管理状態バッジは通常・デモダッシュボードと同じ色と寸法を使う", () => {
  for (const source of [dashboardSettingsFormSource, dashboardPageSource, demoDashboardSource]) {
    assert.match(source, /rounded-md px-2 py-1 text-xs font-semibold/);
    assert.match(source, /hamster\.isActive\s*\?\s*"bg-straw\/40 text-slate-700"\s*:\s*"bg-slate-200 text-slate-600"/);
  }
});

test("並び順変更はDOM更新後に共通イベントでdirtyを再評価し、初期順へ戻すと解除できる", () => {
  assert.match(
    formDirtyStateSource,
    /FORM_DIRTY_REEVALUATE_EVENT = "form-dirty-reevaluate"/
  );
  assert.match(
    formDirtyStateSource,
    /window\.requestAnimationFrame\(\(\) => \{\s*document\.dispatchEvent\(\s*new CustomEvent\(FORM_DIRTY_REEVALUATE_EVENT, \{[\s\S]*detail: \{ form \}/
  );
  assert.match(
    formDirtyStateSource,
    /\.map\(\(control\) => `\$\{control\.name\}:\$\{control\.type\}:\$\{normalizeControlValue\(control\)\}`\)/
  );
  assert.match(
    formDirtyStateSource,
    /document\.addEventListener\(FORM_DIRTY_REEVALUATE_EVENT, handleDirtyReevaluation\)/
  );
  assert.match(
    unsavedChangesGuardSource,
    /document\.addEventListener\(FORM_DIRTY_REEVALUATE_EVENT, handleDirtyReevaluation\)/
  );
  assert.match(
    unsavedChangesGuardSource,
    /dirtyReevaluationFrame = window\.requestAnimationFrame\(\(\) => \{[\s\S]*setIsDirty\(hasDirtyForms\(\)\)/
  );
  assert.match(
    unsavedChangesGuardSource,
    /window\.cancelAnimationFrame\(dirtyReevaluationFrame\)/
  );
  assert.match(unsavedChangesGuardSource, /setIsDirty\(false\)/);
  assert.match(unsavedChangesGuardSource, /document\.addEventListener\("click", handleDocumentClick, true\)/);
  assert.match(unsavedChangesGuardSource, /window\.addEventListener\("beforeunload", handleBeforeUnload\)/);
  assert.match(unsavedChangesGuardSource, /保存されていない変更があります/);
  assert.match(unsavedChangesGuardSource, /<div onChangeCapture=\{handleChangeCapture\} onSubmitCapture=\{handleSubmitCapture\}>/);
  assert.match(
    dashboardSettingsFormSource,
    /function moveByOffset\([\s\S]*updateOrder\(hamsterId, targetId, position\)/
  );
  assert.match(
    dashboardSettingsFormSource,
    /function handleOrderListDrop\([\s\S]*updateOrder\(hamsterId, currentDropTarget\.hamsterId, currentDropTarget\.position\)/
  );
  assert.match(
    dashboardSettingsFormSource,
    /if \(nextIndex < 0 \|\| !nextIds\.some\([\s\S]*\) \{\s*return false;\s*\}[\s\S]*setSelectedIds\(nextIds\);[\s\S]*requestFormDirtyReevaluation\(formRef\.current\)/
  );
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
