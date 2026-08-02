import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { careNotificationSettingsFormSchema, careNotificationSettingsEqual, parseCareNotificationSettingsForm } from "../src/lib/care-notification-settings";
import {
  buildCareNotificationBody,
  dueCareKinds,
  dueNotificationMinutes,
  formatMinutesAsTime,
  getJstMinuteOfDay,
  isWithinNotificationWindow,
  MAX_NOTIFY_BEFORE_MINUTES,
  normalizeCareNotificationSettings,
  notificationTargetDate,
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_LATE_WINDOW_MINUTES,
  parseTimeInputToMinutes
} from "../src/lib/care-notifications";
import { pushSubscriptionSchema } from "../src/lib/web-push";

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

type ServiceWorkerTestEvent = {
  data?: { json(): unknown };
  notification?: { close(): void };
  waitUntil(promise: Promise<unknown>): void;
};
type ServiceWorkerTestListener = (event: ServiceWorkerTestEvent) => void;

async function showPushNotification(payload: unknown) {
  const source = readSource("public/sw.js");
  const listeners = new Map<string, ServiceWorkerTestListener>();
  const shown: unknown[][] = [];
  const self = {
    addEventListener: (type: string, listener: ServiceWorkerTestListener) => listeners.set(type, listener),
    registration: { showNotification: async (...args: unknown[]) => shown.push(args) },
    clients: {},
    location: { origin: "https://app.example" }
  };
  vm.runInNewContext(source, { self, URL });
  let pending: Promise<unknown> = Promise.resolve();
  listeners.get("push")?.({
    data: { json: () => payload },
    waitUntil: (promise: Promise<unknown>) => { pending = promise; }
  });
  await pending;
  assert.equal(shown.length, 1);
  return shown[0] as [string, { body: string }];
}

const validForm = {
  feedingNotificationEnabled: true,
  feedingDeadline: "22:00",
  feedingNotifyBeforeMinutes: 30,
  waterNotificationEnabled: true,
  waterDeadline: "21:00",
  waterNotifyBeforeMinutes: 30,
  careNotificationCompactBody: true
};

test("通知設定の初期値は既存ユーザーへ送信しないOFFで安全な分数値を使う", () => {
  assert.deepEqual(normalizeCareNotificationSettings(null), {
    feedingNotificationEnabled: false,
    feedingDeadlineMinutes: 1320,
    feedingNotifyBeforeMinutes: 30,
    waterNotificationEnabled: false,
    waterDeadlineMinutes: 1260,
    waterNotifyBeforeMinutes: 30,
    careNotificationCompactBody: false
  });
  assert.equal(formatMinutesAsTime(1320), "22:00");
  assert.equal(parseTimeInputToMinutes("21:00"), 1260);
});

test("通知設定はON/OFF、時刻、事前通知時間の正常値を受け付ける", () => {
  assert.equal(careNotificationSettingsFormSchema.safeParse(validForm).success, true);
  assert.deepEqual(parseCareNotificationSettingsForm(validForm), {
    feedingNotificationEnabled: true,
    feedingDeadlineMinutes: 1320,
    feedingNotifyBeforeMinutes: 30,
    waterNotificationEnabled: true,
    waterDeadlineMinutes: 1260,
    waterNotifyBeforeMinutes: 30,
    careNotificationCompactBody: true
  });
});

test("通知設定は不正時刻、負数、過大値、当日0時より前になる指定を拒否する", () => {
  assert.equal(careNotificationSettingsFormSchema.safeParse({ ...validForm, feedingDeadline: "24:00" }).success, false);
  assert.equal(careNotificationSettingsFormSchema.safeParse({ ...validForm, feedingNotifyBeforeMinutes: -1 }).success, false);
  assert.equal(careNotificationSettingsFormSchema.safeParse({ ...validForm, feedingNotifyBeforeMinutes: MAX_NOTIFY_BEFORE_MINUTES + 1 }).success, false);
  assert.equal(careNotificationSettingsFormSchema.safeParse({ ...validForm, feedingDeadline: "00:15", feedingNotifyBeforeMinutes: 30 }).success, false);
});

test("通知設定の同値比較で設定変更なしを判定できる", () => {
  const settings = parseCareNotificationSettingsForm(validForm);
  assert.ok(settings);
  assert.equal(careNotificationSettingsEqual(settings, { ...settings }), true);
  assert.equal(careNotificationSettingsEqual(settings, { ...settings, waterNotificationEnabled: false }), false);
  assert.equal(careNotificationSettingsEqual(settings, { ...settings, careNotificationCompactBody: false }), false);
});

test("JSTの日付境界をサーバーOSのタイムゾーンに依存せず分へ変換する", () => {
  assert.equal(getJstMinuteOfDay(new Date("2026-07-31T14:59:00.000Z")), 23 * 60 + 59);
  assert.equal(getJstMinuteOfDay(new Date("2026-07-31T15:00:00.000Z")), 0);
  assert.equal(getJstMinuteOfDay(new Date("2026-07-31T15:30:00.000Z")), 30);
});

test("通知対象日は0時設定で従来どおり、8時設定では7:59と8:00で切り替わる", () => {
  const beforeEight = new Date("2026-08-01T22:59:59.999Z");
  const atEight = new Date("2026-08-01T23:00:00.000Z");

  assert.equal(notificationTargetDate(beforeEight, 0).toISOString(), "2026-08-02T00:00:00.000Z");
  assert.equal(notificationTargetDate(beforeEight, 480).toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(notificationTargetDate(atEight, 480).toISOString(), "2026-08-02T00:00:00.000Z");
});

test("同じ現在時刻でもHouseholdごとの切り替え時刻から異なる通知対象日を算出できる", () => {
  const now = new Date("2026-08-01T22:59:59.999Z");
  const householdDates = [0, 480].map((minutes) => notificationTargetDate(now, minutes).toISOString());
  assert.deepEqual(householdDates, ["2026-08-02T00:00:00.000Z", "2026-08-01T00:00:00.000Z"]);
});

test("予定時刻の直前は対象外、同時刻とcron遅延は対象、許容範囲超過は対象外", () => {
  assert.equal(isWithinNotificationWindow(1289, 1290), false);
  assert.equal(isWithinNotificationWindow(1290, 1290), true);
  assert.equal(isWithinNotificationWindow(1297, 1290), true);
  assert.equal(isWithinNotificationWindow(1290 + NOTIFICATION_LATE_WINDOW_MINUTES, 1290), true);
  assert.equal(isWithinNotificationWindow(1290 + NOTIFICATION_LATE_WINDOW_MINUTES + 1, 1290), false);
});

test("食事と水替えが同じ予定時刻なら1つの配信候補へまとめる", () => {
  const setting = normalizeCareNotificationSettings({
    feedingNotificationEnabled: true,
    feedingDeadlineMinutes: 1320,
    feedingNotifyBeforeMinutes: 30,
    waterNotificationEnabled: true,
    waterDeadlineMinutes: 1320,
    waterNotifyBeforeMinutes: 30
  });
  assert.deepEqual(dueNotificationMinutes(setting, new Date("2026-07-31T12:30:00.000Z")), [1290]);
  assert.deepEqual(dueCareKinds(setting, 1290), ["feeding", "water"]);
});

test("簡略通知本文は対象項目だけを食事、水替えの順で全角縦線区切りにする", () => {
  assert.equal(buildCareNotificationBody(["A"], [], true), "【食事】未実施");
  assert.equal(buildCareNotificationBody([], ["B"], true), "【水替え】未実施");
  assert.equal(
    buildCareNotificationBody(["A"], ["B"], true),
    "【食事】未実施｜【水替え】未実施"
  );
  assert.doesNotMatch(buildCareNotificationBody(["きなこ"], ["シロ"], true), /きなこ|シロ/);
});

test("通常通知本文は簡略表示と同じ項目構造で対象名を読点区切りにする", () => {
  assert.equal(buildCareNotificationBody(["A"], []), "【食事】未実施：A");
  assert.equal(buildCareNotificationBody([], ["B"]), "【水替え】未実施：B");
  assert.equal(
    buildCareNotificationBody(["A", "C"], ["B"]),
    "【食事】未実施：A、C｜【水替え】未実施：B"
  );
});

test("通常通知本文は名前を安全化し、多い場合はほかN匹で省略して最大長を守る", () => {
  const longNames = ["A", "B", "C", "D", "E"].map((value) => value.repeat(30));
  const body = buildCareNotificationBody(longNames, ["きなこ\u0000\t\n"]);

  assert.match(body, /^【食事】未実施：A{30}、B{30}、ほか3匹｜/);
  assert.match(body, /【水替え】未実施：きなこ/);
  assert.ok(Array.from(body).length <= NOTIFICATION_BODY_MAX_LENGTH);
  assert.doesNotMatch(body, /[\r\n]/);
  assert.doesNotMatch(body, /[\u0000-\u0009\u000b-\u001f\u007f]/);
});

test("通知本文は対象なしのフォールバックとコードポイント単位の末尾省略を維持する", () => {
  const source = readSource("src/lib/care-notifications.ts");
  const longNames = Array.from({ length: 40 }, (_, index) => `とても長いハムスター名${index + 1}`);
  const body = buildCareNotificationBody(longNames, longNames);

  assert.equal(buildCareNotificationBody([], []), "お世話の状況をアプリで確認してください。");
  assert.ok(Array.from(body).length <= NOTIFICATION_BODY_MAX_LENGTH);
  assert.match(
    source,
    /Array\.from\(body\)[\s\S]*?characters\.slice\(0, NOTIFICATION_BODY_MAX_LENGTH - 1\)[\s\S]*?…/
  );
});

test("PushSubscription入力はHTTPS endpointと鍵の形式・サイズを検証する", () => {
  const valid = {
    endpoint: "https://push.example/subscription/1",
    expirationTime: null,
    keys: { p256dh: "A".repeat(32), auth: "B".repeat(16) }
  };
  assert.equal(pushSubscriptionSchema.safeParse(valid).success, true);
  assert.equal(pushSubscriptionSchema.safeParse({ ...valid, endpoint: "http://push.example/1" }).success, false);
  assert.equal(pushSubscriptionSchema.safeParse({ ...valid, keys: { ...valid.keys, auth: "secret with spaces" } }).success, false);
});

test("設定ActionはセッションUserと現在Householdを使いVIEWERを共通更新ガードで拒否しない", () => {
  const source = readSource("src/app/actions/care-notifications.ts");
  assert.match(source, /getRequiredHouseholdContext\(\)/);
  assert.doesNotMatch(source, /getRequiredHouseholdMutationContext/);
  assert.match(source, /householdMember\.findUnique/);
  assert.match(source, /userId: context\.user\.id/);
  assert.match(source, /householdId: context\.household\.id/);
  assert.match(source, /createSettingsSaveState\(previousState, "unchanged"/);
  assert.doesNotMatch(source, /redirect\("\/settings\?status=/);
});

test("購読APIは認証・同一origin・サイズを検証し、User IDを本文から受け取らない", () => {
  const route = readSource("src/app/api/push/subscriptions/route.ts");
  const statusRoute = readSource("src/app/api/push/subscriptions/status/route.ts");
  for (const source of [route, statusRoute]) {
    assert.match(source, /getActivePushRouteUserId/);
    assert.match(source, /isSameOriginMutationRequest/);
    assert.match(source, /requestBodyIsWithinLimit/);
    assert.doesNotMatch(source, /body\.userId|data\.userId/);
  }
  assert.match(route, /deleteMany\([\s\S]*?where: \{ userId, endpoint:/);
});

test("同じendpointの再登録は本人だけ更新し、他User所有なら移し替えない", () => {
  const source = readSource("src/lib/push-subscriptions.ts");
  assert.match(source, /existing\.userId !== userId/);
  assert.match(source, /ownedByAnotherUser/);
  assert.match(source, /where: \{ id: existing\.id, userId \}/);
  assert.match(source, /isPrismaUniqueConstraintError/);
});

test("配信は管理中のHousehold全個体を対象にし、ダッシュボード選択を参照しない", () => {
  const source = readSource("src/lib/care-notification-dispatch.ts");
  assert.match(source, /where: \{ householdId: dispatch\.householdId, isActive: true \}/);
  assert.match(source, /feedingRecords:[\s\S]*?recordDate: dispatch\.targetDate/);
  assert.match(source, /waterReplacementRecords:[\s\S]*?recordDate: dispatch\.targetDate/);
  assert.doesNotMatch(source, /dashboardHamster|dashboardEntries/);
});

test("送信直前に所属・設定・当日記録を再確認し、完了種別だけを除外する", () => {
  const source = readSource("src/lib/care-notification-dispatch.ts");
  const membershipIndex = source.indexOf("prisma.householdMember.findUnique");
  const hamsterIndex = source.indexOf("prisma.hamster.findMany");
  const sendIndex = source.indexOf("await sendCareWebPush");
  assert.ok(membershipIndex >= 0 && hamsterIndex > membershipIndex && sendIndex > hamsterIndex);
  assert.match(source, /feedingRecords\.length === 0/);
  assert.match(source, /waterReplacementRecords\.length === 0/);
  assert.match(source, /feedingNames\.length === 0 && waterNames\.length === 0/);
  assert.match(source, /household: \{ select: \{ isDemo: true, careDayStartMinutes: true \} \}/);
  assert.match(source, /rawSetting\.user\?\.accessStatus !== "ACTIVE"/);
  assert.match(source, /latestTargetDate = notificationTargetDate\([\s\S]*rawSetting\.household\.careDayStartMinutes/);
  assert.match(source, /toDateInputValue\(dispatch\.targetDate\) !== toDateInputValue\(latestTargetDate\)/);
});

test("新規予約、期限切れ、再試行は全世帯共通targetDateを使わずHouseholdごとに検証する", () => {
  const source = readSource("src/lib/care-notification-dispatch.ts");

  assert.doesNotMatch(source, /const targetDate = notificationTargetDate\(now\);/);
  assert.match(source, /pendingDispatches = await prisma\.careNotificationDispatch\.findMany/);
  assert.match(source, /pending\.household\.careDayStartMinutes/);
  assert.match(source, /rawSetting\.household\.careDayStartMinutes/);
  assert.match(source, /retryCandidates = pendingDispatches\.filter/);
  assert.match(source, /candidate\.household\.careDayStartMinutes/);
  assert.doesNotMatch(
    source,
    /careNotificationDispatch\.updateMany\(\{[\s\S]*targetDate: \{ lt: targetDate \}/
  );
});

test("重複予約はDB一意制約、短いリース、条件付き更新で競合を抑える", () => {
  const schema = readSource("prisma/schema.prisma");
  const migration = readSource("prisma/migrations/20260731120000_add_care_push_notifications/migration.sql");
  const source = readSource("src/lib/care-notification-dispatch.ts");
  assert.match(schema, /@@unique\(\[userId, householdId, targetDate, scheduledMinute\]\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "care_notification_dispatches_user_id_household_id_target_date_scheduled_minute_key"/);
  assert.match(source, /careNotificationDispatch\.createMany\([\s\S]*?skipDuplicates: true/);
  assert.match(source, /if \(created\.count !== 1\) return null/);
  assert.match(source, /findFirst\([\s\S]*?claimToken[\s\S]*?status: "CLAIMED"/);
  assert.doesNotMatch(source, /careNotificationDispatch\.create\(/);
  assert.match(source, /claimToken/);
  assert.match(source, /leaseExpiresAt/);
  assert.match(source, /updateMany\([\s\S]*?status: "CLAIMED"/);
});

test("外部送信中はtransactionを保持せず、一時失敗・無効購読・端末分離を扱う", () => {
  const source = readSource("src/lib/care-notification-dispatch.ts");
  const sendBlock = source.slice(source.indexOf("for (const subscription"), source.indexOf("if (successCount > 0)"));
  assert.doesNotMatch(sendBlock, /\$transaction/);
  assert.match(sendBlock, /isInvalidPushSubscriptionError/);
  assert.match(sendBlock, /webPushSubscription\.deleteMany/);
  assert.match(source, /status: "RETRYABLE"/);
  assert.match(source, /attemptCount: \{ lt: NOTIFICATION_MAX_ATTEMPTS \}/);
  assert.match(source, /if \(successCount > 0\)/);
});

test("User・Household削除は購読・配信履歴をCascadeし、通知は既存設定で初期OFF", () => {
  const schema = readSource("prisma/schema.prisma");
  const migration = readSource("prisma/migrations/20260731120000_add_care_push_notifications/migration.sql");
  const compactMigration = readSource("prisma/migrations/20260801120000_add_compact_care_notification_body/migration.sql");
  assert.match(schema, /model WebPushSubscription[\s\S]*?onDelete: Cascade/);
  assert.match(schema, /model CareNotificationDispatch[\s\S]*?user[\s\S]*?onDelete: Cascade[\s\S]*?household[\s\S]*?onDelete: Cascade/);
  assert.match(migration, /feedingNotificationEnabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /waterNotificationEnabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(schema, /careNotificationCompactBody\s+Boolean\s+@default\(false\)/);
  assert.match(compactMigration, /careNotificationCompactBody" BOOLEAN NOT NULL DEFAULT false/);
});

test("Service Workerはpush payloadを表示し、不正値を安全な文言へフォールバックする", async () => {
  const source = readSource("public/sw.js");
  const listeners = new Map<string, ServiceWorkerTestListener>();
  const shown: unknown[][] = [];
  const self = {
    addEventListener: (type: string, listener: ServiceWorkerTestListener) => listeners.set(type, listener),
    registration: { showNotification: async (...args: unknown[]) => shown.push(args) },
    clients: {},
    location: { origin: "https://app.example" }
  };
  vm.runInNewContext(source, { self, URL });
  let pending: Promise<unknown> = Promise.resolve();
  listeners.get("push")?.({
    data: { json: () => { throw new Error("bad payload"); } },
    waitUntil: (promise: Promise<unknown>) => { pending = promise; }
  });
  await pending;
  assert.equal(shown.length, 1);
  assert.equal(shown[0][0], "ハムスターのお世話を確認してください");
  assert.equal((shown[0][1] as { body: string }).body, "お世話の状況をアプリで確認してください。");
});

test("Service Workerは本文のLFを維持し、CRLFとCRをLFへ統一する", async () => {
  const [, lfOptions] = await showPushNotification({
    title: "通知",
    body: "【食事】未実施\n【水替え】未実施"
  });
  const [, crOptions] = await showPushNotification({
    title: "通知",
    body: "【食事】未実施\r\n【水替え】未実施\r確認"
  });

  assert.equal(lfOptions.body, "【食事】未実施\n【水替え】未実施");
  assert.equal(crOptions.body, "【食事】未実施\n【水替え】未実施\n確認");
});

test("Service Workerは過剰な改行とLF以外の制御文字を除去する", async () => {
  const [, options] = await showPushNotification({
    title: "通知",
    body: "\u0000\t【食事】未実施\n \n\n\u000b【水替え】未実施\u000c\u007f"
  });

  assert.equal(options.body, "【食事】未実施\n【水替え】未実施");
  assert.doesNotMatch(options.body, /[\u0000-\u0009\u000b-\u001f\u007f]/);
});

test("Service Workerはサロゲートペアを壊さず本文最大文字数を適用する", async () => {
  const [, options] = await showPushNotification({ title: "通知", body: "🐹".repeat(205) });

  assert.equal(Array.from(options.body).length, 200);
  assert.equal(options.body, "🐹".repeat(200));
});

test("notificationclickは既存ウィンドウをダッシュボードへ移動してfocusする", async () => {
  const source = readSource("public/sw.js");
  const listeners = new Map<string, ServiceWorkerTestListener>();
  let navigated = "";
  let focused = false;
  let opened = false;
  let message: unknown;
  const client = {
    url: "https://app.example/settings",
    postMessage: (value: unknown) => { message = value; },
    navigate: async (url: string) => { navigated = url; return client; },
    focus: async () => { focused = true; return client; }
  };
  const self = {
    addEventListener: (type: string, listener: ServiceWorkerTestListener) => listeners.set(type, listener),
    registration: {},
    clients: {
      matchAll: async () => [client],
      openWindow: async () => { opened = true; }
    },
    location: { origin: "https://app.example" }
  };
  vm.runInNewContext(source, { self, URL });
  let pending: Promise<unknown> = Promise.resolve();
  listeners.get("notificationclick")?.({
    notification: { close() {} },
    waitUntil: (promise: Promise<unknown>) => { pending = promise; }
  });
  await pending;
  assert.equal(navigated, "https://app.example/");
  assert.equal(JSON.stringify(message), JSON.stringify({ type: "HAMSTER_CARE_NOTIFICATION_CLICK", url: "/" }));
  assert.equal(focused, true);
  assert.equal(opened, false);
});

test("notificationclickはnavigate失敗時もページ側フォールバックへ通知してfocusする", async () => {
  const source = readSource("public/sw.js");
  const listeners = new Map<string, ServiceWorkerTestListener>();
  let focused = false;
  let message: unknown;
  const client = {
    url: "https://app.example/settings",
    postMessage: (value: unknown) => { message = value; },
    navigate: async () => { throw new Error("navigation failed"); },
    focus: async () => { focused = true; return client; }
  };
  const self = {
    addEventListener: (type: string, listener: ServiceWorkerTestListener) => listeners.set(type, listener),
    registration: {},
    clients: { matchAll: async () => [client], openWindow: async () => undefined },
    location: { origin: "https://app.example" }
  };
  vm.runInNewContext(source, { self, URL });
  let pending: Promise<unknown> = Promise.resolve();
  listeners.get("notificationclick")?.({
    notification: { close() {} },
    waitUntil: (promise: Promise<unknown>) => { pending = promise; }
  });
  await pending;
  assert.equal(JSON.stringify(message), JSON.stringify({ type: "HAMSTER_CARE_NOTIFICATION_CLICK", url: "/" }));
  assert.equal(focused, true);
});

test("notificationclickは既存ウィンドウがなければダッシュボードを開く", async () => {
  const source = readSource("public/sw.js");
  const listeners = new Map<string, ServiceWorkerTestListener>();
  let opened = "";
  const self = {
    addEventListener: (type: string, listener: ServiceWorkerTestListener) => listeners.set(type, listener),
    registration: {},
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened = url; } },
    location: { origin: "https://app.example" }
  };
  vm.runInNewContext(source, { self, URL });
  let pending: Promise<unknown> = Promise.resolve();
  listeners.get("notificationclick")?.({
    notification: { close() {} },
    waitUntil: (promise: Promise<unknown>) => { pending = promise; }
  });
  await pending;
  assert.equal(opened, "/");
});

test("Service Workerだけを公開し購読APIは認証対象のままにする", () => {
  const proxy = readSource("src/proxy.ts");
  assert.match(proxy, /"\/sw\.js"/);
  assert.doesNotMatch(proxy, /PUBLIC_(?:PATHS|PREFIXES)[\s\S]*?\/api\/push/);
  assert.match(readSource("src/components/service-worker-registration.tsx"), /register\("\/sw\.js", \{ scope: "\/" \}\)/);
  assert.match(readSource("src/components/service-worker-registration.tsx"), /addEventListener\("message", handleServiceWorkerMessage\)/);
  assert.match(readSource("src/components/service-worker-registration.tsx"), /message\.url !== "\/"/);
  assert.doesNotMatch(readSource("public/sw.js"), /addEventListener\("fetch"/);
});

test("設定UIは非対応・未選択・拒否・未登録・有効・解除・エラー状態を案内する", () => {
  const source = readSource("src/components/notification-settings-form.tsx");
  for (const state of ["unsupported", "unselected", "denied", "permittedUnsubscribed", "browserOnly", "enabled", "released", "error"]) {
    assert.match(source, new RegExp(`${state}:`));
  }
  assert.match(source, /Notification\.requestPermission\(\)/);
  assert.match(source, /この端末で通知を有効にする/);
  assert.match(source, /この端末の通知を解除する/);
  assert.match(source, /iPhone・iPadでは、Safariでこのアプリをホーム画面に追加し、ホーム画面から開いて「この端末で通知を有効にする」を押してください。/);
  assert.doesNotMatch(source, /ホーム画面へ追加したPWA/);
  assert.match(source, /name="careNotificationCompactBody"/);
  assert.match(source, /通知内容を簡略表示する/);
  assert.match(source, /ハムスター名を表示せず/);
  assert.match(source, /簡略表示例：/);
  assert.match(source, /【食事】未実施/);
  assert.match(source, /【水替え】未実施/);
  assert.match(source, /簡略表示例：[\s\S]*?className="mt-1 block break-words"[\s\S]*?【食事】未実施｜【水替え】未実施/);
  assert.match(source, /useState\(settings\.careNotificationCompactBody\)/);
  assert.match(source, /checked=\{compactBodyEnabled\}/);
  assert.match(source, /setCompactBodyEnabled\(event\.currentTarget\.checked\)/);
  assert.match(source, /compactBodyEnabled \? "オン" : "オフ"/);
  assert.match(source, /htmlFor="care-notification-compact-body"[\s\S]*?min-h-11/);
  assert.match(source, /id="care-notification-compact-body"[\s\S]*?aria-labelledby="care-notification-compact-label"/);
  assert.match(source, /bg-slate-400[\s\S]*?duration-200[\s\S]*?peer-checked:border-moss[\s\S]*?peer-checked:bg-moss/);
  assert.match(source, /transition-transform duration-200[\s\S]*?peer-checked:translate-x-5/);
  assert.match(source, /id="care-notification-compact-state"[\s\S]*?aria-hidden="true"/);
  assert.match(source, /id="care-notification-compact-state"[\s\S]*?whitespace-nowrap/);
  assert.doesNotMatch(source, /cursor-pointer items-center justify-between/);
  const compactControlStart = source.indexOf('htmlFor="care-notification-compact-body"');
  const compactControlOpeningEnd = source.indexOf(">", compactControlStart);
  const compactControlEnd = source.indexOf("</label>", compactControlStart);
  const compactStateStart = source.indexOf('id="care-notification-compact-state"');
  const compactStateEnd = source.indexOf("</span>", compactStateStart);
  const compactHelpStart = source.indexOf('id="care-notification-compact-help"');
  assert.ok(compactControlStart >= 0 && compactControlEnd > compactControlStart);
  assert.doesNotMatch(
    source.slice(compactControlStart, compactControlOpeningEnd),
    /rounded-md|border-slate-200|bg-slate-50|px-3/
  );
  assert.doesNotMatch(source.slice(compactStateStart, compactStateEnd), /aria-live/);
  assert.ok(compactHelpStart > compactControlEnd);
  assert.doesNotMatch(source.slice(compactControlStart, compactControlEnd), /ハムスター名を表示せず/);
});

test("CLI・Docker・環境変数・READMEに運用経路が揃う", () => {
  const packageJson = readSource("package.json");
  const dockerfile = readSource("Dockerfile");
  const readme = readSource("README.md");
  assert.match(packageJson, /"notifications:dispatch": "tsx scripts\/dispatch-care-notifications\.ts"/);
  assert.match(dockerfile, /\/app\/scripts \.\/scripts/);
  assert.match(dockerfile, /\/app\/src\/lib \.\/src\/lib/);
  assert.match(readSource(".env.example"), /WEB_PUSH_VAPID_PRIVATE_KEY=/);
  assert.match(readme, /web-push generate-vapid-keys/);
  assert.match(readme, /\* \* \* \* \* cd \/path\/to\/Hamster-Manager-Browser/);
  assert.match(readme, /HTTPS/);
  assert.match(readme, /404\/410/);
});

test("ログやUIへ購読秘密情報を渡さない", () => {
  const dispatch = readSource("src/lib/care-notification-dispatch.ts");
  const route = readSource("src/app/api/push/subscriptions/route.ts");
  const ui = readSource("src/components/notification-settings-form.tsx");
  assert.doesNotMatch(dispatch, /writeServerLog\([\s\S]*?(?:endpoint|p256dh|auth)/);
  assert.doesNotMatch(route, /context:\s*\{[^}]*endpoint/);
  assert.doesNotMatch(ui, /subscription\.endpoint\}|keys\.p256dh|keys\.auth/);
});
