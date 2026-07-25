"use client";

import { RefreshCw, WifiOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { hasDirtyForms } from "@/components/form-dirty-state";
import { decideContactRealtimeChange } from "@/lib/contact-realtime-client";
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

type ContactRealtimeRefreshListenerProps = {
  publicId: string;
  initialRevision: string;
};

type ContactChangePayload = {
  publicId: string;
  actorClientId: string | null;
  revision: string;
};

type ContactRevisionPayload = ContactChangePayload & {
  actorUserId: string | null;
};

const REMOTE_REFRESH_DEBOUNCE_MS = 150;

export function ContactRealtimeRefreshListener({
  publicId,
  initialRevision
}: ContactRealtimeRefreshListenerProps) {
  const router = useRouter();
  const clientIdRef = useRef(createRealtimeClientId());
  const lastRevisionRef = useRef(initialRevision);
  const [hasPendingChange, setHasPendingChange] = useState(false);
  const [hasSyncWarning, setHasSyncWarning] = useState(false);

  useEffect(() => {
    const clientId = ensureRealtimeClientId();
    clientIdRef.current = clientId;
    lastRevisionRef.current = initialRevision;
    let isMounted = true;
    let isRevisionCheckInFlight = false;
    let refreshTimer: number | null = null;
    let revisionPollTimer: number | null = null;
    let healthState = createRealtimeHealthState(Date.now());

    const query = `publicId=${encodeURIComponent(publicId)}`;
    const eventSource = new EventSource(`/api/realtime/contact?${query}`);

    function markSyncSuccess() {
      healthState = recordRealtimeSuccess(healthState, Date.now());
      setHasSyncWarning(false);
    }

    function markSyncFailure() {
      healthState = recordRealtimeFailure(healthState);
      setHasSyncWarning(shouldShowRealtimeWarning(healthState, Date.now()));
    }

    function applyRemoteChange() {
      if (hasDirtyForms()) {
        setHasPendingChange(true);
        return;
      }

      setHasPendingChange(false);

      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, REMOTE_REFRESH_DEBOUNCE_MS);
    }

    function processChange(payload: ContactChangePayload) {
      if (payload.publicId !== publicId) return;

      const decision = decideContactRealtimeChange({
        currentRevision: lastRevisionRef.current,
        nextRevision: payload.revision,
        actorClientId: payload.actorClientId,
        currentClientId: clientIdRef.current
      });

      if (decision === "invalid" || decision === "stale") return;

      lastRevisionRef.current = payload.revision;
      if (decision === "self") {
        setHasPendingChange(false);
        return;
      }

      applyRemoteChange();
    }

    async function fetchRevision() {
      try {
        const response = await fetch(`/api/realtime/contact/revision?${query}`, {
          cache: "no-store"
        });
        if (!response.ok) return { ok: false as const };

        const payload = (await response.json()) as ContactRevisionPayload;
        return payload.publicId === publicId && /^\d+$/.test(payload.revision)
          ? { ok: true as const, payload }
          : { ok: false as const };
      } catch {
        return { ok: false as const };
      }
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
        const result = await fetchRevision();
        if (!isMounted) return;

        if (!result.ok) {
          markSyncFailure();
          return;
        }

        markSyncSuccess();
        processChange(result.payload);
      } finally {
        isRevisionCheckInFlight = false;
        if (scheduleNext) scheduleRevisionCheck();
      }
    }

    function handleContactChange(event: MessageEvent<string>) {
      try {
        const payload = JSON.parse(event.data) as ContactChangePayload;
        markSyncSuccess();
        processChange(payload);
      } catch {
        // Ignore malformed process-local events; the DB revision poll remains authoritative.
      }
    }

    void checkRevision(true);

    const handleEventSourceReady = () => markSyncSuccess();
    const handleEventSourceError = () => markSyncFailure();
    const handleWindowFocus = () => void checkRevision(false);
    window.addEventListener("focus", handleWindowFocus);
    eventSource.addEventListener("contact-change", handleContactChange);
    eventSource.addEventListener("ready", handleEventSourceReady);
    eventSource.addEventListener("error", handleEventSourceError);

    return () => {
      isMounted = false;
      if (revisionPollTimer !== null) window.clearTimeout(revisionPollTimer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", handleWindowFocus);
      eventSource.removeEventListener("contact-change", handleContactChange);
      eventSource.removeEventListener("ready", handleEventSourceReady);
      eventSource.removeEventListener("error", handleEventSourceError);
      eventSource.close();
    };
  }, [initialRevision, publicId, router]);

  function handleRefresh() {
    setHasPendingChange(false);
    router.refresh();
  }

  if (!hasPendingChange && !hasSyncWarning) return null;

  return (
    <>
      {hasSyncWarning ? (
        <div
          className="fixed left-4 right-4 top-4 z-50 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-lg shadow-slate-300/40 sm:left-auto sm:max-w-sm"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">同期が停止しています。</p>
              <p className="mt-1 text-red-700">
                最新情報を取得できていません。入力内容は保持したまま自動で再接続します。
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {hasPendingChange ? (
        <div className="fixed bottom-4 left-4 right-4 z-50 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-lg shadow-slate-300/40 sm:left-auto sm:max-w-sm">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">お問い合わせが更新されました。</p>
              <p className="mt-1 text-amber-800">
                入力中の内容を守るため、自動更新を保留しています。
              </p>
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
