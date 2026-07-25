"use client";

import { RefreshCw, WifiOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { hasDirtyForms } from "@/components/form-dirty-state";
import { REALTIME_ACTOR_FIELD, REALTIME_LOCAL_SUBMIT_EVENT } from "@/lib/realtime-constants";
import {
  createRealtimeClientId,
  ensureRealtimeClientId
} from "@/lib/realtime-client-id";
import {
  createRealtimeHealthState,
  getRealtimeRetryDelay,
  recordRealtimeFailure,
  recordRealtimeSuccess,
  shouldShowRealtimeWarning
} from "@/lib/realtime-health";

type RealtimeRefreshListenerProps = {
  householdId: string;
  currentUserId: string;
};

type HouseholdChangePayload = {
  householdId: string;
  actorClientId: string | null;
  actorUserId: string | null;
  revision: string;
};

type HouseholdRevisionPayload = {
  householdId: string;
  revision: string;
  actorClientId: string | null;
  actorUserId: string | null;
};

const REMOTE_REFRESH_DEBOUNCE_MS = 150;

function isGetForm(form: HTMLFormElement) {
  return form.method.toLowerCase() === "get" && !form.hasAttribute("data-dirty-watch");
}

export function RealtimeRefreshListener({ currentUserId, householdId }: RealtimeRefreshListenerProps) {
  const router = useRouter();
  const clientIdRef = useRef<string>(createRealtimeClientId());
  const lastRevisionRef = useRef<string | null>(null);
  const [hasPendingChange, setHasPendingChange] = useState(false);
  const [hasSyncWarning, setHasSyncWarning] = useState(false);

  useEffect(() => {
    const clientId = ensureRealtimeClientId();
    clientIdRef.current = clientId;
    lastRevisionRef.current = null;
    let isMounted = true;
    let isRevisionCheckInFlight = false;
    let refreshTimer: number | null = null;
    let revisionPollTimer: number | null = null;
    let healthState = createRealtimeHealthState(Date.now());

    const eventSource = new EventSource(`/api/realtime/household?householdId=${encodeURIComponent(householdId)}`);

    function ensureActorField(form: HTMLFormElement) {
      if (isGetForm(form)) {
        return;
      }

      const existingField = form.elements.namedItem(REALTIME_ACTOR_FIELD);

      if (existingField instanceof HTMLInputElement) {
        existingField.value = clientId;
        return;
      }

      const actorField = document.createElement("input");
      actorField.type = "hidden";
      actorField.name = REALTIME_ACTOR_FIELD;
      actorField.value = clientId;
      form.append(actorField);
    }

    function syncActorFields() {
      document.querySelectorAll<HTMLFormElement>("form").forEach(ensureActorField);
    }

    function isNewerRevision(revision: string) {
      if (!/^\d+$/.test(revision)) {
        return false;
      }

      const currentRevision = lastRevisionRef.current;

      if (!currentRevision) {
        return true;
      }

      return BigInt(revision) > BigInt(currentRevision);
    }

    function isSelfAuthored(actorClientId: string | null, actorUserId: string | null) {
      return actorClientId === clientIdRef.current || actorUserId === currentUserId;
    }

    function cleanupRealtimeQueryParam() {
      const currentUrl = new URL(window.location.href);

      if (!currentUrl.searchParams.has(REALTIME_ACTOR_FIELD)) {
        return;
      }

      currentUrl.searchParams.delete(REALTIME_ACTOR_FIELD);
      window.history.replaceState(window.history.state, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    }

    function markSyncSuccess() {
      healthState = recordRealtimeSuccess(healthState, Date.now());
      setHasSyncWarning(false);
    }

    function markSyncFailure() {
      healthState = recordRealtimeFailure(healthState);
      setHasSyncWarning(shouldShowRealtimeWarning(healthState, Date.now()));
    }

    async function fetchRevision() {
      try {
        const response = await fetch(`/api/realtime/household/revision?householdId=${encodeURIComponent(householdId)}`, {
          cache: "no-store"
        });

        if (!response.ok) {
          return { ok: false as const };
        }

        const payload = (await response.json()) as HouseholdRevisionPayload;
        return payload.householdId === householdId && /^\d+$/.test(payload.revision)
          ? { ok: true as const, payload }
          : { ok: false as const };
      } catch {
        return { ok: false as const };
      }
    }

    function applyRemoteChange() {
      // 自動refreshで入力中のフォームを上書きしないよう、利用者の明示操作まで保留する。
      if (hasDirtyForms()) {
        setHasPendingChange(true);
        return;
      }

      setHasPendingChange(false);

      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }

      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, REMOTE_REFRESH_DEBOUNCE_MS);
    }

    function scheduleRevisionCheck() {
      if (!isMounted) return;
      if (revisionPollTimer !== null) window.clearTimeout(revisionPollTimer);
      revisionPollTimer = window.setTimeout(() => {
        revisionPollTimer = null;
        void checkRevision(true);
      }, getRealtimeRetryDelay(healthState.consecutiveFailures));
    }

    async function checkRevision(scheduleNext = false) {
      if (isRevisionCheckInFlight) {
        if (scheduleNext) scheduleRevisionCheck();
        return;
      }

      isRevisionCheckInFlight = true;

      try {
        const revisionResult = await fetchRevision();

        if (!isMounted) {
          return;
        }

        if (!revisionResult.ok) {
          markSyncFailure();
          return;
        }

        markSyncSuccess();
        const revisionPayload = revisionResult.payload;

        const { actorClientId, actorUserId, revision } = revisionPayload;

        // 初回取得値は比較基準であり、接続前の更新として即refreshしない。
        if (!lastRevisionRef.current) {
          lastRevisionRef.current = revision;
          return;
        }

        if (!isNewerRevision(revision)) {
          return;
        }

        lastRevisionRef.current = revision;

        if (isSelfAuthored(actorClientId, actorUserId)) {
          setHasPendingChange(false);
          return;
        }

        applyRemoteChange();
      } finally {
        isRevisionCheckInFlight = false;
        if (scheduleNext) scheduleRevisionCheck();
      }
    }

    function handleSubmitCapture(event: SubmitEvent) {
      const form = event.target;

      if (!(form instanceof HTMLFormElement)) {
        return;
      }

      if (isGetForm(form)) {
        return;
      }

      ensureActorField(form);
    }

    function handleLocalSubmitEvent(event: Event) {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const form = (event.detail as { form?: unknown } | null)?.form;

      if (!(form instanceof HTMLFormElement) || isGetForm(form)) {
        return;
      }

      ensureActorField(form);
    }

    function handleFormData(event: FormDataEvent) {
      const form = event.target;

      if (!(form instanceof HTMLFormElement) || isGetForm(form)) {
        return;
      }

      event.formData.set(REALTIME_ACTOR_FIELD, clientId);
    }

    function handleHouseholdChange(event: MessageEvent<string>) {
      let payload: HouseholdChangePayload;

      try {
        payload = JSON.parse(event.data) as HouseholdChangePayload;
      } catch {
        return;
      }

      if (payload.householdId !== householdId || !isNewerRevision(payload.revision)) {
        return;
      }

      markSyncSuccess();

      lastRevisionRef.current = payload.revision;

      if (isSelfAuthored(payload.actorClientId, payload.actorUserId)) {
        setHasPendingChange(false);
        return;
      }

      applyRemoteChange();
    }

    cleanupRealtimeQueryParam();
    syncActorFields();
    // プロセス内SSEで届かない更新も拾えるよう、DB revisionのpollを常時併用する。
    void checkRevision(true);

    const observer = new MutationObserver(syncActorFields);
    observer.observe(document.body, { childList: true, subtree: true });

    const handleEventSourceReady = () => markSyncSuccess();
    const handleEventSourceError = () => markSyncFailure();
    const handleWindowFocus = () => void checkRevision(false);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener(REALTIME_LOCAL_SUBMIT_EVENT, handleLocalSubmitEvent);
    document.addEventListener("submit", handleSubmitCapture, true);
    document.addEventListener("formdata", handleFormData, true);
    eventSource.addEventListener("household-change", handleHouseholdChange);
    eventSource.addEventListener("ready", handleEventSourceReady);
    eventSource.addEventListener("error", handleEventSourceError);

    return () => {
      isMounted = false;
      observer.disconnect();
      if (revisionPollTimer !== null) window.clearTimeout(revisionPollTimer);
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener(REALTIME_LOCAL_SUBMIT_EVENT, handleLocalSubmitEvent);
      document.removeEventListener("submit", handleSubmitCapture, true);
      document.removeEventListener("formdata", handleFormData, true);
      eventSource.removeEventListener("household-change", handleHouseholdChange);
      eventSource.removeEventListener("ready", handleEventSourceReady);
      eventSource.removeEventListener("error", handleEventSourceError);
      eventSource.close();
    };
  }, [currentUserId, householdId, router]);

  function handleRefresh() {
    setHasPendingChange(false);
    router.refresh();
  }

  if (!hasPendingChange && !hasSyncWarning) {
    return null;
  }

  return (
    <>
      {hasSyncWarning ? (
        <div className="fixed left-4 right-4 top-4 z-50 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-lg shadow-slate-300/40 sm:left-auto sm:max-w-sm" role="alert">
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">同期が停止しています。</p>
              <p className="mt-1 text-red-700">最新情報を取得できていません。入力内容は保持したまま自動再接続しています。</p>
            </div>
          </div>
        </div>
      ) : null}
      {hasPendingChange ? (
        <div className="fixed bottom-4 left-4 right-4 z-50 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-lg shadow-slate-300/40 sm:left-auto sm:max-w-sm">
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">他のユーザーが更新しました。</p>
          <p className="mt-1 text-amber-800">入力中の内容を守るため、自動更新は停止しています。</p>
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:bg-moss/90"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            再読み込み
          </button>
        </div>
        <button
          type="button"
          onClick={() => setHasPendingChange(false)}
          aria-label="通知を閉じる"
          className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-amber-900 hover:bg-amber-100"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
        </div>
      ) : null}
    </>
  );
}
