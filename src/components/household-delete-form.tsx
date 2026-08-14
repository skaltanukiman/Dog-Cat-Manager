"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { deleteCurrentHousehold } from "@/app/actions/members";

function DeleteSubmitButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={!enabled || pending}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
    >
      <Trash2 className="h-4 w-4" aria-hidden />
      {pending ? "削除中..." : "共有グループを完全に削除する"}
    </button>
  );
}

export function HouseholdDeleteForm({
  householdId,
  householdName
}: {
  householdId: string;
  householdName: string;
}) {
  const [confirmationName, setConfirmationName] = useState("");
  const [acknowledgements, setAcknowledgements] = useState({
    data: false,
    images: false,
    irreversible: false
  });
  const allAcknowledged = Object.values(acknowledgements).every(Boolean);
  const canSubmit = allAcknowledged && confirmationName === householdName;

  return (
    <form action={deleteCurrentHousehold} className="space-y-6">
      <input type="hidden" name="householdId" value={householdId} />

      <section className="rounded-md border border-red-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-bold text-ink">最終確認</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          この操作は取り消せません。以下をすべて確認してください。
        </p>
        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-700">
            <input
              type="checkbox"
              name="acknowledgeHouseholdDataDeletion"
              value="confirmed"
              checked={acknowledgements.data}
              onChange={(event) =>
                setAcknowledgements((current) => ({ ...current, data: event.target.checked }))
              }
              required
              className="mt-1 shrink-0"
            />
            共有グループ内のPetとすべての記録が削除されることを確認しました
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-700">
            <input
              type="checkbox"
              name="acknowledgeImageDeletion"
              value="confirmed"
              checked={acknowledgements.images}
              onChange={(event) =>
                setAcknowledgements((current) => ({ ...current, images: event.target.checked }))
              }
              required
              className="mt-1 shrink-0"
            />
            保存されている画像も完全に削除されることを確認しました
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-700">
            <input
              type="checkbox"
              name="acknowledgeIrreversibleDeletion"
              value="confirmed"
              checked={acknowledgements.irreversible}
              onChange={(event) =>
                setAcknowledgements((current) => ({ ...current, irreversible: event.target.checked }))
              }
              required
              className="mt-1 shrink-0"
            />
            この操作は取り消せないことを確認しました
          </label>
        </div>

        <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="household-delete-name">
          確認のため「{householdName}」と入力してください
        </label>
        <input
          id="household-delete-name"
          name="confirmationName"
          value={confirmationName}
          onChange={(event) => setConfirmationName(event.target.value)}
          autoComplete="off"
          required
          aria-describedby="household-delete-name-help"
          className="mt-2 w-full"
        />
        <p id="household-delete-name-help" className="mt-2 text-xs leading-5 text-slate-500">
          共有グループ名と完全に一致するように入力してください。
        </p>
      </section>

      <div className="flex justify-end">
        <DeleteSubmitButton enabled={canSubmit} />
      </div>
    </form>
  );
}
