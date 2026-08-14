"use client";

import Link from "next/link";
import { Check, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { acceptHouseholdInvitation, getHouseholdInvitationPreview } from "@/app/actions/members";
import { getInvitationTokenFromHash, type HouseholdInvitationPreview } from "@/lib/invitations";

const INVITATION_TOKEN_STORAGE_KEY = "dog-cat-manager-invitation-token";

function readStoredInvitationToken() {
  try {
    const token = window.sessionStorage.getItem(INVITATION_TOKEN_STORAGE_KEY);
    return token ? getInvitationTokenFromHash(`#token=${token}`) : null;
  } catch {
    return null;
  }
}

function storeInvitationToken(token: string) {
  try {
    window.sessionStorage.setItem(INVITATION_TOKEN_STORAGE_KEY, token);
  } catch {
    // 制限付きブラウザではOAuth往復後に保持できないため、同じリンクを再度開いてもらう。
  }
}

function clearStoredInvitationToken() {
  try {
    window.sessionStorage.removeItem(INVITATION_TOKEN_STORAGE_KEY);
  } catch {
    // 保存できていない場合は後片付けも不要。
  }
}

function AcceptInvitationButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-wait disabled:opacity-60"
    >
      <Check className="h-4 w-4" aria-hidden />
      {pending ? "参加中..." : "この共有に参加する"}
    </button>
  );
}

function InvitedHouseholdName({ preview }: { preview: HouseholdInvitationPreview }) {
  if (preview.status !== "available") {
    return null;
  }

  return (
    <div className="rounded-md border border-moss/30 bg-moss/10 px-4 py-3">
      <p className="text-xs font-semibold text-moss">招待された共有グループ</p>
      <p className="mt-1 break-words text-lg font-bold text-ink [overflow-wrap:anywhere]">
        {preview.householdName}
      </p>
    </div>
  );
}

export function InvitationAcceptForm({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<HouseholdInvitationPreview | undefined>(undefined);

  useEffect(() => {
    const hashToken = getInvitationTokenFromHash(window.location.hash);
    const storedToken = readStoredInvitationToken();
    const invitationToken = hashToken ?? storedToken;

    if (hashToken && !isLoggedIn) {
      storeInvitationToken(hashToken);
    }
    if (isLoggedIn) {
      clearStoredInvitationToken();
    }

    const updateTimer = window.setTimeout(() => setToken(invitationToken), 0);

    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }

    return () => window.clearTimeout(updateTimer);
  }, [isLoggedIn]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let isActive = true;
    void getHouseholdInvitationPreview(token)
      .then((result) => {
        if (isActive) setPreview(result);
      })
      .catch(() => {
        if (isActive) setPreview({ status: "error" });
      });

    return () => {
      isActive = false;
    };
  }, [token]);

  if (token === undefined) {
    return <p className="text-sm text-slate-600">招待リンクを確認しています...</p>;
  }

  if (!token) {
    return (
      <div className="space-y-4 text-sm text-slate-600">
        <div className="flex items-start gap-2">
          <XCircle className="mt-0.5 h-4 w-4 text-red-600" aria-hidden />
          <p>招待トークンが見つかりません。</p>
        </div>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ダッシュボードへ戻る
        </Link>
      </div>
    );
  }

  if (preview === undefined) {
    return <p className="text-sm text-slate-600">招待先の共有グループを確認しています...</p>;
  }

  if (!isLoggedIn) {
    return (
      <div className="space-y-4 text-sm text-slate-600">
        <InvitedHouseholdName preview={preview} />
        <p>招待を受けるGoogleアカウントでログインしてください。招待トークンはこのタブ内だけに一時保存されます。</p>
        <Link
          href="/login?callbackUrl=%2Finvitations%2Faccept"
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-moss/90"
        >
          Googleアカウントでログイン
        </Link>
      </div>
    );
  }

  return (
    <form action={acceptHouseholdInvitation} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <InvitedHouseholdName preview={preview} />
      <p className="text-sm leading-6 text-slate-600">
        参加すると、同じ共有内のPetと体重・お世話・健康などの記録を共有できます。
      </p>
      <AcceptInvitationButton />
    </form>
  );
}
