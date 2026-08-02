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
  hamsterSelectorMode: "select",
  recordTimelineDefaultScope: "hamster",
  cleaningMobileDefaultDateFilter: "today",
  hamsterIds: ["hamster-1", "hamster-2"]
};

test("設定が同一ならプロフィール・ダッシュボードとも変更なしになる", () => {
  assert.deepEqual(getSettingsChanges(current, { ...current }), {
    profileChanged: false,
    recordTimelineDefaultScopeChanged: false,
    cleaningMobileDefaultDateFilterChanged: false,
    dashboardChanged: false
  });
});

test("表示名だけの変更を検知する", () => {
  assert.deepEqual(getSettingsChanges(current, { ...current, name: "山田 花子" }), {
    profileChanged: true,
    recordTimelineDefaultScopeChanged: false,
    cleaningMobileDefaultDateFilterChanged: false,
    dashboardChanged: false
  });
});

test("表示件数・選択方式・対象順序の変更をそれぞれ検知する", () => {
  assert.equal(getSettingsChanges(current, { ...current, dashboardBoardCount: 3 }).dashboardChanged, true);
  assert.equal(getSettingsChanges(current, { ...current, hamsterSelectorMode: "combobox" }).dashboardChanged, true);
  assert.equal(
    getSettingsChanges(current, { ...current, hamsterIds: ["hamster-2", "hamster-1"] }).dashboardChanged,
    true
  );
});

test("ダッシュボード設定は重複したハムスターIDを拒否する", () => {
  assert.equal(
    dashboardSettingsSchema.safeParse({
      dashboardBoardCount: 2,
      hamsterSelectorMode: "select",
      recordTimelineDefaultScope: "hamster",
      cleaningMobileDefaultDateFilter: "today",
      hamsterIds: ["hamster-1", "hamster-1"]
    }).success,
    false
  );
});

test("記録画面の初期表示だけの変更をダッシュボード変更と分けて検知する", () => {
  assert.deepEqual(
    getSettingsChanges(current, { ...current, recordTimelineDefaultScope: "household" }),
    {
      profileChanged: false,
      recordTimelineDefaultScopeChanged: true,
      cleaningMobileDefaultDateFilterChanged: false,
      dashboardChanged: false
    }
  );
});

test("記録画面の初期表示設定はhamsterとhouseholdだけを受け付ける", () => {
  const input = {
    dashboardBoardCount: 2,
    hamsterSelectorMode: "select",
    cleaningMobileDefaultDateFilter: "today",
    hamsterIds: ["hamster-1", "hamster-2"]
  };

  assert.equal(
    dashboardSettingsSchema.safeParse({ ...input, recordTimelineDefaultScope: "hamster" }).success,
    true
  );
  assert.equal(
    dashboardSettingsSchema.safeParse({ ...input, recordTimelineDefaultScope: "household" }).success,
    true
  );
  assert.equal(
    dashboardSettingsSchema.safeParse({ ...input, recordTimelineDefaultScope: "invalid" }).success,
    false
  );
});

test("衛生管理画面のスマホ初期表示設定はtodayとallだけを受け付ける", () => {
  const input = {
    dashboardBoardCount: 2,
    hamsterSelectorMode: "select",
    recordTimelineDefaultScope: "hamster",
    hamsterIds: ["hamster-1", "hamster-2"]
  };

  assert.equal(
    dashboardSettingsSchema.safeParse({ ...input, cleaningMobileDefaultDateFilter: "today" }).success,
    true
  );
  assert.equal(
    dashboardSettingsSchema.safeParse({ ...input, cleaningMobileDefaultDateFilter: "all" }).success,
    true
  );
  assert.equal(
    dashboardSettingsSchema.safeParse({ ...input, cleaningMobileDefaultDateFilter: "invalid" }).success,
    false
  );
});

test("衛生管理画面のスマホ初期表示だけの変更を差分として検知する", () => {
  assert.deepEqual(
    getSettingsChanges(current, { ...current, cleaningMobileDefaultDateFilter: "all" }),
    {
      profileChanged: false,
      recordTimelineDefaultScopeChanged: false,
      cleaningMobileDefaultDateFilterChanged: true,
      dashboardChanged: false
    }
  );
});

test("記録画面の初期表示は設定フォーム・保存Action・AppSettingへ統合される", () => {
  const form = readSource("src/components/display-settings-section.tsx");
  const action = readSource("src/app/actions/settings.ts");
  const schema = readSource("src/lib/schemas.ts");
  const prismaSchema = readSource("prisma/schema.prisma");
  const migration = readSource(
    "prisma/migrations/20260724090000_add_record_timeline_default_scope/migration.sql"
  );

  assert.match(form, /記録画面の初期表示/);
  assert.match(form, /const RECORD_SCOPE_OPTIONS[\s\S]*?value: "hamster"[\s\S]*?value: "household"/);
  assert.match(form, /name="recordTimelineDefaultScope"/);
  assert.match(form, /選択した1匹の記録を表示します。/);
  assert.match(form, /現在の共有グループに所属する全ハムスターの記録を表示します。/);
  assert.match(schema, /recordTimelineDefaultScope: z\.enum\(RECORD_SCOPES\)/);
  assert.match(action, /recordTimelineDefaultScopeChanged/);
  assert.match(action, /dashboardChanged \|\| recordTimelineDefaultScopeChanged/);
  assert.match(action, /if \(dashboardChanged\) \{[\s\S]*?dashboardHamster\.deleteMany/);
  assert.match(action, /userId_householdId: \{ userId: context\.user\.id, householdId: context\.household\.id \}/);
  assert.match(action, /\{ path: "\/records" \}/);
  assert.match(prismaSchema, /recordTimelineDefaultScope\s+String\s+@default\("hamster"\)/);
  assert.match(migration, /ADD COLUMN "recordTimelineDefaultScope" TEXT NOT NULL DEFAULT 'hamster'/);
  assert.doesNotMatch(action, /createHouseholdActivity/);
});

test("衛生管理画面のスマホ初期表示は設定フォーム・保存Action・AppSettingへ統合される", () => {
  const form = readSource("src/components/display-settings-section.tsx");
  const action = readSource("src/app/actions/settings.ts");
  const schema = readSource("src/lib/schemas.ts");
  const prismaSchema = readSource("prisma/schema.prisma");
  const migration = readSource(
    "prisma/migrations/20260727090000_add_cleaning_mobile_default_date_filter/migration.sql"
  );

  assert.match(
    form,
    /const CLEANING_DATE_FILTER_OPTIONS[\s\S]*?value: "today"[\s\S]*?value: "all"/
  );
  assert.match(form, /name="cleaningMobileDefaultDateFilter"/);
  assert.match(form, /label: "当日のみ"/);
  assert.match(form, /label: "すべての日付"/);
  assert.match(schema, /cleaningMobileDefaultDateFilter: z\.enum\(CLEANING_MOBILE_DEFAULT_DATE_FILTERS\)/);
  assert.match(action, /cleaningMobileDefaultDateFilterChanged/);
  assert.match(
    action,
    /dashboardChanged \|\| recordTimelineDefaultScopeChanged \|\| cleaningMobileDefaultDateFilterChanged/
  );
  assert.match(action, /update: \{[\s\S]*?cleaningMobileDefaultDateFilter[\s\S]*?\}/);
  assert.match(prismaSchema, /cleaningMobileDefaultDateFilter String\s+@default\("today"\)/);
  assert.match(migration, /ADD COLUMN "cleaningMobileDefaultDateFilter" TEXT NOT NULL DEFAULT 'today'/);
});

test("設定カードは固定ボタン回避用の余白とxlでの解除タイミングを共有する", () => {
  const layout = readSource("src/components/settings-layout.ts");
  const sources = [
    readSource("src/components/profile-settings-form.tsx"),
    readSource("src/components/display-settings-section.tsx"),
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
  assert.match(source, /focus-visible:outline/);

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
