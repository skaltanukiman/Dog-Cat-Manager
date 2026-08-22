import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  buildPetCareNotificationBody,
  careDayOffset,
  evaluateRuleCompletions,
  isCompletingPetCareRecord,
  isNotificationKindAllowed,
  isNotificationScheduleWithinCareDay,
  notificationScheduledDateTime,
  NOTIFICATION_BODY_MAX_LENGTH,
  PET_NOTIFICATION_RULE_MAX_COUNT
} from "../src/lib/pet-notifications";
import { validatePetNotificationRuleSet, type PetNotificationRuleInput } from "../src/lib/pet-notification-settings";
import { parseJstDateTimeLocal } from "../src/lib/pet-care";
import { isSameOriginMutationRequest, pushSubscriptionSchema, readJsonRequestWithinLimit, requestBodyIsWithinLimit } from "../src/lib/web-push";

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const baseRule: PetNotificationRuleInput = {
  kind: "FEEDING",
  label: "朝ごはん",
  deadlineMinutes: 7 * 60 + 30,
  notifyBeforeMinutes: 30,
  enabled: true
};

test("DOGとCATはspecies固有のお世話通知だけを許可する", () => {
  assert.equal(isNotificationKindAllowed("DOG", "FEEDING"), true);
  assert.equal(isNotificationKindAllowed("DOG", "WATER"), true);
  assert.equal(isNotificationKindAllowed("DOG", "WALK"), true);
  assert.equal(isNotificationKindAllowed("DOG", "LITTER_CLEANING"), false);
  assert.equal(isNotificationKindAllowed("CAT", "FEEDING"), true);
  assert.equal(isNotificationKindAllowed("CAT", "WATER"), true);
  assert.equal(isNotificationKindAllowed("CAT", "LITTER_CLEANING"), true);
  assert.equal(isNotificationKindAllowed("CAT", "WALK"), false);
});

test("Server validationはspecies不一致・上限・不正予定時刻・重複期限を拒否する", () => {
  assert.equal(validatePetNotificationRuleSet("DOG", 0, [baseRule]), null);
  assert.equal(validatePetNotificationRuleSet("CAT", 0, [{ ...baseRule, kind: "WALK" }]), "speciesMismatch");
  assert.equal(
    validatePetNotificationRuleSet("DOG", 0, Array.from({ length: PET_NOTIFICATION_RULE_MAX_COUNT + 1 }, (_, index) => ({ ...baseRule, deadlineMinutes: index }))),
    "tooMany"
  );
  assert.equal(validatePetNotificationRuleSet("DOG", 480, [{ ...baseRule, deadlineMinutes: 495, notifyBeforeMinutes: 30 }]), "invalidSchedule");
  assert.equal(validatePetNotificationRuleSet("DOG", 0, [baseRule, { ...baseRule, label: "別名" }]), "duplicate");
});

test("0時開始では朝食記録が夜食まで完了扱いにならない", () => {
  const result = evaluateRuleCompletions(
    [
      { id: "morning", deadlineMinutes: 7 * 60 + 30 },
      { id: "evening", deadlineMinutes: 19 * 60 + 30 }
    ],
    [parseJstDateTimeLocal("2026-08-22T07:00")],
    "2026-08-22",
    0
  );
  assert.equal(result.get("morning"), true);
  assert.equal(result.get("evening"), false);
});

test("2件目の対象時間帯にある食事記録は夜食だけを完了にする", () => {
  const result = evaluateRuleCompletions(
    [
      { id: "morning", deadlineMinutes: 7 * 60 + 30 },
      { id: "evening", deadlineMinutes: 19 * 60 + 30 }
    ],
    [parseJstDateTimeLocal("2026-08-22T19:00")],
    "2026-08-22",
    0
  );
  assert.equal(result.get("morning"), false);
  assert.equal(result.get("evening"), true);
});

test("前ルール期限と同時刻の記録を次ルールへ二重消費しない", () => {
  const result = evaluateRuleCompletions(
    [{ id: "first", deadlineMinutes: 600 }, { id: "second", deadlineMinutes: 720 }],
    [parseJstDateTimeLocal("2026-08-22T10:00")],
    "2026-08-22",
    0
  );
  assert.equal(result.get("first"), true);
  assert.equal(result.get("second"), false);
});

test("8時開始では09:00、19:00、翌00:15の順で時間帯を評価する", () => {
  assert.deepEqual([540, 1140, 15].map((minute) => careDayOffset(minute, 480)), [60, 660, 975]);
  const result = evaluateRuleCompletions(
    [{ id: "night", deadlineMinutes: 15 }, { id: "evening", deadlineMinutes: 1140 }, { id: "morning", deadlineMinutes: 540 }],
    [parseJstDateTimeLocal("2026-08-22T08:30"), parseJstDateTimeLocal("2026-08-23T00:00")],
    "2026-08-22",
    480
  );
  assert.equal(result.get("morning"), true);
  assert.equal(result.get("evening"), false);
  assert.equal(result.get("night"), true);
});

test("8時開始・翌00:15期限・30分前は前日23:45の実日時になる", () => {
  assert.equal(
    notificationScheduledDateTime("2026-08-22", 480, 15, 30).toISOString(),
    "2026-08-22T14:45:00.000Z"
  );
  assert.equal(isNotificationScheduleWithinCareDay(480, 15, 30), true);
  assert.equal(isNotificationScheduleWithinCareDay(0, 15, 30), false);
});

test("Waterは交換・補充、LitterはCLEANEDだけを完了として扱う", () => {
  assert.equal(isCompletingPetCareRecord("WATER", "REPLACED"), true);
  assert.equal(isCompletingPetCareRecord("WATER", "REFILLED"), true);
  assert.equal(isCompletingPetCareRecord("LITTER_CLEANING", "CLEANED"), true);
  assert.equal(isCompletingPetCareRecord("LITTER_CLEANING", "URINATION"), false);
  assert.equal(isCompletingPetCareRecord("LITTER_CLEANING", "DEFECATION"), false);
  assert.equal(isCompletingPetCareRecord("LITTER_CLEANING", "BOTH"), false);
});

test("通常本文と簡略本文は安全な長さと制御文字除去を維持する", () => {
  assert.equal(buildPetCareNotificationBody([{ petName: "ソラ", label: "朝ごはん" }]), "ソラ：朝ごはんが未実施です");
  assert.equal(buildPetCareNotificationBody([{ petName: "ソラ", label: "朝ごはん" }, { petName: "ミケ", label: "トイレ清掃" }], true), "未実施のお世話があります（2件）");
  const body = buildPetCareNotificationBody(Array.from({ length: 30 }, () => ({ petName: "ソラ\u0000\n", label: "長い通知名".repeat(20) })));
  assert.ok(Array.from(body).length <= NOTIFICATION_BODY_MAX_LENGTH);
  assert.doesNotMatch(body, /[\u0000-\u0009\u000b-\u001f\u007f]/);
});

test("Push subscriptionとmutation requestはHTTPS・同一origin・本文上限を検証する", async () => {
  const valid = { endpoint: "https://push.example/subscription/1", expirationTime: null, keys: { p256dh: "A".repeat(32), auth: "B".repeat(16) } };
  assert.equal(pushSubscriptionSchema.safeParse(valid).success, true);
  assert.equal(pushSubscriptionSchema.safeParse({ ...valid, endpoint: "http://push.example/1" }).success, false);
  assert.equal(isSameOriginMutationRequest(new Request("https://app.example/api", { headers: { origin: "https://app.example", host: "app.example" } })), true);
  assert.equal(isSameOriginMutationRequest(new Request("https://app.example/api", { headers: { origin: "https://evil.example", host: "app.example" } })), false);
  assert.equal(requestBodyIsWithinLimit(new Request("https://app.example/api", { headers: { "content-length": "16384" } })), true);
  assert.equal(requestBodyIsWithinLimit(new Request("https://app.example/api", { headers: { "content-length": "16385" } })), false);
  assert.equal((await readJsonRequestWithinLimit(new Request("https://app.example/api", { method: "POST", body: JSON.stringify({ value: "A".repeat(17_000) }) }))).ok, false);
});

test("通知ルールActionは本人・現在Household・Pet所属を使いVIEWERを共通更新ガードで拒否しない", () => {
  const source = readSource("src/app/actions/pet-notifications.ts");
  assert.match(source, /getRequiredHouseholdContext\(\)/);
  assert.doesNotMatch(source, /getRequiredHouseholdMutationContext|canEditHouseholdSharedData/);
  assert.match(source, /userId: context\.user\.id/);
  assert.match(source, /where: \{ id: petId, householdId: context\.household\.id \}/);
  assert.match(source, /householdMember\.findUnique/);
  assert.match(source, /validatePetNotificationRuleSet/);
  assert.match(source, /\$transaction/);
  assert.doesNotMatch(source, /formData\.get\("userId"\)/);
});

test("dispatchはDB一意claim・lease・retry・端末別成功履歴と送信直前再検証を持つ", () => {
  const source = readSource("src/lib/care-notification-dispatch.ts");
  const schema = readSource("prisma/schema.prisma");
  assert.match(schema, /@@unique\(\[userId, householdId, targetCareDate, scheduledAt\]\)/);
  assert.match(schema, /model CareNotificationDelivery[\s\S]*?@@id\(\[dispatchId, subscriptionId\]\)/);
  assert.match(source, /createMany\([\s\S]*?skipDuplicates: true/);
  assert.match(source, /claimToken/);
  assert.match(source, /leaseExpiresAt/);
  assert.match(source, /status: "RETRYABLE"/);
  assert.match(source, /attemptCount: \{ lt: NOTIFICATION_MAX_ATTEMPTS \}/);
  assert.match(source, /careNotificationDelivery\.findMany/);
  assert.match(source, /pendingSubscriptions = subscriptions\.filter/);
  assert.match(source, /membership\.user\.accessStatus !== "ACTIVE"/);
  assert.match(source, /membership\.household\.isDemo/);
  assert.match(source, /pet: \{ householdId: dispatch\.householdId, isActive: true \}/);
  assert.match(source, /isNotificationKindAllowed/);
  assert.match(source, /action: "CLEANED"/);
  assert.match(source, /pendingItems\.length === 0/);
});

test("Push APIは未認証・same-origin・oversize・endpoint所有者を検証する", () => {
  const route = readSource("src/app/api/push/subscriptions/route.ts");
  const status = readSource("src/app/api/push/subscriptions/status/route.ts");
  const helper = readSource("src/lib/push-subscriptions.ts");
  for (const source of [route, status]) {
    assert.match(source, /getActivePushRouteUserId/);
    assert.match(source, /isSameOriginMutationRequest/);
    assert.match(source, /readJsonRequestWithinLimit/);
  }
  assert.match(route, /where: \{ userId, endpoint: subscription\.endpoint \}/);
  assert.match(helper, /existing\.userId !== userId/);
  assert.match(helper, /ownedByAnotherUser/);
});

test("Pet通知UIは折りたたみ・species別表示・独立dirty state・inactive案内を実装する", () => {
  const source = readSource("src/components/pet-notification-rules-form.tsx");
  assert.match(source, /aria-expanded=\{isOpen\}/);
  assert.match(source, /data-pet-notification-settings/);
  assert.match(source, /notificationKindsForSpecies\(species\)/);
  assert.match(source, /data-dirty-watch/);
  assert.match(source, /data-dirty-control/);
  assert.match(source, /commitFormDirtyState/);
  assert.match(source, /管理終了中のため通知は送信されません。/);
  assert.match(source, /sm:grid-cols-3/);
  assert.doesNotMatch(source, /moss|persimmon|straw|paper/);
});

test("設定UIは端末の全状態・本文モード・iOS案内を持つ", () => {
  const source = readSource("src/components/notification-settings-form.tsx");
  for (const state of ["checking", "unsupported", "unselected", "denied", "permittedUnsubscribed", "browserOnly", "enabled", "released", "error"]) {
    assert.match(source, new RegExp(`${state}:`));
  }
  assert.match(source, /Notification\.requestPermission\(\)/);
  assert.match(source, /この端末で通知を有効にする/);
  assert.match(source, /この端末の通知を解除する/);
  assert.match(source, /Safariでこのアプリをホーム画面に追加し、ホーム画面から起動した上で/);
  assert.match(source, /value: "normal"/);
  assert.match(source, /value: "compact"/);
  assert.doesNotMatch(source, /moss|persimmon|straw|paper/);
});

test("Service WorkerはPushを安全化し、通知クリックでcareをfocusまたはopenする", async () => {
  const source = readSource("public/sw.js");
  type WorkerEvent = {
    data?: { json(): unknown };
    notification?: { close(): void };
    waitUntil(promise: Promise<unknown>): void;
  };
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const shown: unknown[][] = [];
  let opened = "";
  const self = {
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) => listeners.set(type, listener),
    registration: { showNotification: async (...args: unknown[]) => shown.push(args) },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened = url; } },
    location: { origin: "https://app.example" }
  };
  vm.runInNewContext(source, { self, URL });
  let pending: Promise<unknown> = Promise.resolve();
  listeners.get("push")?.({ data: { json: () => ({ title: "通知", body: "ソラ\u0000\n朝食" }) }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.equal((shown[0][1] as { body: string }).body, "ソラ\n朝食");
  listeners.get("notificationclick")?.({ notification: { close() {} }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.equal(opened, "/care");
});
