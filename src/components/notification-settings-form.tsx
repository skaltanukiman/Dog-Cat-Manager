"use client";

import { Bell, BellOff, ChevronDown, Save, Smartphone } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { saveCareNotificationSettings } from "@/app/actions/care-notifications";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import {
  commitFormDirtyState,
  requestFormDirtyReevaluation
} from "@/components/form-dirty-state";
import { SETTINGS_CARD_RESPONSIVE_PADDING } from "@/components/settings-layout";
import { StatusMessage } from "@/components/status-message";
import {
  formatMinutesAsTime,
  MAX_NOTIFY_BEFORE_MINUTES,
  type CareNotificationSettings
} from "@/lib/care-notifications";
import {
  INITIAL_SETTINGS_SAVE_STATE,
  isCommittedSettingsSave
} from "@/lib/settings-save-state";

export type DeviceState =
  | "checking"
  | "unsupported"
  | "unselected"
  | "denied"
  | "permittedUnsubscribed"
  | "browserOnly"
  | "enabled"
  | "released"
  | "error";

const DEVICE_MESSAGES: Record<DeviceState, string> = {
  checking: "この端末の通知状態を確認しています。",
  unsupported: "このブラウザーはService WorkerまたはPush APIに対応していません。",
  unselected: "通知権限はまだ選択されていません。",
  denied: "通知権限が拒否されています。ブラウザーまたは端末の設定から許可してください。",
  permittedUnsubscribed: "通知は許可済みですが、この端末の購読情報は未登録です。",
  browserOnly: "ブラウザーには購読がありますが、サーバーへ未登録です。再度有効にしてください。",
  enabled: "この端末への通知は有効です。",
  released: "この端末の通知を解除しました。",
  error: "通知端末の処理に失敗しました。しばらくしてから再度お試しください。"
};

const DEVICE_SUMMARY_LABELS: Record<DeviceState, string> = {
  checking: "確認中",
  unsupported: "非対応",
  unselected: "未選択",
  denied: "拒否",
  permittedUnsubscribed: "未登録",
  browserOnly: "未登録",
  enabled: "有効",
  released: "解除済み",
  error: "エラー"
};

export function getDeviceNotificationSummaryLabel(state: DeviceState) {
  return `端末通知：${DEVICE_SUMMARY_LABELS[state]}`;
}

function supportsWebPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function subscriptionStatus(endpoint: string) {
  const response = await fetch("/api/push/subscriptions/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint })
  });
  if (!response.ok) throw new Error("status failed");
  return (await response.json()) as { registered: boolean };
}

function DeviceNotificationControls({
  configured,
  publicKey,
  state,
  setState
}: {
  configured: boolean;
  publicKey: string | null;
  state: DeviceState;
  setState: (state: DeviceState) => void;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function inspect() {
      if (!supportsWebPush()) {
        if (active) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (active) setState("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        if (active) setState(Notification.permission === "granted" ? "permittedUnsubscribed" : "unselected");
        return;
      }
      const result = await subscriptionStatus(subscription.endpoint);
      if (active) setState(result.registered ? "enabled" : "browserOnly");
    }
    void inspect().catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [setState]);

  async function enable() {
    if (!configured || !publicKey || !supportsWebPush()) {
      setState("unsupported");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "unselected");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const wasCreated = !subscription;
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      if (!response.ok) {
        if (wasCreated) await subscription.unsubscribe();
        throw new Error("register failed");
      }
      setState("enabled");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!supportsWebPush()) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setState("released");
        return;
      }
      const response = await fetch("/api/push/subscriptions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      if (!response.ok) throw new Error("remove failed");
      const unsubscribed = await subscription.unsubscribe();
      setState(unsubscribed ? "released" : "browserOnly");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
        <div>
          <h4 className="font-semibold text-ink">端末通知</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600" aria-live="polite">{DEVICE_MESSAGES[state]}</p>
          {!configured ? (
            <p className="mt-2 text-sm text-amber-700">サーバーのVAPID設定が未完了のため、端末登録は利用できません。</p>
          ) : null}
          <p className="mt-2 text-xs leading-5 text-slate-500">
            iPhone・iPadでは、Safariでこのアプリをホーム画面に追加し、ホーム画面から開いて「この端末で通知を有効にする」を押してください。
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void enable()}
          disabled={busy || !configured || state === "unsupported" || state === "denied"}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Bell className="h-4 w-4" aria-hidden />
          この端末で通知を有効にする
        </button>
        <button
          type="button"
          onClick={() => void disable()}
          disabled={busy || state === "unsupported"}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          <BellOff className="h-4 w-4" aria-hidden />
          この端末の通知を解除する
        </button>
      </div>
    </div>
  );
}

function CareFields({
  prefix,
  title,
  enabled,
  onEnabledChange,
  deadlineMinutes,
  notifyBeforeMinutes
}: {
  prefix: "feeding" | "water";
  title: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  deadlineMinutes: number;
  notifyBeforeMinutes: number;
}) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 font-semibold text-ink">{title}</legend>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-slate-700">
        <input
          name={`${prefix}NotificationEnabled`}
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.currentTarget.checked)}
          className="h-5 w-5 rounded border-slate-300 text-moss"
        />
        通知する
      </label>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="min-w-0 max-w-full text-left text-sm font-medium text-slate-700">
          完了期限時刻
          <input name={`${prefix}Deadline`} type="time" required defaultValue={formatMinutesAsTime(deadlineMinutes)} className="mt-1 block min-h-11 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-left text-base text-ink" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          期限の何分前に通知するか
          <input name={`${prefix}NotifyBeforeMinutes`} type="number" required min={0} max={MAX_NOTIFY_BEFORE_MINUTES} step={1} defaultValue={notifyBeforeMinutes} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-ink" />
        </label>
      </div>
    </fieldset>
  );
}

export function getCareNotificationSummaryLabels({
  feedingEnabled,
  waterEnabled,
  compactBodyEnabled
}: {
  feedingEnabled: boolean;
  waterEnabled: boolean;
  compactBodyEnabled: boolean;
}) {
  return [
    `食事通知：${feedingEnabled ? "オン" : "オフ"}`,
    `水替え通知：${waterEnabled ? "オン" : "オフ"}`,
    `通知本文：${compactBodyEnabled ? "簡略" : "通常"}`
  ];
}

export function NotificationSettingsForm({
  settings,
  vapidConfigured,
  vapidPublicKey
}: {
  settings: CareNotificationSettings;
  vapidConfigured: boolean;
  vapidPublicKey: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [feedingNotificationEnabled, setFeedingNotificationEnabled] = useState(settings.feedingNotificationEnabled);
  const [waterNotificationEnabled, setWaterNotificationEnabled] = useState(settings.waterNotificationEnabled);
  const [compactBodyEnabled, setCompactBodyEnabled] = useState(settings.careNotificationCompactBody);
  const [deviceState, setDeviceState] = useState<DeviceState>("checking");
  const formRef = useRef<HTMLFormElement>(null);
  const [saveState, saveAction, isSaving] = useActionState(
    saveCareNotificationSettings,
    INITIAL_SETTINGS_SAVE_STATE
  );
  const contentId = useId();
  const summaryLabels = [
    ...getCareNotificationSummaryLabels({
      feedingEnabled: feedingNotificationEnabled,
      waterEnabled: waterNotificationEnabled,
      compactBodyEnabled
    }),
    getDeviceNotificationSummaryLabel(deviceState)
  ];

  useEffect(() => {
    if (saveState.submissionId === 0) {
      return;
    }

    if (isCommittedSettingsSave(saveState)) {
      const savedSettings = saveState.savedCareNotificationSettings;
      window.requestAnimationFrame(() => {
        const form = formRef.current;
        if (form && savedSettings) {
          setFeedingNotificationEnabled(savedSettings.feedingNotificationEnabled);
          setWaterNotificationEnabled(savedSettings.waterNotificationEnabled);
          setCompactBodyEnabled(savedSettings.careNotificationCompactBody);

          const setChecked = (name: string, checked: boolean) => {
            const input = form.elements.namedItem(name);
            if (input instanceof HTMLInputElement) {
              input.checked = checked;
              input.defaultChecked = checked;
            }
          };
          const setValue = (name: string, value: string) => {
            const input = form.elements.namedItem(name);
            if (input instanceof HTMLInputElement) {
              input.value = value;
              input.defaultValue = value;
            }
          };

          setChecked("feedingNotificationEnabled", savedSettings.feedingNotificationEnabled);
          setChecked("waterNotificationEnabled", savedSettings.waterNotificationEnabled);
          setChecked("careNotificationCompactBody", savedSettings.careNotificationCompactBody);
          setValue("feedingDeadline", formatMinutesAsTime(savedSettings.feedingDeadlineMinutes));
          setValue("feedingNotifyBeforeMinutes", String(savedSettings.feedingNotifyBeforeMinutes));
          setValue("waterDeadline", formatMinutesAsTime(savedSettings.waterDeadlineMinutes));
          setValue("waterNotifyBeforeMinutes", String(savedSettings.waterNotifyBeforeMinutes));
        }
        commitFormDirtyState(form);
      });
      return;
    }

    requestFormDirtyReevaluation(formRef.current);
  }, [saveState]);

  return (
    <section
      aria-label="通知設定"
      data-settings-section="notifications"
      className="min-w-0 overflow-hidden rounded-md border border-moss/30 bg-white shadow-sm"
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        data-notification-settings-toggle
        data-state={isOpen ? "open" : "closed"}
        onClick={() => setIsOpen((current) => !current)}
        className={`min-h-11 w-full text-left transition-colors duration-200 ease-out active:bg-moss/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss motion-reduce:transition-none ${SETTINGS_CARD_RESPONSIVE_PADDING} ${
          isOpen
            ? "bg-moss/[0.15] hover:bg-moss/20"
            : "bg-moss/10 hover:bg-moss/[0.15]"
        }`}
      >
        <span className="flex min-w-0 items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-moss/20 text-moss"
            data-notification-settings-icon
          >
            <Bell className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-ink" role="heading" aria-level={3}>
              通知設定
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-600">
              現在の共有グループについて、未実施のお世話を期限前に通知します。
            </span>
          </span>
        </span>

        <span
          className="mt-3 flex min-w-0 flex-wrap gap-1.5"
          aria-label="現在の通知設定"
          data-notification-settings-summary
        >
          {summaryLabels.map((label) => (
            <span
              key={label}
              data-notification-settings-summary-chip
              className="max-w-full rounded-md border border-moss/20 bg-white px-2 py-1 text-xs font-medium leading-4 text-slate-700"
            >
              {label}
            </span>
          ))}
        </span>

        <span className="mt-3 flex items-center justify-end gap-1 text-sm font-bold text-moss">
          <span data-notification-settings-action>{isOpen ? "閉じる" : "設定を変更"}</span>
          <ChevronDown
            data-notification-settings-chevron
            data-state={isOpen ? "open" : "closed"}
            className={`h-5 w-5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </span>
      </button>
      <div
        id={contentId}
        aria-hidden={!isOpen}
        data-notification-settings-content
        data-state={isOpen ? "open" : "closed"}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,visibility] duration-200 ease-out motion-reduce:transition-none ${
          isOpen
            ? "visible grid-rows-[1fr] opacity-100"
            : "invisible grid-rows-[0fr] opacity-0 pointer-events-none"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`border-t border-slate-200 ${SETTINGS_CARD_RESPONSIVE_PADDING}`}>
            <form
              ref={formRef}
              action={saveAction}
              data-dirty-watch
              aria-busy={isSaving}
              className="space-y-4"
            >
              <CareFields
                prefix="feeding"
                title="食事通知"
                enabled={feedingNotificationEnabled}
                onEnabledChange={setFeedingNotificationEnabled}
                deadlineMinutes={settings.feedingDeadlineMinutes}
                notifyBeforeMinutes={settings.feedingNotifyBeforeMinutes}
              />
              <CareFields
                prefix="water"
                title="水替え通知"
                enabled={waterNotificationEnabled}
                onEnabledChange={setWaterNotificationEnabled}
                deadlineMinutes={settings.waterDeadlineMinutes}
                notifyBeforeMinutes={settings.waterNotifyBeforeMinutes}
              />
              <fieldset className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 font-semibold text-ink">通知本文</legend>
                <p id="care-notification-compact-label" className="text-sm font-medium text-slate-700">
                  通知内容を簡略表示する
                </p>
                <label
                  htmlFor="care-notification-compact-body"
                  className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-3 py-2"
                >
                  <span className="relative shrink-0">
                    <input
                      id="care-notification-compact-body"
                      name="careNotificationCompactBody"
                      type="checkbox"
                      checked={compactBodyEnabled}
                      onChange={(event) => setCompactBodyEnabled(event.currentTarget.checked)}
                      aria-labelledby="care-notification-compact-label"
                      aria-describedby="care-notification-compact-help"
                      className="peer sr-only"
                    />
                    <span className="block h-6 w-11 rounded-full border border-slate-500 bg-slate-400 transition-colors duration-200 ease-out peer-checked:border-moss peer-checked:bg-moss peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-moss motion-reduce:transition-none" />
                    <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out peer-checked:translate-x-5 motion-reduce:transition-none" />
                  </span>
                  <span
                    id="care-notification-compact-state"
                    className={`whitespace-nowrap text-sm font-semibold ${compactBodyEnabled ? "text-moss" : "text-slate-700"}`}
                    aria-hidden="true"
                  >
                    {compactBodyEnabled ? "オン" : "オフ"}
                  </span>
                </label>
                <p id="care-notification-compact-help" className="mt-2 text-xs leading-5 text-slate-500">
                  ハムスター名を表示せず、未実施のお世話だけを短く通知します。
                </p>
                <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                  <span className="block font-medium">簡略表示例：</span>
                  <span className="mt-1 block break-words">
                    【食事】未実施｜【水替え】未実施
                  </span>
                </p>
              </fieldset>
              <div>
                {saveState.status ? (
                  <div
                    key={saveState.submissionId}
                    data-settings-save-toast
                    className="fixed inset-x-4 bottom-20 z-50 sm:left-auto sm:right-5 sm:w-full sm:max-w-md"
                  >
                    <StatusMessage status={saveState.status} errorId={saveState.errorId} />
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <DirtySubmitButton
                    disabled={isSaving}
                    className="inline-flex min-h-11 items-center gap-2 rounded-md bg-moss px-5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Save className="h-4 w-4" aria-hidden />
                    {isSaving ? "保存中…" : "通知設定を保存"}
                  </DirtySubmitButton>
                </div>
              </div>
            </form>
            <div className="mt-5">
              <DeviceNotificationControls
                configured={vapidConfigured}
                publicKey={vapidPublicKey}
                state={deviceState}
                setState={setDeviceState}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
