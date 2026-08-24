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
  assert.ok(CURRENT_ONBOARDING_VERSION > 0);
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

test("初回のスキップと完了だけがcurrent version保存Actionを呼ぶ", async () => {
  const provider = await source("src/components/tutorial-provider.tsx");

  assert.match(provider, /if \(progress\?\.mode === "initial"\) \{\s*await completeInitial\(\)/);
  assert.match(provider, /progress\.mode === "initial"[\s\S]*void completeInitial\(\)/);
  assert.match(provider, /doneBtnText: "ガイドを完了"[\s\S]*onDoneClick: \(\) => void completeInitial\(\)/);
  assert.match(provider, /if \(progress\.mode === "initial"\)[\s\S]*else \{[\s\S]*saveProgress\(null\)/);
  assert.doesNotMatch(provider, /onboardingVersion\s*=\s*0|onboardingVersion:\s*0/);
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
  const [dashboard, petsPage, petForm, carePage, nav] = await Promise.all([
    source("src/app/(app)/page.tsx"),
    source("src/app/(app)/pets/page.tsx"),
    source("src/components/pet-create-form.tsx"),
    source("src/app/(app)/care/page.tsx"),
    source("src/components/app-nav.tsx")
  ]);

  for (const target of [
    "dashboard-pet-register",
    "dashboard-care-button",
    "pet-create-form",
    "pet-create-submit",
    "care-entry"
  ]) {
    assert.match(`${dashboard}\n${petsPage}\n${petForm}\n${carePage}`, new RegExp(`data-tutorial="${target}"`));
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
