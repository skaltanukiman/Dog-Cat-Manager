import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldShowSettingsScrollButton } from "../src/components/settings-layout";
import { dashboardSettingsSchema } from "../src/lib/schemas";
import { getSettingsChanges, type SettingsSnapshot } from "../src/lib/settings-diff";
import "./household-name.test";

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const current: SettingsSnapshot = {
  name: "山田 太郎",
  dashboardBoardCount: 2,
  petIds: ["pet-1", "pet-2"]
};

test("設定が同一ならプロフィール・ダッシュボードとも変更なしになる", () => {
  assert.deepEqual(getSettingsChanges(current, { ...current }), {
    profileChanged: false,
    dashboardChanged: false
  });
});

test("表示名だけの変更を検知する", () => {
  assert.deepEqual(getSettingsChanges(current, { ...current, name: "山田 花子" }), {
    profileChanged: true,
    dashboardChanged: false
  });
});

test("表示件数と対象順序の変更を検知する", () => {
  assert.equal(getSettingsChanges(current, { ...current, dashboardBoardCount: 3 }).dashboardChanged, true);
  assert.equal(
    getSettingsChanges(current, { ...current, petIds: ["pet-2", "pet-1"] }).dashboardChanged,
    true
  );
});

test("ダッシュボード設定は重複したPet IDを拒否する", () => {
  assert.equal(
    dashboardSettingsSchema.safeParse({
      dashboardBoardCount: 2,
      petIds: ["pet-1", "pet-1"]
    }).success,
    false
  );
  assert.equal(
    dashboardSettingsSchema.safeParse({
      dashboardBoardCount: 2,
      petIds: ["pet-1", "pet-2"]
    }).success,
    true
  );
});

test("設定カードは固定ボタン回避用の余白とxlでの解除タイミングを共有する", () => {
  const layout = readSource("src/components/settings-layout.ts");
  const sources = [
    readSource("src/components/dashboard-settings-form.tsx"),
    readSource("src/components/account-delete-entry-form.tsx")
  ];

  assert.match(layout, /py-5 pl-5 pr-16 sm:pr-20 xl:p-5/);
  for (const source of sources) {
    assert.match(source, /SETTINGS_CARD_RESPONSIVE_PADDING/);
  }
});

test("アカウント削除入口はmd未満で縦並びを維持する", () => {
  const source = readSource("src/components/account-delete-entry-form.tsx");
  assert.match(source, /md:flex-row md:items-center md:justify-between/);
  assert.doesNotMatch(source, /sm:flex-row/);
});

test("保存位置への固定ボタンは保存ボタンが画面より下にある間だけ操作可能にする", () => {
  const source = readSource("src/components/settings-scroll-to-save-button.tsx");

  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /shouldShowSettingsScrollButton/);
  assert.match(source, /addEventListener\("scroll", updateFromTargetPosition/);
  assert.match(source, /addEventListener\("resize", updateFromTargetPosition/);
  assert.match(source, /behavior: "smooth"/);
  assert.match(source, /aria-label="保存ボタンまでスクロール"/);
  assert.match(source, /tabIndex=\{isVisible \? 0 : -1\}/);

  assert.equal(
    shouldShowSettingsScrollButton({ isIntersecting: false, targetTop: 901, viewportBottom: 900 }),
    true
  );
  assert.equal(
    shouldShowSettingsScrollButton({ isIntersecting: true, targetTop: 850, viewportBottom: 900 }),
    false
  );
  assert.equal(
    shouldShowSettingsScrollButton({ isIntersecting: false, targetTop: -50, viewportBottom: 900 }),
    false
  );
});
