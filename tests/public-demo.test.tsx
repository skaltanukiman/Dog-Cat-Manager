import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";

import { rebuildPublicDemoData } from "../prisma/seed-demo";
import { DEMO_NAV_ITEMS } from "../src/components/demo-nav";
import { HamsterThumbnail } from "../src/components/hamster-thumbnail";
import {
  isPublicDemoHousehold,
  isPublicDemoPath,
  PUBLIC_DEMO_HAMSTER_IDS,
  PUBLIC_DEMO_HOUSEHOLD_ID,
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
  const data = demos[0].data as {
    hamsters: { create: Array<{ id: string }> };
  };
  assert.deepEqual(
    data.hamsters.create.map((hamster) => hamster.id),
    Object.values(PUBLIC_DEMO_HAMSTER_IDS)
  );
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

test("デモ用プロフィール画像は公開静的パスを直接使用し、認証画像APIを呼ばない", () => {
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

test("デモ画面は更新UIを持たず、noindexと準備中表示を備える", async () => {
  const [layout, hamsters, records, cleaning, weights, unavailable] = await Promise.all([
    readFile("src/app/demo/layout.tsx", "utf8"),
    readFile("src/app/demo/hamsters/page.tsx", "utf8"),
    readFile("src/app/demo/records/page.tsx", "utf8"),
    readFile("src/app/demo/cleaning/page.tsx", "utf8"),
    readFile("src/app/demo/weights/page.tsx", "utf8"),
    readFile("src/components/demo-unavailable.tsx", "utf8")
  ]);

  assert.match(layout, /index:\s*false/);
  assert.match(layout, /follow:\s*false/);
  assert.match(layout, /登録・編集・削除はできません/);
  assert.match(layout, /ログインして利用する/);
  assert.match(unavailable, /現在、サンプルデータを準備中です。/);

  for (const source of [hamsters, records, cleaning, weights]) {
    assert.doesNotMatch(source, /@\/app\/actions\//);
  }
  assert.doesNotMatch(hamsters, /新規登録|type="submit"/);
  assert.doesNotMatch(records, /RecordCreateForms|deleteHamsterRecord|type="submit"/);
  assert.doesNotMatch(cleaning, /saveCleaningMonth|type="submit"/);
  assert.doesNotMatch(weights, /createWeightRecord|CSVエクスポート|CSVインポート|type="submit"/);
});

test("ログイン画面にデモ導線と読み取り専用説明を表示する", async () => {
  const source = await readFile("src/app/login/page.tsx", "utf8");
  assert.match(source, /href="\/demo"/);
  assert.match(source, /サンプルを見てみる/);
  assert.match(source, /登録・編集・削除はできません/);
  assert.match(source, /accountDeleted/);
  assert.match(source, /accountSuspended/);
});

test("RootLayoutはデモ経路で認証・選択中Householdの取得を行わない", async () => {
  const source = await readFile("src/app/layout.tsx", "utf8");
  assert.match(source, /const session = isDemoRequest \? null : await auth\(\)/);
  assert.match(source, /session\?\.user \? await getCurrentHouseholdSwitcherData\(\) : null/);
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
