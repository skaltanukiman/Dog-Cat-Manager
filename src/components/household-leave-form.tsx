"use client";

import type { HouseholdRole } from "@prisma/client";
import { ArrowRight, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { leaveCurrentHousehold } from "@/app/actions/members";
import { HOUSEHOLD_ROLE_LABELS } from "@/lib/authorization";

export type HouseholdLeaveCandidate = {
  userId: string;
  name: string;
  email: string;
  role: HouseholdRole;
};

function LeaveSubmitButton({ canSubmit, requiresTransfer }: { canSubmit: boolean; requiresTransfer: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={!canSubmit || pending}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
    >
      {requiresTransfer ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />}
      {pending
        ? "処理中..."
        : requiresTransfer
          ? "所有権を移譲して退出する"
          : "この共有グループから退出する"}
    </button>
  );
}

export function HouseholdLeaveForm({
  householdId,
  householdName,
  requiresTransfer,
  candidates
}: {
  householdId: string;
  householdName: string;
  requiresTransfer: boolean;
  candidates: HouseholdLeaveCandidate[];
}) {
  const [transferToUserId, setTransferToUserId] = useState("");
  const [acknowledgements, setAcknowledgements] = useState({
    accessLoss: false,
    dataRetention: false,
    newInvitation: false
  });
  const selectedCandidate = candidates.find((candidate) => candidate.userId === transferToUserId);
  const allAcknowledged = Object.values(acknowledgements).every(Boolean);
  const canSubmit = allAcknowledged && (!requiresTransfer || Boolean(selectedCandidate));

  return (
    <form action={leaveCurrentHousehold} className="space-y-6">
      <input type="hidden" name="householdId" value={householdId} />

      {requiresTransfer ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <h2 className="text-base font-bold text-amber-950">退出するには、新しいオーナーを選択してください</h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            あなたは現在、このグループで唯一のオーナーです。グループを残して退出するには、ほかのメンバーへ
            オーナー権限を移譲する必要があります。
          </p>

          <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="transferToUserId">
            新しいオーナー
          </label>
          <select
            id="transferToUserId"
            name="transferToUserId"
            value={transferToUserId}
            onChange={(event) => setTransferToUserId(event.target.value)}
            required
            className="mt-2 w-full"
          >
            <option value="">選択してください</option>
            {candidates.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.name} / {candidate.email} / 現在: {HOUSEHOLD_ROLE_LABELS[candidate.role]} → オーナー
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-5 text-amber-800">
            閲覧者を含むどの候補を選んだ場合も、退出処理の中でオーナーへ昇格します。
          </p>

          {selectedCandidate ? (
            <div className="mt-4 rounded-md border border-amber-200 bg-white p-4 text-sm">
              <p className="font-semibold text-ink">移譲先の最終確認</p>
              <div className="mt-2 flex flex-col gap-2 text-slate-700 sm:flex-row sm:flex-wrap sm:items-center">
                <span>{selectedCandidate.name}</span>
                <span className="break-all text-slate-500">{selectedCandidate.email}</span>
                <span className="inline-flex items-center gap-1 font-semibold text-amber-900">
                  {HOUSEHOLD_ROLE_LABELS[selectedCandidate.role]}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  オーナー
                </span>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-bold text-ink">最終確認</h2>
        <p className="mt-1 text-sm text-slate-600">{householdName} から退出する前に、以下をすべて確認してください。</p>
        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-700">
            <input
              type="checkbox"
              name="acknowledgeAccessLoss"
              value="confirmed"
              checked={acknowledgements.accessLoss}
              onChange={(event) =>
                setAcknowledgements((current) => ({ ...current, accessLoss: event.target.checked }))
              }
              required
              className="mt-1 shrink-0"
            />
            退出後、このグループへアクセスできなくなることを確認しました
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-700">
            <input
              type="checkbox"
              name="acknowledgeDataRetention"
              value="confirmed"
              checked={acknowledgements.dataRetention}
              onChange={(event) =>
                setAcknowledgements((current) => ({ ...current, dataRetention: event.target.checked }))
              }
              required
              className="mt-1 shrink-0"
            />
            グループ内のPetや共有記録は削除されず、ほかのメンバーに残ることを確認しました
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-700">
            <input
              type="checkbox"
              name="acknowledgeNewInvitation"
              value="confirmed"
              checked={acknowledgements.newInvitation}
              onChange={(event) =>
                setAcknowledgements((current) => ({ ...current, newInvitation: event.target.checked }))
              }
              required
              className="mt-1 shrink-0"
            />
            再参加するには、現在のメンバーから新しい招待を受ける必要があることを確認しました
          </label>
        </div>
      </section>

      <div className="flex justify-end">
        <LeaveSubmitButton canSubmit={canSubmit} requiresTransfer={requiresTransfer} />
      </div>
    </form>
  );
}
