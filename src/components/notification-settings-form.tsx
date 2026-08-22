"use client";

import { Bell, BellOff, ChevronDown, Save, Smartphone } from "lucide-react";
import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";

import { saveCareNotificationBodySetting } from "@/app/actions/care-notifications";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { commitFormDirtyState, requestFormDirtyReevaluation } from "@/components/form-dirty-state";
import { SETTINGS_CARD_STANDARD_PADDING } from "@/components/settings-layout";
import { StatusMessage } from "@/components/status-message";
import { INITIAL_SETTINGS_SAVE_STATE, isCommittedSettingsSave } from "@/lib/settings-save-state";

export type DeviceState = "checking" | "unsupported" | "unselected" | "denied" | "permittedUnsubscribed" | "browserOnly" | "enabled" | "released" | "error";

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

const DEVICE_LABELS: Record<DeviceState, string> = {
  checking: "確認中", unsupported: "非対応", unselected: "未選択", denied: "拒否",
  permittedUnsubscribed: "未登録", browserOnly: "未登録", enabled: "有効",
  released: "解除済み", error: "エラー"
};

function supportsWebPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
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

function DeviceNotificationControls({ configured, publicKey, state, setState }: {
  configured: boolean;
  publicKey: string | null;
  state: DeviceState;
  setState: (state: DeviceState) => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function inspect() {
      if (!supportsWebPush()) return active && setState("unsupported");
      if (Notification.permission === "denied") return active && setState("denied");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return active && setState(Notification.permission === "granted" ? "permittedUnsubscribed" : "unselected");
      const result = await subscriptionStatus(subscription.endpoint);
      if (active) setState(result.registered ? "enabled" : "browserOnly");
    }
    void inspect().catch(() => active && setState("error"));
    return () => { active = false; };
  }, [setState]);

  async function enable() {
    if (!configured || !publicKey || !supportsWebPush()) return setState("unsupported");
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "unselected");
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const wasCreated = !subscription;
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      const response = await fetch("/api/push/subscriptions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      if (!response.ok) {
        if (wasCreated) await subscription.unsubscribe();
        throw new Error("register failed");
      }
      setState("enabled");
    } catch { setState("error"); } finally { setBusy(false); }
  }

  async function disable() {
    if (!supportsWebPush()) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return setState("released");
      const response = await fetch("/api/push/subscriptions", {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      if (!response.ok) throw new Error("remove failed");
      setState(await subscription.unsubscribe() ? "released" : "browserOnly");
    } catch { setState("error"); } finally { setBusy(false); }
  }

  return <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-start gap-3">
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
      <div><h4 className="font-semibold text-ink">通知端末</h4>
        <p className="mt-1 text-sm leading-6 text-slate-600" aria-live="polite">{DEVICE_MESSAGES[state]}</p>
        {!configured ? <p className="mt-2 text-sm text-amber-700">サーバーのVAPID設定が未完了のため、端末登録は利用できません。</p> : null}
        <p className="mt-2 text-xs leading-5 text-slate-500">iPhone・iPadでは、Safariでこのアプリをホーム画面に追加し、ホーム画面から起動した上で「この端末で通知を有効にする」を押してください。</p>
      </div>
    </div>
    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <button type="button" onClick={() => void enable()} disabled={busy || !configured || state === "unsupported" || state === "denied"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-slate-300"><Bell className="h-4 w-4" aria-hidden />この端末で通知を有効にする</button>
      <button type="button" onClick={() => void disable()} disabled={busy || state === "unsupported"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"><BellOff className="h-4 w-4" aria-hidden />この端末の通知を解除する</button>
    </div>
  </div>;
}

export function NotificationSettingsForm({ compactBody, vapidConfigured, vapidPublicKey }: {
  compactBody: boolean;
  vapidConfigured: boolean;
  vapidPublicKey: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(compactBody);
  const [deviceState, setDeviceState] = useState<DeviceState>("checking");
  const setDeviceStateStable = useCallback((state: DeviceState) => setDeviceState(state), []);
  const [saveState, saveAction, isSaving] = useActionState(saveCareNotificationBodySetting, INITIAL_SETTINGS_SAVE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (saveState.submissionId === 0) return;
    if (!isCommittedSettingsSave(saveState)) return requestFormDirtyReevaluation(formRef.current);
    window.requestAnimationFrame(() => {
      const saved = saveState.savedCareNotificationCompactBody ?? compactBody;
      setIsCompact(saved);
      for (const mode of ["normal", "compact"] as const) {
        const input = formRef.current?.querySelector<HTMLInputElement>(`input[value="${mode}"]`);
        if (input) { input.checked = saved === (mode === "compact"); input.defaultChecked = input.checked; }
      }
      commitFormDirtyState(formRef.current);
    });
  }, [saveState, compactBody]);

  return <section aria-label="通知設定" data-settings-section="notifications" className="min-w-0 overflow-hidden rounded-md border border-brand/30 bg-white shadow-sm">
    <button type="button" aria-expanded={isOpen} aria-controls={contentId} onClick={() => setIsOpen((current) => !current)} className={`min-h-11 w-full text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${SETTINGS_CARD_STANDARD_PADDING} ${isOpen ? "bg-brand/[0.15]" : "bg-brand/10 hover:bg-brand/[0.15]"}`}>
      <span className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/20 text-brand"><Bell className="h-5 w-5" aria-hidden /></span><span className="min-w-0 flex-1"><span className="block text-base font-bold text-ink" role="heading" aria-level={3}>通知設定</span><span className="mt-0.5 block text-xs leading-5 text-slate-600">この端末の購読と、現在の共有グループにおける本人の通知本文を管理します。</span></span></span>
      <span className="mt-3 flex flex-wrap gap-1.5" aria-label="現在の通知設定"><span className="rounded-md border border-brand/20 bg-white px-2 py-1 text-xs font-medium text-slate-700">通知本文：{isCompact ? "簡略" : "通常"}</span><span className="rounded-md border border-brand/20 bg-white px-2 py-1 text-xs font-medium text-slate-700">端末通知：{DEVICE_LABELS[deviceState]}</span></span>
      <span className="mt-3 flex items-center justify-end gap-1 text-sm font-bold text-brand">{isOpen ? "閉じる" : "設定する"}<ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden /></span>
    </button>
    <div id={contentId} aria-hidden={!isOpen} className={`grid overflow-hidden transition-[grid-template-rows,opacity,visibility] duration-200 ${isOpen ? "visible grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0 pointer-events-none"}`}><div className="min-h-0 overflow-hidden"><div className={`space-y-5 border-t border-slate-200 ${SETTINGS_CARD_STANDARD_PADDING}`}>
      <form ref={formRef} action={saveAction} data-dirty-watch aria-busy={isSaving}>
        <fieldset><legend className="font-semibold text-ink">通知本文</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{([{ value: "normal", label: "通常", description: "Pet名とルール名を表示します。" }, { value: "compact", label: "簡略", description: "件数だけを短く表示します。" }] as const).map((option) => <label key={option.value} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${isCompact === (option.value === "compact") ? "border-brand bg-brand/10" : "border-slate-200"}`}><input type="radio" name="careNotificationBodyMode" value={option.value} checked={isCompact === (option.value === "compact")} onChange={() => setIsCompact(option.value === "compact")} className="mt-1 h-4 w-4 text-brand"/><span><span className="block font-semibold text-ink">{option.label}</span><span className="mt-1 block text-xs text-slate-500">{option.description}</span></span></label>)}</div></fieldset>
        {saveState.status ? <div key={saveState.submissionId} className="mt-4"><StatusMessage status={saveState.status} errorId={saveState.errorId} /></div> : null}
        <div className="mt-4 flex justify-end"><DirtySubmitButton disabled={isSaving} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark disabled:bg-slate-300"><Save className="h-4 w-4" aria-hidden />{isSaving ? "保存中…" : "通知本文を保存"}</DirtySubmitButton></div>
      </form>
      <DeviceNotificationControls configured={vapidConfigured} publicKey={vapidPublicKey} state={deviceState} setState={setDeviceStateStable} />
    </div></div></div>
  </section>;
}
