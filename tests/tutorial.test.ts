import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CURRENT_ONBOARDING_VERSION,
  createInitialTutorialProgress,
  createReplayTutorialProgress,
  isOnboardingRequired,
  markTutorialPetCreated,
  parseTutorialProgress
} from "../src/lib/tutorial";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("現在version未満のユーザーだけ初回オンボーディング対象になる", () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.equal(isOnboardingRequired(0), true);
  assert.equal(isOnboardingRequired(CURRENT_ONBOARDING_VERSION), false);
  assert.equal(isOnboardingRequired(CURRENT_ONBOARDING_VERSION + 1), false);
  assert.equal(isOnboardingRequired(CURRENT_ONBOARDING_VERSION - 1), true);
});

test("初回と再確認は別modeで、VIEWER相当は登録要求のない説明phaseから始まる", () => {
  assert.deepEqual(createInitialTutorialProgress(true), {
    mode: "initial",
    phase: "dashboard-register"
  });
  assert.deepEqual(createInitialTutorialProgress(false), {
    mode: "initial",
    phase: "replay-overview"
  });
  assert.deepEqual(createReplayTutorialProgress(), {
    mode: "replay",
    phase: "replay-overview"
  });
});

test("ページ間の進行状態は既知値だけをsessionStorageから復元する", () => {
  assert.deepEqual(
    parseTutorialProgress('{"mode":"initial","phase":"pets-create"}'),
    { mode: "initial", phase: "pets-create" }
  );
  assert.deepEqual(
    parseTutorialProgress('{"mode":"initial","phase":"records-entry"}'),
    { mode: "initial", phase: "records-entry" }
  );
  assert.deepEqual(
    parseTutorialProgress('{"mode":"replay","phase":"sharing-entry"}'),
    { mode: "replay", phase: "sharing-entry" }
  );
  assert.equal(parseTutorialProgress('{"mode":"unknown","phase":"pets-create"}'), null);
  assert.equal(parseTutorialProgress('{"mode":"initial","phase":"unknown"}'), null);
  assert.equal(parseTutorialProgress("not-json"), null);
});

test("Pet登録失敗相当ではphaseを進めず、DB作成成功後のPet IDでだけ登録完了へ進む", () => {
  const creating = createInitialTutorialProgress(true);
  const petsPage = { ...creating, phase: "pets-create" as const };

  assert.equal(markTutorialPetCreated(petsPage, ""), petsPage);
  assert.deepEqual(markTutorialPetCreated(petsPage, "pet-created-in-db"), {
    mode: "initial",
    phase: "pets-created",
    createdPetId: "pet-created-in-db"
  });
  const replay = createReplayTutorialProgress();
  assert.equal(markTutorialPetCreated(replay, "pet-1"), replay);
});

test("完了versionはHousehold別AppSettingではなくUserへ保存する", async () => {
  const [schema, migration, action] = await Promise.all([
    source("prisma/schema.prisma"),
    source("prisma/migrations/20260824200000_add_user_onboarding_version/migration.sql"),
    source("src/app/actions/tutorial.ts")
  ]);
  const userModel = schema.slice(schema.indexOf("model User {"), schema.indexOf("model UserAccessAction"));
  const appSettingModel = schema.slice(schema.indexOf("model AppSetting {"), schema.indexOf("model DashboardPet"));

  assert.match(userModel, /onboardingVersion\s+Int\s+@default\(0\)\s+@map\("onboarding_version"\)/);
  assert.doesNotMatch(appSettingModel, /onboarding/i);
  assert.match(migration, /ADD COLUMN "onboarding_version" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CHECK \("onboarding_version" >= 0\)/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
  assert.match(action, /onboardingVersion: \{ lt: CURRENT_ONBOARDING_VERSION \}/);
  assert.match(action, /data: \{ onboardingVersion: CURRENT_ONBOARDING_VERSION \}/);
});

test("初回は共有説明で初めて完了し、再確認はDB更新せず進行状態だけ削除する", async () => {
  const provider = await source("src/components/tutorial-provider.tsx");
  const careEntry = provider.slice(
    provider.indexOf('progress.phase === "care-entry"'),
    provider.indexOf('progress.phase === "records-entry"')
  );
  const sharingEntry = provider.slice(
    provider.indexOf('progress.phase === "sharing-entry"'),
    provider.indexOf("if (!steps) return")
  );

  assert.match(provider, /if \(progress\?\.mode === "initial"\) \{\s*await completeInitial\(\)/);
  assert.doesNotMatch(careEntry, /completeInitial/);
  assert.match(sharingEntry, /doneBtnText: "ガイドを完了"/);
  assert.match(sharingEntry, /if \(progress\.mode === "initial"\) \{\s*void completeInitial\(\)/);
  assert.match(sharingEntry, /else \{\s*driverRef\.current\?\.destroy\(\);\s*saveProgress\(null\)/);
  assert.doesNotMatch(provider, /onboardingVersion\s*=\s*0|onboardingVersion:\s*0/);
});

test("記録・共有へ遷移した後もinitialのスキップだけを完了保存する", async () => {
  const provider = await source("src/components/tutorial-provider.tsx");
  const closeOrSkip = provider.slice(
    provider.indexOf("const closeOrSkip"),
    provider.indexOf("const startInitial")
  );

  assert.match(closeOrSkip, /if \(progress\?\.mode === "initial"\) \{\s*await completeInitial\(\);\s*return/);
  assert.match(closeOrSkip, /driverRef\.current\?\.destroy\(\);\s*saveProgress\(null\)/);
  assert.doesNotMatch(closeOrSkip, /phase/);
});

test("お世話から記録、共有へ直接遷移し、5種類の用途を1ステップで説明する", async () => {
  const provider = await source("src/components/tutorial-provider.tsx");
  const careEntry = provider.slice(
    provider.indexOf('progress.phase === "care-entry"'),
    provider.indexOf('progress.phase === "records-entry"')
  );
  const recordsEntry = provider.slice(
    provider.indexOf('progress.phase === "records-entry"'),
    provider.indexOf('progress.phase === "sharing-entry"')
  );

  assert.match(careEntry, /phase: "records-entry"/);
  assert.match(careEntry, /router\.push\("\/records"\)/);
  assert.match(recordsEntry, /element: recordEntryTarget\(\)/);
  assert.match(recordsEntry, /title: "健康や思い出を記録できます"/);
  for (const kind of ["体調", "通院", "投薬", "ワクチン", "思い出"]) {
    assert.match(recordsEntry, new RegExp(kind));
  }
  assert.match(recordsEntry, /phase: "sharing-entry"/);
  assert.match(recordsEntry, /router\.push\("\/settings\/members"\)/);
});

test("再確認の既存説明後も共通の記録・共有phaseへ進み、終了時はsessionStorageを削除する", async () => {
  const provider = await source("src/components/tutorial-provider.tsx");
  const replayOverview = provider.slice(
    provider.indexOf('progress.phase === "replay-overview"'),
    provider.indexOf('progress.mode === "initial" && progress.phase === "dashboard-register"')
  );

  for (const title of ["ペット管理", "お世話", "記録", "体重"]) {
    assert.match(replayOverview, new RegExp(title));
  }
  assert.match(replayOverview, /phase: "records-entry"/);
  assert.match(replayOverview, /router\.push\("\/records"\)/);
  assert.match(provider, /window\.sessionStorage\.removeItem\(TUTORIAL_SESSION_STORAGE_KEY\)/);
});

test("Pet作成成功URLはtransactionで作成された実Pet IDを渡し、失敗stateはredirectしない", async () => {
  const actions = await source("src/app/actions/pets.ts");
  const start = actions.indexOf("export async function createPet");
  const end = actions.indexOf("export async function updatePet", start);
  const createAction = actions.slice(start, end);

  assert.match(createAction, /tx\.pet\.create/);
  assert.match(createAction, /result: createdPet, change/);
  assert.match(createAction, /createdPetId=\$\{encodeURIComponent\(createdPet\.id\)\}/);
  assert.match(createAction, /createPetErrorState\(previousState/);
  assert.doesNotMatch(createAction, /tutorial.*pet\.create|dummy|ダミー/i);
});

test("初回ツアーは実画面の安定したDOMターゲットを使用する", async () => {
  const [dashboard, petsPage, petForm, carePage, recordsPage, recordForms, membersPage, nav] = await Promise.all([
    source("src/app/(app)/page.tsx"),
    source("src/app/(app)/pets/page.tsx"),
    source("src/components/pet-create-form.tsx"),
    source("src/app/(app)/care/page.tsx"),
    source("src/app/(app)/records/page.tsx"),
    source("src/components/pet-record-create-forms.tsx"),
    source("src/app/(app)/settings/members/page.tsx"),
    source("src/components/app-nav.tsx")
  ]);

  for (const target of [
    "dashboard-pet-register",
    "dashboard-care-button",
    "pet-create-form",
    "pet-create-submit",
    "care-entry",
    "records-overview",
    "record-kind-selector",
    "sharing-overview"
  ]) {
    assert.match(
      `${dashboard}\n${petsPage}\n${petForm}\n${carePage}\n${recordsPage}\n${recordForms}\n${membersPage}`,
      new RegExp(`data-tutorial="${target}"`)
    );
  }
  for (const target of ["pets", "records", "weights"]) {
    assert.match(nav, new RegExp(`nav-${target}-mobile`));
    assert.match(nav, new RegExp(`nav-${target}-desktop`));
  }
});

test("Pet作成成功Bridgeは現在Householdの一覧に実在するPetだけへ描画される", async () => {
  const [page, dashboard, queries] = await Promise.all([
    source("src/app/(app)/pets/page.tsx"),
    source("src/app/(app)/page.tsx"),
    source("src/lib/queries.ts")
  ]);

  assert.match(page, /pets\.find\(\(pet\) => pet\.id === getParam\(params\.createdPetId\)\)/);
  assert.match(page, /createdPet \? <TutorialPetCreatedBridge petId=\{createdPet\.id\}/);
  assert.match(dashboard, /getDashboardData\(getParam\(params\.tutorialPetId\)\)/);
  assert.match(queries, /pets\.find\(\(pet\) => pet\.id === tutorialPetId && pet\.isActive\)/);
  assert.match(queries, /\[tutorialPet, \.\.\.selectedDashboardPets\]\.slice\(0, boardCount\)/);
  assert.doesNotMatch(queries, /tutorialPet[\s\S]*dashboardPet\.(?:create|update|delete)/);
});

test("再確認ツアーはPet 0件でPet固有stepを省略し、全操作を無効化する", async () => {
  const provider = await source("src/components/tutorial-provider.tsx");

  assert.match(provider, /\.\.\.\(hasPets[\s\S]*dashboard-care-button[\s\S]*:\s*\[\]\)/);
  assert.match(provider, /まずペットを登録してください/);
  assert.match(provider, /このガイドでは登録を強制しません/);
  assert.match(provider, /disableActiveInteraction: true/);
  assert.doesNotMatch(provider, /createPet(?:Feeding|Water|Walk|Litter)Record/);
});

test("対象DOM欠落は待機後にskipし、例外や完了保存へ変換しない", async () => {
  const provider = await source("src/components/tutorial-provider.tsx");

  assert.match(provider, /waitForElement: 2500/);
  assert.match(provider, /skipMissingElement: true/);
  assert.match(provider, /document\.querySelector\(selector\) \? selector : '\[data-tutorial="records-overview"\]'/);
  assert.doesNotMatch(provider, /onDestroyed:[\s\S]*completeInitial/);
});

test("スマホ・キーボード・読み上げ・reduced motion向け設定を持つ", async () => {
  const [provider, styles] = await Promise.all([
    source("src/components/tutorial-provider.tsx"),
    source("src/app/globals.css")
  ]);

  assert.match(provider, /role="dialog"/);
  assert.match(provider, /aria-modal="true"/);
  assert.match(provider, /event\.key === "Escape"/);
  assert.match(provider, /event\.key !== "Tab"/);
  assert.match(provider, /prefers-reduced-motion: reduce/);
  assert.match(styles, /max-width: calc\(100vw - 1\.5rem\)/);
  assert.match(styles, /@media \(max-width: 360px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
