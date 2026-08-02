import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

import type { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";

import { rebuildPublicDemoData } from "../prisma/seed-demo";
import { DemoHamsterCreatePreview } from "../src/components/demo-hamster-create-preview";
import { DEMO_NAV_ITEMS } from "../src/components/demo-nav";
import {
  DEMO_RECORD_PREVIEW_TABS,
  DemoRecordCreateFormsPreview
} from "../src/components/demo-record-create-forms-preview";
import { DemoWeightCreatePreview } from "../src/components/demo-weight-create-preview";
import { HamsterThumbnail } from "../src/components/hamster-thumbnail";
import { parseDateInput, todayInputJst } from "../src/lib/date";
import {
  isPublicDemoHousehold,
  isPublicDemoPath,
  getPublicDemoHamsterImagePath,
  PUBLIC_DEMO_HAMSTER_IDS,
  PUBLIC_DEMO_HOUSEHOLD_ID,
  PUBLIC_DEMO_RECORD_IDS,
  PUBLIC_DEMO_SLUG
} from "../src/lib/public-demo";
import { getPublicDemoHousehold } from "../src/lib/public-demo-queries";

test("/demo とその配下だけを公開デモ経路として判定する", () => {
  assert.equal(isPublicDemoPath("/demo"), true);
  assert.equal(isPublicDemoPath("/demo/"), true);
  assert.equal(isPublicDemoPath("/demo/weights"), true);
  assert.equal(isPublicDemoPath("/demo/records/detail"), true);
  assert.equal(isPublicDemoPath("/demonstration"), false);
  assert.equal(isPublicDemoPath("/demo-example"), false);
  assert.equal(isPublicDemoPath("/"), false);
  assert.equal(isPublicDemoPath("/hamsters"), false);
  assert.equal(isPublicDemoPath("/weights"), false);
});

test("認証ガードはデモだけを公開し、通常画面のログイン要求を維持する", async () => {
  const source = await readFile("src/proxy.ts", "utf8");
  assert.match(source, /isPublicDemoPath\(pathname\)/);
  assert.match(source, /if \(isPublicDemoPath\(nextUrl\.pathname\)\)/);
  assert.match(source, /if \(!isLoggedIn\)/);
  assert.match(source, /new URL\("\/login", nextUrl\)/);
  assert.match(source, /loginUrl\.searchParams\.set\("callbackUrl", callbackUrl\)/);
});

test("公開デモHousehold取得はisDemoと固定slugの両方を必須にし、結果なしをそのまま返す", async () => {
  let capturedArgs: unknown;
  let calls = 0;
  const result = await getPublicDemoHousehold({
    async findFirst(args) {
      calls += 1;
      capturedArgs = args;
      return null;
    }
  });

  assert.equal(result, null);
  assert.equal(calls, 1);
  assert.deepEqual(capturedArgs, {
    where: { isDemo: true, demoSlug: PUBLIC_DEMO_SLUG },
    select: { id: true, name: true }
  });
  assert.equal(isPublicDemoHousehold({ isDemo: true, demoSlug: PUBLIC_DEMO_SLUG }), true);
  assert.equal(isPublicDemoHousehold({ isDemo: false, demoSlug: PUBLIC_DEMO_SLUG }), false);
  assert.equal(isPublicDemoHousehold({ isDemo: true, demoSlug: "another-demo" }), false);
});

test("デモseedは再実行しても固定デモ1件を再構築し、通常Householdを変更しない", async () => {
  type HouseholdState = {
    id: string;
    name: string;
    isDemo: boolean;
    demoSlug: string | null;
    memberCount: number;
    data?: unknown;
  };
  const households: HouseholdState[] = [
    {
      id: "normal-household",
      name: "通常の共有",
      isDemo: false,
      demoSlug: null,
      memberCount: 2
    }
  ];
  const deletedIds: string[] = [];
  let memoryTargetRows: Array<{ hamsterRecordId: string; hamsterId: string; sortOrder: number }> = [];

  const transactionClient = {
    household: {
      async findUnique({ where }: { where: { demoSlug?: string; id?: string } }) {
        const found = households.find((household) =>
          where.demoSlug ? household.demoSlug === where.demoSlug : household.id === where.id
        );
        return found
          ? {
              id: found.id,
              isDemo: found.isDemo,
              demoSlug: found.demoSlug,
              _count: { members: found.memberCount }
            }
          : null;
      },
      async delete({ where }: { where: { id: string } }) {
        const index = households.findIndex((household) => household.id === where.id);
        assert.notEqual(index, -1);
        deletedIds.push(where.id);
        households.splice(index, 1);
      },
      async create({ data }: { data: Record<string, unknown> }) {
        households.push({
          id: String(data.id),
          name: String(data.name),
          isDemo: data.isDemo === true,
          demoSlug: typeof data.demoSlug === "string" ? data.demoSlug : null,
          memberCount: 0,
          data
        });
        return data;
      }
    },
    hamsterRecord: {
      async findMany() {
        const demo = households.find((household) => household.id === PUBLIC_DEMO_HOUSEHOLD_ID);
        const data = demo?.data as {
          hamsters?: { create?: Array<{ id: string; records?: { create?: Array<{ id: string; recordType: string }> } }> };
        } | undefined;
        return (data?.hamsters?.create ?? []).flatMap((hamster) =>
          (hamster.records?.create ?? [])
            .filter((record) => record.recordType === "MEMORY")
            .map((record) => ({ id: record.id, hamsterId: hamster.id }))
        );
      }
    },
    memoryRecordHamster: {
      async createMany({ data }: { data: Array<{ hamsterRecordId: string; hamsterId: string; sortOrder: number }> }) {
        memoryTargetRows = data;
        return { count: data.length };
      }
    }
  };
  const client = {
    async $transaction(callback: (tx: typeof transactionClient) => Promise<void>) {
      await callback(transactionClient);
    }
  } as unknown as PrismaClient;

  await rebuildPublicDemoData(client);
  await rebuildPublicDemoData(client);

  assert.equal(households.filter((household) => household.id === "normal-household").length, 1);
  const demos = households.filter((household) => household.isDemo);
  assert.equal(demos.length, 1);
  assert.equal(demos[0].id, PUBLIC_DEMO_HOUSEHOLD_ID);
  assert.equal(demos[0].demoSlug, PUBLIC_DEMO_SLUG);
  assert.deepEqual(deletedIds, [PUBLIC_DEMO_HOUSEHOLD_ID]);
  const sharedTargets = memoryTargetRows.filter((row) => row.hamsterRecordId === PUBLIC_DEMO_RECORD_IDS.kinakoMemory);
  assert.deepEqual(sharedTargets.map((row) => row.hamsterId), [PUBLIC_DEMO_HAMSTER_IDS.kinako, PUBLIC_DEMO_HAMSTER_IDS.monaka]);
  const data = demos[0].data as {
    hamsters: {
      create: Array<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        birthDate: Date;
        adoptionDate: Date;
        feedingRecords?: { create: Array<{ id: string; recordDate: Date; fedAt: Date }> };
        waterReplacementRecords?: {
          create: Array<{ id: string; recordDate: Date; replacedAt: Date }>;
        };
        weightRecords: { create: Array<{ id: string; recordDate: Date }> };
        cleaningRecords: { create: Array<{ id: string; recordDate: Date }> };
        records: { create: Array<{ id: string; recordDate: Date }> };
      }>;
    };
  };
  const hamsters = data.hamsters.create;
  const today = parseDateInput(todayInputJst());

  assert.equal(hamsters.length, 9);
  assert.deepEqual(hamsters.map((hamster) => hamster.id), Object.values(PUBLIC_DEMO_HAMSTER_IDS));
  assert.deepEqual(hamsters.map((hamster) => hamster.name), [
    "きなこ",
    "こむぎ",
    "あずき",
    "もなか",
    "くるみ",
    "ごま",
    "みるく",
    "しらたま",
    "ぽてと"
  ]);
  assert.equal(hamsters.filter((hamster) => hamster.isActive).length, 6);
  assert.equal(hamsters.filter((hamster) => !hamster.isActive).length, 3);
  assert.equal(new Set(hamsters.map((hamster) => hamster.id)).size, 9);
  assert.equal(new Set(hamsters.map((hamster) => hamster.name)).size, 9);
  assert.deepEqual(
    hamsters.map((hamster) => hamster.createdAt.getTime()),
    [...hamsters].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()).map((hamster) => hamster.createdAt.getTime())
  );

  const weights = hamsters.flatMap((hamster) => hamster.weightRecords.create);
  const cleanings = hamsters.flatMap((hamster) => hamster.cleaningRecords.create);
  const feedings = hamsters.flatMap((hamster) => hamster.feedingRecords?.create ?? []);
  const waterReplacements = hamsters.flatMap(
    (hamster) => hamster.waterReplacementRecords?.create ?? []
  );
  const records = hamsters.flatMap((hamster) => hamster.records.create);
  assert.equal(new Set(weights.map((record) => record.id)).size, weights.length);
  assert.equal(new Set(cleanings.map((record) => record.id)).size, cleanings.length);
  assert.equal(feedings.length, 3);
  assert.equal(new Set(feedings.map((record) => record.id)).size, feedings.length);
  assert.equal(waterReplacements.length, 3);
  assert.equal(
    new Set(waterReplacements.map((record) => record.id)).size,
    waterReplacements.length
  );
  assert.equal(new Set(records.map((record) => record.id)).size, records.length);
  assert.deepEqual(records.map((record) => record.id).sort(), Object.values(PUBLIC_DEMO_RECORD_IDS).sort());

  for (const hamster of hamsters) {
    assert.ok(hamster.birthDate <= today);
    assert.ok(hamster.adoptionDate <= today);
    assert.ok(hamster.adoptionDate >= hamster.birthDate);
    for (const record of [
      ...hamster.weightRecords.create,
      ...hamster.cleaningRecords.create,
      ...(hamster.feedingRecords?.create ?? []),
      ...(hamster.waterReplacementRecords?.create ?? []),
      ...hamster.records.create
    ]) {
      assert.ok(record.recordDate <= today);
    }
  }
});

test("デモseedは通常Householdと固定slugまたはIDが競合した場合に中止する", async () => {
  const conflicting = {
    id: PUBLIC_DEMO_HOUSEHOLD_ID,
    isDemo: false,
    demoSlug: null,
    _count: { members: 1 }
  };
  const transactionClient = {
    household: {
      async findUnique({ where }: { where: { demoSlug?: string; id?: string } }) {
        return where.id === PUBLIC_DEMO_HOUSEHOLD_ID ? conflicting : null;
      },
      async delete() {
        assert.fail("通常Householdを削除してはいけません");
      },
      async create() {
        assert.fail("競合時にデモを作成してはいけません");
      }
    }
  };
  const client = {
    async $transaction(callback: (tx: typeof transactionClient) => Promise<void>) {
      await callback(transactionClient);
    }
  } as unknown as PrismaClient;

  await assert.rejects(rebuildPublicDemoData(client), /固定デモIDが通常Household/);
});

test("デモナビゲーションはすべて/demo以下を指す", () => {
  assert.equal(DEMO_NAV_ITEMS.length, 5);
  for (const item of DEMO_NAV_ITEMS) {
    assert.equal(isPublicDemoPath(item.href), true);
  }
});

test("デモ用プロフィール画像は全9体で公開静的パスを直接使用し、認証画像APIを呼ばない", async () => {
  assert.equal(Object.keys(PUBLIC_DEMO_HAMSTER_IDS).length, 9);
  for (const hamsterId of Object.values(PUBLIC_DEMO_HAMSTER_IDS)) {
    const imagePath = getPublicDemoHamsterImagePath(hamsterId);
    assert.ok(imagePath?.startsWith("/demo/hamsters/"));
    await access(resolve("public", imagePath.slice(1)));
  }

  const markup = renderToStaticMarkup(
    <HamsterThumbnail
      hamsterId={PUBLIC_DEMO_HAMSTER_IDS.kinako}
      hamsterName="きなこ"
      profileImageFileName={null}
      staticImagePath="/demo/hamsters/kinako.svg"
    />
  );
  assert.match(markup, /src="\/demo\/hamsters\/kinako\.svg"/);
  assert.doesNotMatch(markup, /\/api\/hamsters\//);
});

test("デモ版ハムスター一覧は各カードで画像管理プレビューを選び、更新Actionを設定しない", async () => {
  const source = await readFile("src/components/hamster-list.tsx", "utf8");

  assert.match(source, /action=\{readOnly \? undefined : updateHamster\}/);
  assert.match(source, /staticImagePath=\{readOnly \? hamster\.staticImagePath : null\}/);
  assert.match(source, /mode=\{readOnly \? "preview" : "interactive"\}/);
  assert.match(source, /title="サンプル閲覧モードでは保存できません"/);
  assert.match(source, /type="button"\s+disabled\s+aria-disabled="true"/);
  assert.doesNotMatch(source, /readOnly \? updateHamster/);
});

test("デモ画面は操作不可の登録UIプレビュー、noindex、準備中表示を備える", async () => {
  const [
    layout,
    hamsters,
    records,
    cleaning,
    weights,
    unavailable,
    hamsterPreview,
    recordPreview,
    weightPreview
  ] = await Promise.all([
    readFile("src/app/demo/layout.tsx", "utf8"),
    readFile("src/app/demo/hamsters/page.tsx", "utf8"),
    readFile("src/app/demo/records/page.tsx", "utf8"),
    readFile("src/app/demo/cleaning/page.tsx", "utf8"),
    readFile("src/app/demo/weights/page.tsx", "utf8"),
    readFile("src/components/demo-unavailable.tsx", "utf8"),
    readFile("src/components/demo-hamster-create-preview.tsx", "utf8"),
    readFile("src/components/demo-record-create-forms-preview.tsx", "utf8"),
    readFile("src/components/demo-weight-create-preview.tsx", "utf8")
  ]);

  assert.match(layout, /index:\s*false/);
  assert.match(layout, /follow:\s*false/);
  assert.match(layout, /登録・編集・削除はできません/);
  assert.match(layout, /PUBLIC_DEMO_DIFFERENCE_NOTICE/);
  assert.match(layout, /import \{ Info, LogIn \} from "lucide-react"/);
  assert.match(layout, /デモ表示について：/);
  assert.match(layout, /\bbg-moss\b/);
  assert.match(layout, /\bborder-l-4\b/);
  assert.match(layout, /\bborder-moss\b/);
  assert.match(layout, /\bmax-w-3xl\b/);
  assert.match(layout, /<Info[^>]*aria-hidden/);
  assert.match(
    layout,
    /<p>\s*<span className="font-semibold text-slate-700">デモ表示について：<\/span>\s*\{PUBLIC_DEMO_DIFFERENCE_NOTICE\}\s*<\/p>/
  );
  assert.match(layout, /ログインして利用する/);
  assert.match(unavailable, /現在、サンプルデータを準備中です。/);

  for (const source of [hamsters, records, cleaning, weights]) {
    assert.doesNotMatch(source, /@\/app\/actions\//);
  }

  assert.match(hamsters, /DemoHamsterCreatePreview/);
  assert.match(records, /DemoRecordCreateFormsPreview/);
  assert.match(weights, /DemoWeightCreatePreview/);
  assert.doesNotMatch(records, /\bRecordCreateForms\b/);
  assert.doesNotMatch(cleaning, /saveCleaningMonth|type="submit"/);
  assert.doesNotMatch(weights, /createWeightRecord|CSVエクスポート|CSVインポート|type="submit"/);

  for (const source of [hamsterPreview, recordPreview, weightPreview]) {
    assert.doesNotMatch(source, /@\/app\/actions\//);
    assert.doesNotMatch(source, /\bcreateHamster\b|\bcreateHealthRecord\b|\bcreateMedicalRecord\b|\bcreateMemoryRecord\b|\bcreateWeightRecord\b/);
    assert.doesNotMatch(source, /<form\b|action=\{|onSubmit=|\bfetch\s*\(/);
    assert.doesNotMatch(source, /type="submit"/);
  }
});

function assertPreviewControlsAreDisabled(markup: string, tabsMayBeEnabled = false) {
  const controls = markup.match(/<(?:input|select|textarea|button)\b[^>]*>/g) ?? [];
  assert.ok(controls.length > 0);
  for (const control of controls) {
    if (tabsMayBeEnabled && (/role="tab"/.test(control) || /data-preview-toggle="true"/.test(control))) {
      continue;
    }
    assert.match(control, /\b(?:disabled|readonly)=""/i);
  }
}

test("ハムスター登録プレビューは通常画面と同じ主要項目を操作不可で表示する", () => {
  const markup = renderToStaticMarkup(<DemoHamsterCreatePreview today="2026-07-25" />);

  for (const label of ["新規登録", "名前", "誕生日", "お迎え日", "メモ", "プロフィール画像", "登録"]) {
    assert.match(markup, new RegExp(label));
  }
  assert.match(markup, /placeholder="例: もなか"/);
  assert.match(markup, /placeholder="性格、注意点など"/);
  assert.match(markup, /type="file"[^>]*disabled=""/);
  assert.doesNotMatch(markup, /<form\b|type="submit"/);
  assertPreviewControlsAreDisabled(markup);
});

test("記録登録プレビューは3種類のタブと全入力項目を表示し、タブ以外は操作不可にする", () => {
  assert.deepEqual(
    DEMO_RECORD_PREVIEW_TABS.map((tab) => tab.value),
    ["health", "medical", "memory"]
  );
  const markup = renderToStaticMarkup(<DemoRecordCreateFormsPreview today="2026-07-25" />);

  for (const label of [
    "体調を記録",
    "通院を記録",
    "思い出を追加",
    "記録日",
    "記録時刻",
    "総合状態",
    "食欲",
    "活動量",
    "便",
    "尿",
    "気になる症状",
    "通院日",
    "動物病院名",
    "通院理由・症状",
    "診断内容",
    "検査内容",
    "処置・治療内容",
    "処方薬",
    "投薬方法",
    "次回通院予定日",
    "タイトル",
    "内容",
    "タグ",
    "お気に入り",
    "画像",
    "体調記録を保存",
    "通院記録を保存",
    "思い出を保存"
  ]) {
    assert.match(markup, new RegExp(label));
  }
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 6);
  assert.match(markup, /type="file"[^>]*disabled=""/);
  assert.doesNotMatch(markup, /<form\b|type="submit"/);
  assertPreviewControlsAreDisabled(markup, true);
});

test("デモの思い出対象は通常版の要約付き選択UIを操作不可で使用する", () => {
  const demoHamsters = [
    { id: "h1", name: "きなこ", isActive: true },
    { id: "h2", name: "もなか", isActive: true },
    { id: "h3", name: "しらたま", isActive: false },
    { id: "h4", name: "こむぎ", isActive: true },
    { id: "h5", name: "あずき", isActive: true }
  ];
  const markup = renderToStaticMarkup(
    <DemoRecordCreateFormsPreview
      today="2026-07-25"
      hamsters={demoHamsters}
      selectedHamsterId="h1"
    />
  );

  assert.match(markup, /対象ハムスター（複数選択可）/);
  assert.match(markup, /きなこ[\s\S]*代表/);
  assert.match(markup, /1匹選択中/);
  assert.match(markup, /aria-expanded="false"[^>]*data-preview-toggle="true"/);
  assert.match(markup, /管理外/);
  assert.doesNotMatch(markup, /name="hamsterIds"/);
  assertPreviewControlsAreDisabled(markup, true);
});

test("体重登録プレビューは通常画面と同じカード配置・項目を操作不可で表示する", () => {
  const markup = renderToStaticMarkup(
    <DemoWeightCreatePreview today="2026-07-25" hamsterIsActive />
  );

  for (const label of ["体重登録", "日付", "体重(g)", "登録"]) {
    assert.match(markup, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  assert.match(markup, /value="2026-07-25"/);
  assert.match(markup, /placeholder="38.5"/);
  assert.doesNotMatch(markup, /<form\b|type="submit"/);
  assertPreviewControlsAreDisabled(markup);
});

test("通常画面の登録UIと更新Action接続は維持する", async () => {
  const [hamsters, recordsPage, recordForms, weights] = await Promise.all([
    readFile("src/app/(app)/hamsters/page.tsx", "utf8"),
    readFile("src/app/(app)/records/page.tsx", "utf8"),
    readFile("src/components/record-create-forms.tsx", "utf8"),
    readFile("src/app/(app)/weights/page.tsx", "utf8")
  ]);

  assert.match(hamsters, /import \{ createHamster \}/);
  assert.match(hamsters, /action=\{createHamster\}/);
  assert.match(recordsPage, /<RecordCreateForms/);
  assert.match(recordForms, /createHealthRecord/);
  assert.match(recordForms, /createMedicalRecord/);
  assert.match(recordForms, /createMemoryRecord/);
  assert.match(recordForms, /onSubmit=\{submitRecord/);
  assert.match(weights, /import \{ createWeightRecord \}/);
  assert.match(weights, /action=\{createWeightRecord\}/);
  assert.match(weights, /lg:grid-cols-\[minmax\(280px,360px\)_1fr\]/);
});

test("ログイン画面とデモ共通レイアウトは通常版との差異を共通の補足として表示する", async () => {
  const [login, demoLayout, notice, ...demoPages] = await Promise.all([
    readFile("src/app/(app)/login/page.tsx", "utf8"),
    readFile("src/app/demo/layout.tsx", "utf8"),
    readFile("src/lib/public-demo.ts", "utf8"),
    readFile("src/app/demo/page.tsx", "utf8"),
    readFile("src/app/demo/hamsters/page.tsx", "utf8"),
    readFile("src/app/demo/records/page.tsx", "utf8"),
    readFile("src/app/demo/cleaning/page.tsx", "utf8"),
    readFile("src/app/demo/weights/page.tsx", "utf8")
  ]);

  for (const source of [login, demoLayout]) {
    assert.match(source, /PUBLIC_DEMO_DIFFERENCE_NOTICE/);
  }
  for (const keyword of ["機能紹介用", "通常版", "画面構成", "表示内容", "操作UI", "異なる場合があります"]) {
    assert.match(notice, new RegExp(keyword));
  }
  assert.match(login, /href="\/demo"/);
  assert.match(login, /サンプルを見てみる/);
  assert.match(login, /架空のサンプルデータ/);
  assert.match(login, /登録・編集・削除はできません/);
  const noticeContainer = login.match(
    /<div className="([^"]*)">\s*<p>デモでは架空のサンプルデータを閲覧できます。登録・編集・削除はできません。<\/p>\s*<p>\{PUBLIC_DEMO_DIFFERENCE_NOTICE\}<\/p>/
  );
  assert.ok(noticeContainer);
  assert.match(noticeContainer[1], /\btext-left\b/);
  assert.doesNotMatch(noticeContainer[1], /\btext-center\b/);
  assert.match(noticeContainer[1], /\bmx-auto\b/);
  assert.match(noticeContainer[1], /\bmax-w-sm\b/);
  assert.match(noticeContainer[1], /\bpx-2\b/);
  assert.match(login, /action=\{signInWithGoogle\}/);
  assert.match(login, /name="callbackUrl" value=\{callbackUrl\}/);
  assert.match(login, /accountDeleted/);
  assert.match(login, /accountSuspended/);
  assert.match(demoLayout, /この画面のデータはサンプルです/);
  assert.match(demoLayout, /登録・編集・削除はできません/);
  assert.match(demoLayout, /ログインして利用する/);
  for (const page of demoPages) {
    assert.doesNotMatch(page, /PUBLIC_DEMO_DIFFERENCE_NOTICE|通常版とは一部の画面構成/);
  }
});

test("永続RootLayoutは経路に依存せず、通常画面とデモ画面を別Route Groupレイアウトで分離する", async () => {
  const [rootLayout, appLayout, demoLayout, appPage, demoPage] = await Promise.all([
    readFile("src/app/layout.tsx", "utf8"),
    readFile("src/app/(app)/layout.tsx", "utf8"),
    readFile("src/app/demo/layout.tsx", "utf8"),
    readFile("src/app/(app)/page.tsx", "utf8"),
    readFile("src/app/demo/page.tsx", "utf8")
  ]);

  assert.match(rootLayout, /<body>\{children\}<\/body>/);
  assert.doesNotMatch(rootLayout, /headers\(\)|auth\(\)|isPublicDemoPath|REQUEST_PATHNAME_HEADER/);
  assert.doesNotMatch(rootLayout, /<header|<main/);

  assert.match(appLayout, /const session = await auth\(\)/);
  assert.match(appLayout, /session\?\.user \? await getCurrentHouseholdSwitcherData\(\) : null/);
  assert.match(appLayout, /<header className="border-b border-slate-200 bg-paper">/);
  assert.match(appLayout, /<main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">/);
  assert.doesNotMatch(appLayout, /isPublicDemoPath|REQUEST_PATHNAME_HEADER/);

  assert.match(demoLayout, /<header className="border-b border-slate-200 bg-paper">/);
  assert.match(demoLayout, /<main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">/);
  assert.doesNotMatch(demoLayout, /auth\(\)|getCurrentHouseholdSwitcherData/);
  assert.match(appPage, /getDashboardData/);
  assert.match(demoPage, /getPublicDemoDashboardData/);
});

test("通常利用のHousehold選択と管理一覧はデモHouseholdを除外する", async () => {
  const [authContext, adminHouseholds] = await Promise.all([
    readFile("src/lib/auth-context.ts", "utf8"),
    readFile("src/lib/admin-households.ts", "utf8")
  ]);
  assert.match(authContext, /where:\s*\{\s*userId,\s*household:\s*\{\s*isDemo:\s*false/);
  assert.match(
    authContext,
    /where:\s*\{\s*userId:\s*context\.user\.id,\s*household:\s*\{\s*isDemo:\s*false/
  );
  assert.match(adminHouseholds, /reader\.count\(\{\s*where:\s*\{\s*isDemo:\s*false/);
  assert.match(adminHouseholds, /reader\.findMany\(\{\s*where:\s*\{\s*isDemo:\s*false/);
});
