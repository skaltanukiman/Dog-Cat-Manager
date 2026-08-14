"use client";

import type { HouseholdRole } from "@prisma/client";
import { AlertTriangle, LogOut, ShieldCheck, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { deleteCurrentUserAccount } from "@/app/actions/account";
import {
  ACCOUNT_DELETE_CONFIRMATION,
  requiresAccountDeleteAttention,
  type AccountDeleteDisposition
} from "@/lib/account-delete-shared";
import { HOUSEHOLD_ROLE_LABELS } from "@/lib/authorization";

type AccountDeleteFormHousehold = {
  householdId: string;
  householdName: string;
  currentRole: HouseholdRole;
  memberCount: number;
  disposition: AccountDeleteDisposition;
  transferCandidates: Array<{
    userId: string;
    name: string | null;
    email: string | null;
    role: HouseholdRole;
  }>;
};

const DISPOSITION_PRESENTATION = {
  deleteHousehold: {
    label: "グループごと削除",
    description: "このグループ内のPet、記録、画像も削除されます。",
    icon: Trash2,
    iconClassName: "bg-red-50 text-red-700",
    badgeClassName: "border-red-200 bg-red-50 text-red-700"
  },
  leaveHousehold: {
    label: "グループから退出",
    description: "共有データは残り、あなたの参加情報だけが削除されます。",
    icon: LogOut,
    iconClassName: "bg-slate-100 text-slate-600",
    badgeClassName: "border-slate-200 bg-slate-100 text-slate-700"
  },
  transferOwnership: {
    label: "オーナー移譲が必要",
    description: "新しいオーナーを選択すると、共有データを残したまま退出します。",
    icon: ShieldCheck,
    iconClassName: "bg-amber-50 text-amber-700",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-800"
  },
  blocked: {
    label: "現在は削除できません",
    description:
      "グループの状態が変更されている可能性があります。画面を再読み込みして最新の状態を確認してください。",
    icon: AlertTriangle,
    iconClassName: "bg-amber-50 text-amber-700",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-800"
  }
} satisfies Record<
  AccountDeleteDisposition,
  {
    label: string;
    description: string;
    icon: typeof Trash2;
    iconClassName: string;
    badgeClassName: string;
  }
>;

const SUMMARY_ITEMS = [
  {
    key: "deleteHousehold",
    label: "グループごと削除",
    className: "border-red-100 bg-red-50/60 text-red-800"
  },
  {
    key: "leaveHousehold",
    label: "グループから退出",
    className: "border-slate-200 bg-slate-50 text-slate-700"
  },
  {
    key: "transferOwnership",
    label: "オーナー移譲が必要",
    className: "border-amber-100 bg-amber-50/70 text-amber-900"
  }
] as const;

function candidateLabel(candidate: AccountDeleteFormHousehold["transferCandidates"][number]) {
  return candidate.name || candidate.email || "名前未設定";
}

function candidateOptionLabel(
  candidate: AccountDeleteFormHousehold["transferCandidates"][number]
) {
  return `${candidateLabel(candidate)}（現在：${HOUSEHOLD_ROLE_LABELS[candidate.role]}）`;
}

function AccountDeleteSubmitButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={!enabled || pending}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-red-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
    >
      <Trash2 className="h-4 w-4" aria-hidden />
      {pending ? "アカウントを削除中..." : "アカウントを完全に削除する"}
    </button>
  );
}

export function AccountDeleteForm({
  expectedStateToken,
  households,
  deletionBlocked
}: {
  expectedStateToken: string;
  households: AccountDeleteFormHousehold[];
  deletionBlocked: boolean;
}) {
  const [confirmationText, setConfirmationText] = useState("");
  const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
  const [showOnlyAttentionRequired, setShowOnlyAttentionRequired] = useState(false);
  const transferHouseholds = households.filter(
    (household) => household.disposition === "transferOwnership"
  );
  const attentionRequiredHouseholds = households.filter((household) =>
    requiresAccountDeleteAttention(household.disposition)
  );
  const attentionRequiredCount = attentionRequiredHouseholds.length;
  const showAttentionFilter =
    attentionRequiredCount > 0 && attentionRequiredCount < households.length;
  const visibleHouseholds = showOnlyAttentionRequired ? attentionRequiredHouseholds : households;
  const deleteHouseholdCount = households.filter(
    (household) => household.disposition === "deleteHousehold"
  ).length;
  const leaveHouseholdCount = households.filter(
    (household) =>
      household.disposition === "leaveHousehold" || household.disposition === "transferOwnership"
  ).length;
  const summaryCounts = {
    deleteHousehold: deleteHouseholdCount,
    leaveHousehold: leaveHouseholdCount,
    transferOwnership: transferHouseholds.length
  };
  const allTransfersSelected = transferHouseholds.every(
    (household) => Boolean(transferTargets[household.householdId])
  );
  const canSubmit =
    !deletionBlocked && allTransfersSelected && confirmationText === ACCOUNT_DELETE_CONFIRMATION;

  return (
    <form action={deleteCurrentUserAccount} className="space-y-6">
      <input type="hidden" name="expectedStateToken" value={expectedStateToken} />

      <section aria-labelledby="account-delete-summary-heading" className="space-y-3">
        <h2 id="account-delete-summary-heading" className="text-base font-bold text-ink">
          削除内容の確認
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SUMMARY_ITEMS.map((item) => (
            <div
              key={item.key}
              className={`flex min-w-0 items-center justify-between gap-3 rounded-md border px-4 py-3 ${item.className}`}
            >
              <span className="text-sm font-semibold">{item.label}</span>
              <span className="shrink-0 text-lg font-bold tabular-nums">
                {summaryCounts[item.key]}件
              </span>
            </div>
          ))}
        </div>
        {transferHouseholds.length > 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            アカウントを削除するには、{transferHouseholds.length}
            件のグループで新しいオーナーを選択してください。
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-bold text-ink">共有グループごとの扱い</h2>
        {households.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            現在所属している共有グループはありません。アカウントと認証情報だけが削除されます。
          </div>
        ) : (
          <>
            {showAttentionFilter ? (
              <label
                htmlFor="account-delete-attention-filter"
                className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 hover:bg-slate-100"
              >
                <input
                  id="account-delete-attention-filter"
                  type="checkbox"
                  checked={showOnlyAttentionRequired}
                  onChange={(event) => setShowOnlyAttentionRequired(event.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">
                    対応が必要なグループのみ表示（{attentionRequiredCount}件）
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                    オーナー移譲や確認が必要なグループを表示します
                  </span>
                </span>
              </label>
            ) : null}
            {visibleHouseholds.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
                対応が必要な共有グループはありません。
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {visibleHouseholds.map((household) => {
              const isTransfer = household.disposition === "transferOwnership";
              const isBlocked = household.disposition === "blocked";
              const presentation = DISPOSITION_PRESENTATION[household.disposition];
              const DispositionIcon = presentation.icon;
              const selectedTarget = household.transferCandidates.find(
                (candidate) => candidate.userId === transferTargets[household.householdId]
              );

              return (
                <article
                  key={household.householdId}
                  className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${presentation.iconClassName}`}
                    >
                      <DispositionIcon className="h-4.5 w-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words font-bold leading-6 text-ink">
                        {household.householdName}
                      </h3>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1">
                          <Users className="h-3.5 w-3.5" aria-hidden />
                          {household.memberCount}人
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-medium text-slate-600">
                          {HOUSEHOLD_ROLE_LABELS[household.currentRole]}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4" role={isBlocked ? "alert" : undefined}>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${presentation.badgeClassName}`}
                    >
                      {presentation.label}
                    </span>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {presentation.description}
                    </p>
                  </div>

                  {isTransfer ? (
                    <div className="mt-4">
                      <label
                        htmlFor={`account-transfer-${household.householdId}`}
                        className="block text-sm font-semibold text-ink"
                      >
                        新しいオーナーを選択
                      </label>
                      <select
                        id={`account-transfer-${household.householdId}`}
                        name={`transferToUserId:${household.householdId}`}
                        value={transferTargets[household.householdId] ?? ""}
                        onChange={(event) =>
                          setTransferTargets((current) => ({
                            ...current,
                            [household.householdId]: event.target.value
                          }))
                        }
                        required
                        className="mt-2 min-h-11 w-full max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
                      >
                        <option value="">選択してください</option>
                        {household.transferCandidates.map((candidate) => (
                          <option key={candidate.userId} value={candidate.userId}>
                            {candidateOptionLabel(candidate)}
                          </option>
                        ))}
                      </select>
                      {selectedTarget ? (
                        <p className="mt-3 text-xs font-semibold leading-5 text-amber-900">
                          {selectedTarget.name
                            ? `${selectedTarget.name}さんへ所有権を移譲します。`
                            : "選択したメンバーへ所有権を移譲します。"}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-md border border-red-200 bg-white p-4 text-sm leading-7 text-slate-700 shadow-sm sm:p-5">
        <h2 className="text-base font-bold text-red-800">削除前に確認してください</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 marker:text-red-500">
          <li>この操作は取り消せません。</li>
          <li>単独で管理しているグループと、その中のPet・記録・画像も削除されます。</li>
          <li>ほかのメンバーがいる共有グループと共有データは残ります。</li>
          <li>削除後はログアウトされ、現在のアカウントと保存データにはアクセスできなくなります。</li>
        </ul>

        <label
          className="mt-5 block font-semibold text-ink"
          htmlFor="account-delete-confirmation"
        >
          確認のため、以下の文字を入力してください
        </label>
        <code className="mt-2 inline-flex select-all rounded-md border border-red-200 bg-red-50 px-3 py-1.5 font-mono text-sm font-bold text-red-800">
          {ACCOUNT_DELETE_CONFIRMATION}
        </code>
        <input
          id="account-delete-confirmation"
          name="confirmationText"
          value={confirmationText}
          onChange={(event) => setConfirmationText(event.target.value)}
          autoComplete="off"
          placeholder={ACCOUNT_DELETE_CONFIRMATION}
          aria-describedby="account-delete-confirmation-help"
          disabled={deletionBlocked}
          required
          className="mt-3 min-h-11 w-full border-red-300 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        <p id="account-delete-confirmation-help" className="mt-2 text-xs text-slate-600">
          {deletionBlocked
            ? "現在は削除手続きを続行できません。上の案内を確認してください。"
            : "表示されている文字と完全に一致した場合のみ削除できます。"}
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/settings"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:w-auto"
        >
          削除をやめる
        </Link>
        <AccountDeleteSubmitButton enabled={canSubmit} />
      </div>
    </form>
  );
}
