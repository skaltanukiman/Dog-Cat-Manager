import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  getCareNotificationSummaryLabels,
  getDeviceNotificationSummaryLabel,
  NotificationSettingsForm
} from "../src/components/notification-settings-form";
import type { CareNotificationSettings } from "../src/lib/care-notifications";

const savedSettings: CareNotificationSettings = {
  feedingNotificationEnabled: true,
  feedingDeadlineMinutes: 1320,
  feedingNotifyBeforeMinutes: 30,
  waterNotificationEnabled: false,
  waterDeadlineMinutes: 1260,
  waterNotifyBeforeMinutes: 30,
  careNotificationCompactBody: true
};

function renderNotificationSettings(settings: CareNotificationSettings = savedSettings) {
  return renderToStaticMarkup(
    <NotificationSettingsForm
      settings={settings}
      vapidConfigured={false}
      vapidPublicKey={null}
    />
  );
}

function readSource() {
  return readFileSync(
    new URL("../src/components/notification-settings-form.tsx", import.meta.url),
    "utf8"
  );
}

test("通知設定は保存値の概要を表示し、全画面幅で初期状態が閉じている", () => {
  const markup = renderNotificationSettings();
  const controlsId = markup.match(/aria-controls="([^"]+)"/)?.[1];

  assert.match(markup, /<section[^>]*aria-label="通知設定"[^>]*data-settings-section="notifications"/);
  assert.match(
    markup,
    /<button(?=[^>]*type="button")(?=[^>]*aria-expanded="false")(?=[^>]*aria-controls="[^"]+")(?=[^>]*data-notification-settings-toggle="true")(?=[^>]*data-state="closed")[^>]*>/
  );
  assert.ok(controlsId);
  assert.match(
    markup,
    new RegExp(`<div id="${controlsId}"[^>]*aria-hidden="true"[^>]*data-notification-settings-content="true"[^>]*data-state="closed"`)
  );
  assert.match(markup, /role="heading" aria-level="3"[^>]*>通知設定</);
  assert.match(markup, /現在の共有グループについて、未実施のお世話を期限前に通知します。/);
  assert.match(markup, /<svg[^>]*aria-hidden="true"/);
  assert.equal(markup.match(/data-notification-settings-summary-chip="true"/g)?.length, 4);
  assert.match(markup, /data-notification-settings-summary-chip="true"[^>]*>食事通知：オン</);
  assert.match(markup, /data-notification-settings-summary-chip="true"[^>]*>水替え通知：オフ</);
  assert.match(markup, /data-notification-settings-summary-chip="true"[^>]*>通知本文：簡略</);
  assert.match(markup, /data-notification-settings-summary-chip="true"[^>]*>端末通知：確認中</);
  assert.match(markup, /data-notification-settings-action="true"[^>]*>設定を変更/);
  assert.match(markup, /data-notification-settings-chevron="true" data-state="closed"/);
});

test("簡略表示例は食事と水替えを全角縦線で区切って表示する", () => {
  const markup = renderNotificationSettings();

  assert.match(
    markup,
    /簡略表示例：<\/span><span class="mt-1 block break-words">【食事】未実施｜【水替え】未実施<\/span>/
  );
  assert.doesNotMatch(markup, /食事が未実施のハムスターがいます|水替えが未交換/);
});

test("折りたたみヘッダーは表示設定と同じmoss系の色・形状・余白を使う", () => {
  const markup = renderNotificationSettings();
  const source = readSource();
  const iconStart = markup.indexOf('data-notification-settings-icon="true"');
  const iconOpeningStart = markup.lastIndexOf("<span", iconStart);
  const iconEnd = markup.indexOf("</span>", iconStart);
  const firstChipStart = markup.indexOf('data-notification-settings-summary-chip="true"');
  const firstChipEnd = markup.indexOf("</span>", firstChipStart);

  assert.match(
    markup,
    /<section[^>]*class="min-w-0 overflow-hidden rounded-md border border-moss\/30 bg-white shadow-sm"/
  );
  assert.match(
    markup,
    /<button[^>]*class="min-h-11 w-full text-left[^\"]*active:bg-moss\/20[^\"]*focus-visible:ring-moss[^\"]*bg-moss\/10 hover:bg-moss\/\[0\.15\]"/
  );
  assert.ok(iconOpeningStart >= 0 && iconStart > iconOpeningStart && iconEnd > iconStart);
  assert.match(markup.slice(iconOpeningStart, iconEnd), /rounded-md bg-moss\/20 text-moss/);
  assert.doesNotMatch(markup.slice(iconOpeningStart, iconEnd), /rounded-full/);
  assert.match(markup, /class="block text-base font-bold text-ink" role="heading" aria-level="3">通知設定/);
  assert.match(
    markup,
    /class="mt-0\.5 block text-xs leading-5 text-slate-600">現在の共有グループについて、未実施のお世話を期限前に通知します。/
  );
  assert.match(
    markup,
    /class="mt-3 flex min-w-0 flex-wrap gap-1\.5" aria-label="現在の通知設定" data-notification-settings-summary="true"/
  );
  assert.ok(firstChipStart >= 0 && firstChipEnd > firstChipStart);
  assert.match(
    markup.slice(firstChipStart, firstChipEnd),
    /max-w-full rounded-md border border-moss\/20 bg-white px-2 py-1 text-xs font-medium leading-4 text-slate-700/
  );
  assert.doesNotMatch(markup.slice(firstChipStart, firstChipEnd), /rounded-full|px-2\.5|font-semibold/);
  assert.match(
    markup,
    /class="mt-3 flex items-center justify-end gap-1 text-sm font-bold text-moss"><span data-notification-settings-action="true">設定を変更/
  );
  assert.match(source, /\? "bg-moss\/\[0\.15\] hover:bg-moss\/20"/);
  assert.match(source, /: "bg-moss\/10 hover:bg-moss\/\[0\.15\]"/);
  assert.doesNotMatch(source.slice(source.indexOf('data-settings-section="notifications"'), source.indexOf("data-notification-settings-content")), /persimmon/);
  assert.doesNotMatch(source, /md:flex-row|md:justify-between|md:max-w-\[/);
});

test("端末通知の状態を短い概要チップ文言へ変換する", () => {
  assert.equal(getDeviceNotificationSummaryLabel("checking"), "端末通知：確認中");
  assert.equal(getDeviceNotificationSummaryLabel("enabled"), "端末通知：有効");
  assert.equal(getDeviceNotificationSummaryLabel("released"), "端末通知：解除済み");
  assert.equal(getDeviceNotificationSummaryLabel("denied"), "端末通知：拒否");
  assert.equal(getDeviceNotificationSummaryLabel("permittedUnsubscribed"), "端末通知：未登録");
  assert.equal(getDeviceNotificationSummaryLabel("browserOnly"), "端末通知：未登録");
  assert.equal(getDeviceNotificationSummaryLabel("unsupported"), "端末通知：非対応");
  assert.equal(getDeviceNotificationSummaryLabel("unselected"), "端末通知：未選択");
  assert.equal(getDeviceNotificationSummaryLabel("error"), "端末通知：エラー");

  const source = readSource();
  assert.match(source, /useState<DeviceState>\("checking"\)/);
  assert.match(source, /getDeviceNotificationSummaryLabel\(deviceState\)/);
  assert.match(source, /<DeviceNotificationControls[\s\S]*?state=\{deviceState\}[\s\S]*?setState=\{setDeviceState\}/);
});

test("折りたたみ内容は可変高を200msで遷移し、閉状態では操作対象外になる", () => {
  const markup = renderNotificationSettings();
  const source = readSource();

  assert.match(
    markup,
    /data-notification-settings-content="true"[^>]*class="grid[^\"]*transition-\[grid-template-rows,opacity,visibility\][^\"]*duration-200[^\"]*motion-reduce:transition-none[^\"]*invisible grid-rows-\[0fr\] opacity-0 pointer-events-none/
  );
  assert.match(markup, /<div class="min-h-0 overflow-hidden">/);
  assert.match(source, /\? "visible grid-rows-\[1fr\] opacity-100"/);
  assert.match(source, /: "invisible grid-rows-\[0fr\] opacity-0 pointer-events-none"/);
  assert.match(source, /isOpen \? "rotate-180" : ""/);
  assert.doesNotMatch(source, /max-h-\[/);
  assert.doesNotMatch(source, /md:(?:hidden|block|visible|opacity-100|pointer-events-auto)/);
});

test("閉じた状態でもフォーム入力と端末通知をDOMへ保持する", () => {
  const markup = renderNotificationSettings();

  for (const name of [
    "feedingNotificationEnabled",
    "feedingDeadline",
    "feedingNotifyBeforeMinutes",
    "waterNotificationEnabled",
    "waterDeadline",
    "waterNotifyBeforeMinutes",
    "careNotificationCompactBody"
  ]) {
    assert.match(markup, new RegExp(`<input[^>]*name="${name}"`));
  }
  assert.match(markup, /<form[^>]*data-dirty-watch="true"/);
  assert.match(markup, /端末通知/);
  assert.match(markup, /この端末で通知を有効にする/);
  assert.match(markup, /この端末の通知を解除する/);
});

test("主要3設定の変更値から概要チップを即時生成できる", () => {
  assert.deepEqual(
    getCareNotificationSummaryLabels({
      feedingEnabled: false,
      waterEnabled: true,
      compactBodyEnabled: false
    }),
    ["食事通知：オフ", "水替え通知：オン", "通知本文：通常"]
  );
  assert.deepEqual(
    getCareNotificationSummaryLabels({
      feedingEnabled: true,
      waterEnabled: false,
      compactBodyEnabled: true
    }),
    ["食事通知：オン", "水替え通知：オフ", "通知本文：簡略"]
  );
});

test("概要対象のcheckboxはフォーム送信を維持したcontrolled stateである", () => {
  const source = readSource();

  assert.match(source, /useState\(settings\.feedingNotificationEnabled\)/);
  assert.match(source, /useState\(settings\.waterNotificationEnabled\)/);
  assert.match(source, /useState\(settings\.careNotificationCompactBody\)/);
  assert.match(source, /name=\{`\$\{prefix\}NotificationEnabled`\}[\s\S]*?checked=\{enabled\}[\s\S]*?onChange=/);
  assert.match(source, /name="careNotificationCompactBody"[\s\S]*?checked=\{compactBodyEnabled\}[\s\S]*?onChange=/);
  assert.match(source, /useActionState\([\s\S]*?saveCareNotificationSettings,[\s\S]*?INITIAL_SETTINGS_SAVE_STATE/);
  assert.match(source, /<form[\s\S]*?ref=\{formRef\}[\s\S]*?action=\{saveAction\}[\s\S]*?data-dirty-watch/);
  assert.match(source, /<button[\s\S]*?type="button"[\s\S]*?aria-expanded=\{isOpen\}[\s\S]*?aria-controls=\{contentId\}/);
});

test("フォームと端末通知は開閉条件でアンマウントされない", () => {
  const source = readSource();
  const contentStart = source.indexOf("data-notification-settings-content");
  const formStart = source.indexOf("<form", contentStart);
  const deviceStart = source.indexOf("<DeviceNotificationControls", contentStart);

  assert.ok(contentStart >= 0);
  assert.ok(formStart > contentStart);
  assert.ok(deviceStart > formStart);
  assert.doesNotMatch(source, /isOpen\s*\?\s*\(?\s*<form/);
  assert.doesNotMatch(source, /isOpen\s*&&\s*\(?\s*<form/);
  assert.doesNotMatch(source, /isOpen\s*&&\s*\(?\s*<DeviceNotificationControls/);
});
