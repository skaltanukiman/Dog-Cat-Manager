"use client";

import { Check, Copy, Link as LinkIcon, Plus, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { createHouseholdInvitation, type CreateHouseholdInvitationState } from "@/app/actions/members";
import { buildInvitationUrl } from "@/lib/invitations";

const INITIAL_STATE: CreateHouseholdInvitationState = {
  inviteToken: null,
  errorCode: null,
  errorMessage: null,
  retryAfterSeconds: null
};

type Toast = {
  id: number;
  message: string;
  variant: "success" | "error";
  visible: boolean;
};

function CreateInvitationButton({
  activeLimitReached,
  activeLimitMessageId,
  cooldownRemainingSeconds,
  cooldownMessageId,
  pending
}: {
  activeLimitReached: boolean;
  activeLimitMessageId: string;
  cooldownRemainingSeconds: number;
  cooldownMessageId: string;
  pending: boolean;
}) {
  const cooldownActive = cooldownRemainingSeconds > 0;
  const disabled = pending || activeLimitReached || cooldownActive;

  return (
    <button
      type="submit"
      disabled={disabled}
      aria-describedby={activeLimitReached ? activeLimitMessageId : cooldownActive ? cooldownMessageId : undefined}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 ${
        activeLimitReached || cooldownActive ? "disabled:cursor-not-allowed" : "disabled:cursor-wait"
      }`}
    >
      <Plus className="h-4 w-4" aria-hidden />
      {pending ? "作成中..." : cooldownActive ? `あと${cooldownRemainingSeconds}秒` : "招待リンクを作成"}
    </button>
  );
}

export function HouseholdInvitationForm({
  invitationOrigin,
  ttlDays,
  activeInvitationCount,
  maxActiveInvitations
}: {
  invitationOrigin: string;
  ttlDays: number;
  activeInvitationCount: number;
  maxActiveInvitations: number;
}) {
  const [state, setState] = useState<CreateHouseholdInvitationState>(INITIAL_STATE);
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const [cooldownRemainingSeconds, setCooldownRemainingSeconds] = useState(0);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const [manualCopySucceeded, setManualCopySucceeded] = useState(false);
  const toastIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastRemovalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastAnimationFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const activeLimitReached = activeInvitationCount >= maxActiveInvitations;
  const activeLimitMessageId = "active-invitation-limit-message";
  const cooldownMessageId = "invitation-creation-cooldown-message";

  const clearToastTimers = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    if (toastRemovalTimerRef.current) {
      clearTimeout(toastRemovalTimerRef.current);
    }
    if (toastAnimationFrameRef.current) {
      cancelAnimationFrame(toastAnimationFrameRef.current);
    }
  }, []);

  const showToast = useCallback(
    (message: string, variant: Toast["variant"], duration: number) => {
      if (!isMountedRef.current) {
        return;
      }

      clearToastTimers();
      const id = ++toastIdRef.current;
      setToast({ id, message, variant, visible: false });

      toastAnimationFrameRef.current = requestAnimationFrame(() => {
        if (isMountedRef.current) {
          setToast((currentToast) =>
            currentToast?.id === id ? { ...currentToast, visible: true } : currentToast
          );
        }
      });

      toastTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) {
          return;
        }

        setToast((currentToast) =>
          currentToast?.id === id ? { ...currentToast, visible: false } : currentToast
        );
        toastRemovalTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            setToast((currentToast) => (currentToast?.id === id ? null : currentToast));
          }
        }, 200);
      }, duration);
    },
    [clearToastTimers]
  );

  const copyInvitationUrl = useCallback(async (url: string, isAutomatic: boolean) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable");
      }

      await navigator.clipboard.writeText(url);
      if (!isMountedRef.current) {
        return;
      }

      if (isAutomatic) {
        showToast("招待リンクをコピーしました", "success", 2500);
        return;
      }

      if (manualCopyTimerRef.current) {
        clearTimeout(manualCopyTimerRef.current);
      }
      setManualCopySucceeded(true);
      manualCopyTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setManualCopySucceeded(false);
        }
      }, 2000);
    } catch {
      if (isMountedRef.current) {
        showToast("コピーできませんでした。もう一度お試しください", "error", 4000);
      }
    }
  }, [showToast]);

  function formAction(formData: FormData) {
    startTransition(async () => {
      const nextState = await createHouseholdInvitation(INITIAL_STATE, formData);
      if (!isMountedRef.current) {
        return;
      }

      setState(nextState);
      if (nextState.retryAfterSeconds) {
        setCooldownEndsAt(Date.now() + nextState.retryAfterSeconds * 1000);
        setCooldownRemainingSeconds(nextState.retryAfterSeconds);
      }
      if (nextState.inviteToken) {
        const nextInviteUrl = buildInvitationUrl(invitationOrigin, nextState.inviteToken);
        setCreatedInviteUrl(nextInviteUrl);
        void copyInvitationUrl(nextInviteUrl, true);
      }
    });
  }

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      clearToastTimers();
      if (manualCopyTimerRef.current) {
        clearTimeout(manualCopyTimerRef.current);
      }
    };
  }, [clearToastTimers]);

  useEffect(() => {
    if (!cooldownEndsAt) {
      return;
    }

    const timer = setInterval(() => {
      const remainingSeconds = Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000));
      setCooldownRemainingSeconds(remainingSeconds);
      if (remainingSeconds === 0) {
        setCooldownEndsAt(null);
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownEndsAt]);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-base font-bold text-ink">招待リンク</h3>
            <p className="mt-1 text-sm text-slate-600">リンクは作成から {ttlDays} 日間だけ有効です。</p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              有効なリンク {activeInvitationCount} / {maxActiveInvitations}件
            </p>
            {activeLimitReached ? (
              <p id={activeLimitMessageId} className="mt-2 text-sm text-amber-700">
                不要な招待リンクを無効化すると、新しいリンクを作成できます。
              </p>
            ) : null}
          </div>
        </div>
        <form action={formAction}>
          <CreateInvitationButton
            activeLimitReached={activeLimitReached}
            activeLimitMessageId={activeLimitMessageId}
            cooldownRemainingSeconds={cooldownRemainingSeconds}
            cooldownMessageId={cooldownMessageId}
            pending={pending}
          />
          {cooldownRemainingSeconds > 0 ? (
            <p id={cooldownMessageId} className="mt-2 text-center text-xs text-slate-600">
              再度作成できるまで、あと約 {cooldownRemainingSeconds} 秒です。
            </p>
          ) : null}
        </form>
      </div>

      <div>
        {state.errorMessage ? (
          <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>{state.errorMessage}</p>
            {cooldownRemainingSeconds > 0 ? (
              <p className="mt-1 text-xs">再度作成できるまで、あと約 {cooldownRemainingSeconds} 秒です。</p>
            ) : null}
          </div>
        ) : null}
        {createdInviteUrl ? (
          <label className="mt-4 grid gap-1 text-sm font-medium text-slate-700">
            招待相手に共有するリンク
            <span className="flex flex-col gap-2 sm:flex-row">
              <span className="relative block min-w-0 flex-1">
                <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input readOnly value={createdInviteUrl} className="w-full pl-9" aria-label="招待リンク" />
              </span>
              <button
                type="button"
                onClick={() => void copyInvitationUrl(createdInviteUrl, false)}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {manualCopySucceeded ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {manualCopySucceeded ? "コピー済み" : "コピー"}
              </button>
            </span>
            <span className="text-xs font-normal text-slate-500">このリンクは作成直後のこの画面でのみ確認できます。</span>
          </label>
        ) : !state.errorMessage ? (
          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            招待リンクを作成すると、ここに共有用URLが表示されます。
          </p>
        ) : null}
      </div>
      {toast ? (
        <div
          role={toast.variant === "error" ? "alert" : "status"}
          aria-live={toast.variant === "error" ? "assertive" : "polite"}
          className={`pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-md border px-4 py-3 text-sm shadow-lg transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none sm:bottom-5 sm:left-auto sm:right-5 sm:w-auto sm:min-w-[20rem] sm:translate-x-0 ${
            toast.visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          } ${
            toast.variant === "success"
              ? "border-emerald-200 bg-white text-slate-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {toast.variant === "success" ? (
            <Check className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          ) : null}
          <span>{toast.message}</span>
        </div>
      ) : null}
    </section>
  );
}
