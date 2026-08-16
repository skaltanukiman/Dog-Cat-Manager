import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_DASHBOARD_BOARD_COUNT,
  getDashboardDropPosition,
  getDashboardPetRemovalPosition,
  getDashboardPetSelectionError,
  moveDashboardPetId,
  normalizeDashboardBoardCount,
  normalizeDashboardPetIds,
  pickDashboardPets,
  resizeDashboardPetIds,
  toggleDashboardPetId
} from "../src/lib/dashboard-settings";
import { dashboardSettingsSchema } from "../src/lib/schemas";

const projectRoot = process.cwd();

function source(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("表示ボード数は既定値と許可範囲へ正規化する", () => {
  assert.equal(normalizeDashboardBoardCount(undefined), DEFAULT_DASHBOARD_BOARD_COUNT);
  assert.equal(normalizeDashboardBoardCount(Number.NaN), DEFAULT_DASHBOARD_BOARD_COUNT);
  assert.equal(normalizeDashboardBoardCount(0), 1);
  assert.equal(normalizeDashboardBoardCount(7.9), 7);
  assert.equal(normalizeDashboardBoardCount(31), 30);
});

test("保存済みPet順を優先し、無効IDと重複を除いて登録順で補完する", () => {
  assert.deepEqual(
    normalizeDashboardPetIds(["pet-1", "pet-2", "pet-3"], 3, [
      "pet-3",
      "unknown",
      "pet-3",
      "pet-1"
    ]),
    ["pet-3", "pet-1", "pet-2"]
  );
  assert.deepEqual(
    pickDashboardPets(
      [{ id: "pet-1" }, { id: "pet-2" }, { id: "pet-3" }],
      2,
      ["pet-2"]
    ).map((pet) => pet.id),
    ["pet-2", "pet-1"]
  );
});

test("表示数変更は選択順を保ち、必要な場合だけPetを補完する", () => {
  assert.deepEqual(
    resizeDashboardPetIds(["pet-1", "pet-2", "pet-3"], ["pet-3", "pet-1", "pet-2"], 2),
    ["pet-3", "pet-1"]
  );
  assert.deepEqual(
    resizeDashboardPetIds(["pet-1", "pet-2"], [], 3),
    ["pet-1", "pet-2"]
  );
});

test("Pet選択の解除・復元は元位置を優先し、上限を超えない", () => {
  const initial = ["pet-1", "pet-2", "pet-3"];
  const position = getDashboardPetRemovalPosition(initial, "pet-2");
  const removed = toggleDashboardPetId(initial, "pet-2", 3);
  assert.deepEqual(removed, ["pet-1", "pet-3"]);
  assert.deepEqual(toggleDashboardPetId(removed, "pet-2", 3, position), initial);
  assert.deepEqual(toggleDashboardPetId(initial, "pet-4", 3), initial);
});

test("Petカードをbefore・afterへ安定して移動する", () => {
  const ids = ["pet-1", "pet-2", "pet-3", "pet-4"];
  assert.deepEqual(moveDashboardPetId(ids, "pet-1", "pet-3", "before"), [
    "pet-2",
    "pet-1",
    "pet-3",
    "pet-4"
  ]);
  assert.deepEqual(moveDashboardPetId(ids, "pet-4", "pet-2", "after"), [
    "pet-1",
    "pet-2",
    "pet-4",
    "pet-3"
  ]);
  assert.deepEqual(moveDashboardPetId(ids, "unknown", "pet-2", "before"), ids);
  assert.equal(getDashboardDropPosition(49, { top: 0, height: 100 }), "before");
  assert.equal(getDashboardDropPosition(50, { top: 0, height: 100 }), "after");
});

test("保存前に重複・未知ID・選択過不足を判定する", () => {
  const validIds = ["pet-1", "pet-2"];
  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-1", "pet-1"]), "duplicate");
  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-1", "other"]), "unknown");
  assert.equal(getDashboardPetSelectionError(validIds, 1, validIds), "tooMany");
  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-1"]), "tooFew");
  assert.equal(getDashboardPetSelectionError(validIds, 2, ["pet-2", "pet-1"]), null);
});

test("dashboard schemaはPet IDの重複と表示数範囲を拒否する", () => {
  assert.equal(
    dashboardSettingsSchema.safeParse({
      dashboardBoardCount: "2",
      recordTimelineDefaultScope: "household",
      petIds: ["pet-1", "pet-1"]
    }).success,
    false
  );
  assert.equal(
    dashboardSettingsSchema.safeParse({
      dashboardBoardCount: "2",
      recordTimelineDefaultScope: "household",
      petIds: ["pet-1", "pet-2"]
    }).success,
    true
  );
});

test("設定フォームとActionはPet選択・並び順と記録画面scopeを保存する", () => {
  const form = source("src/components/dashboard-settings-form.tsx");
  const action = source("src/app/actions/settings.ts");
  const query = source("src/lib/queries.ts");

  assert.match(form, /name="dashboardBoardCount"/);
  assert.match(form, /name="petIds"/);
  assert.match(form, /DisplaySettingsSection/);
  assert.match(form, /moveDashboardPetId/);
  assert.match(form, /getDashboardPetRemovalPosition/);
  assert.match(action, /getDashboardPetSelectionError/);
  assert.match(action, /tx\.dashboardPet\.deleteMany/);
  assert.match(action, /tx\.dashboardPet\.create/);
  assert.match(action, /recordTimelineDefaultScope/);
  assert.match(query, /dashboardPets/);
  assert.doesNotMatch([form, action, query].join("\n"), /tokens truncated/);
});
