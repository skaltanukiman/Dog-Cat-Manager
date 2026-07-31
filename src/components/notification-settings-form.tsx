"use client";

import { Bell, BellOff, Save, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

import { saveCareNotificationSettings } from "@/app/actions/care-notifications";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { SETTINGS_CARD_RESPONSIVE_PADDING } from "@/components/settings-layout";
import {
  formatMinutesAsTime,
  MAX_NOTIFY_BEFORE_MINUTES,
  type CareNotificationSettings
} from "@/lib/care-notifications";

type DeviceState =
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

function DeviceNotificationControls({ configured, publicKey }: { configured: boolean; publicKey: string | null }) {
  const [state, setState] = useState<DeviceState>("checking");
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
  }, []);

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
            iPhone・iPadではSafariからホーム画面へ追加したPWAを開き、このボタンから通知を許可してください。
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
  deadlineMinutes,
  notifyBeforeMinutes
}: {
  prefix: "feeding" | "water";
  title: string;
  enabled: boolean;
  deadlineMinutes: number;
  notifyBeforeMinutes: number;
}) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 font-semibold text-ink">{title}</legend>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-slate-700">
        <input name={`${prefix}NotificationEnabled`} type="checkbox" defaultChecked={enabled} className="h-5 w-5 rounded border-slate-300 text-moss" />
        通知する
      </label>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          完了期限時刻
          <input name={`${prefix}Deadline`} type="time" required defaultValue={formatMinutesAsTime(deadlineMinutes)} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-ink" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          期限の何分前に通知するか
          <input name={`${prefix}NotifyBeforeMinutes`} type="number" required min={0} max={MAX_NOTIFY_BEFORE_MINUTES} step={1} defaultValue={notifyBeforeMinutes} className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-ink" />
        </label>
      </div>
    </fieldset>
  );
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
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_RESPONSIVE_PADDING}`}>
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-persimmon" aria-hidden />
        <div>
          <h3 className="text-lg font-bold text-ink">通知設定</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">現在の共有グループについて、未実施のお世話を期限前に通知します。</p>
        </div>
      </div>
      <form action={saveCareNotificationSettings} data-dirty-watch className="mt-5 space-y-4">
        <CareFields prefix="feeding" title="食事通知" enabled={settings.feedingNotificationEnabled} deadlineMinutes={settings.feedingDeadlineMinutes} notifyBeforeMinutes={settings.feedingNotifyBeforeMinutes} />
        <CareFields prefix="water" title="水替え通知" enabled={settings.waterNotificationEnabled} deadlineMinutes={settings.waterDeadlineMinutes} notifyBeforeMinutes={settings.waterNotifyBeforeMinutes} />
        <div className="flex justify-end">
          <DirtySubmitButton className="inline-flex min-h-11 items-center gap-2 rounded-md bg-moss px-5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-slate-300">
            <Save className="h-4 w-4" aria-hidden />
            通知設定を保存
          </DirtySubmitButton>
        </div>
      </form>
      <div className="mt-5">
        <DeviceNotificationControls configured={vapidConfigured} publicKey={vapidPublicKey} />
      </div>
    </section>
  );
}
