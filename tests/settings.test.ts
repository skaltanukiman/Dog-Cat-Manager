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
  recordTimelineDefaultScope: "household",
  petIds: ["pet-1", "pet-2"]
};

test("設定が同一ならプロフィール・ダッシュボードとも変更なしになる", () => {
  assert.deepEqual(getSettingsChanges(current, { ...current }), {
    profileChanged: false,
    recordTimelineDefaultScopeChanged: false,
    dashboardChanged: false
  });
});

test("表示名だけの変更を検知する", () => {
  assert.deepEqual(getSettingsChanges(current, { ...current, name: "山田 花子" }), {
    profileChanged: true,
    recordTimelineDefaultScopeChanged: false,
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

test("記録画面scopeだけの変更をダッシュボード変更と分けて検知する", () => {
  assert.deepEqual(
    getSettingsChanges(current, { ...current, recordTimelineDefaultScope: "pet" }),
    {
      profileChanged: false,
      recordTimelineDefaultScopeChanged: true,
      dashboardChanged: false
    }
  );
});

test("ダッシュボード設定は重複したPet IDを拒否する", () => {
  assert.equal(
    dashboardSettingsSchema.safeParse({
      dashboardBoardCount: 2,
      recordTimelineDefaultScope: "household",
      petIds: ["pet-1", "pet-1"]
    }).success,
    false
  );
  assert.equal(
    dashboardSettingsSchema.safeParse({
      dashboardBoardCount: 2,
      recordTimelineDefaultScope: "household",
      petIds: ["pet-1", "pet-2"]
    }).success,
    true
  );
});

test("記録画面の初期scopeはpetとhouseholdだけを許可する", () => {
  for (const recordTimelineDefaultScope of ["pet", "household"]) {
    assert.equal(
      dashboardSettingsSchema.safeParse({
        dashboardBoardCount: 2,
        recordTimelineDefaultScope,
        petIds: ["pet-1", "pet-2"]
      }).success,
      true
    );
  }
  assert.equal(
    dashboardSettingsSchema.safeParse({
      dashboardBoardCount: 2,
      recordTimelineDefaultScope: "invalid",
      petIds: ["pet-1", "pet-2"]
    }).success,
    false
  );
});

test("画面の表示設定は記録画面scopeの2択とhousehold初期表示をフォームへ統合する", () => {
  const section = readSource("src/components/display-settings-section.tsx");
  const form = readSource("src/components/dashboard-settings-form.tsx");

  assert.match(section, /画面の表示設定/);
  assert.match(section, /各画面の初期表示を変更します。/);
  assert.match(section, /記録画面の初期表示/);
  assert.match(section, /選択中のPet/);
  assert.match(section, /共有グループ全体/);
  assert.match(section, /name="recordTimelineDefaultScope"/);
  assert.match(section, /value: "pet"/);
  assert.match(section, /value: "household"/);
  assert.match(form, /<ProfileSettingsFields[\s\S]*<DisplaySettingsSection[\s\S]*data-settings-section="dashboard"/);
  assert.match(form, /recordTimelineDefaultScope[\s\S]*defaultChecked = control\.checked/);
});

test("表示設定だけの保存はAppSettingを更新し、DashboardPetを再作成しない", () => {
  const action = readSource("src/app/actions/settings.ts");

  assert.match(action, /dashboardChanged \|\| recordTimelineDefaultScopeChanged/);
  assert.match(action, /update: \{[\s\S]*recordTimelineDefaultScope[\s\S]*create: \{[\s\S]*recordTimelineDefaultScope/);
  assert.match(action, /if \(dashboardChanged\) \{[\s\S]*dashboardPet\.deleteMany[\s\S]*dashboardPet\.create/);
  assert.match(action, /\{ path: "\/records" \}/);
});

test("AppSettingの記録画面scopeはDBでもhouseholdをdefaultにする追加migrationを持つ", () => {
  const schema = readSource("prisma/schema.prisma");
  const migration = readSource(
    "prisma/migrations/20260816120000_add_record_timeline_default_scope/migration.sql"
  );

  assert.match(schema, /recordTimelineDefaultScope String\s+@default\("household"\)/);
  assert.match(migration, /ADD COLUMN "recordTimelineDefaultScope" TEXT NOT NULL DEFAULT 'household'/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
});

test("設定カードは固定ボタン回避用と通常用の余白を用途別に使い分ける", () => {
  const layout = readSource("src/components/settings-layout.ts");
  const scrollSafeSources = [
    readSource("src/components/dashboard-settings-form.tsx"),
    readSource("src/components/profile-settings-form.tsx"),
    readSource("src/components/display-settings-section.tsx")
  ];
  const standardSources = [
    readSource("src/components/care-day-settings-form.tsx"),
    readSource("src/components/contact-support-entry.tsx"),
    readSource("src/components/account-delete-entry-form.tsx")
  ];

  assert.match(layout, /py-5 pl-5 pr-24 sm:pr-24 xl:p-5/);
  assert.match(layout, /SETTINGS_CARD_SCROLL_SAFE_CONTENT_EXPAND = "-mr-11 sm:mr-0"/);
  assert.match(layout, /SETTINGS_CARD_STANDARD_PADDING = "p-5"/);
  for (const source of scrollSafeSources) {
    assert.match(source, /SETTINGS_CARD_SCROLL_BUTTON_SAFE_PADDING/);
    assert.match(source, /SETTINGS_CARD_SCROLL_SAFE_CONTENT_EXPAND/);
  }
  for (const source of standardSources) {
    assert.match(source, /SETTINGS_CARD_STANDARD_PADDING/);
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
