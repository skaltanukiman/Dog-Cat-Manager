"use client";

import { Save, Trash2 } from "lucide-react";
import type { FormEvent } from "react";

import { deletePetWeightRecord, updatePetWeightRecord } from "@/app/actions/pet-weights";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { MAX_PET_WEIGHT_KG, PET_WEIGHT_MEMO_MAX_LENGTH } from "@/lib/pet-weight-rules";

type PetWeightHistoryRecord = {
  id: string;
  recordDate: string;
  weightKg: number;
  memo: string | null;
};

export function PetWeightHistoryList({
  records,
  selectedPetId,
  today,
  currentPage,
  includeInactive,
  readOnly
}: {
  records: PetWeightHistoryRecord[];
  selectedPetId: string;
  today: string;
  currentPage: number;
  includeInactive: boolean;
  readOnly: boolean;
}) {
  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("この体重記録を削除します。本当によろしいですか？")) event.preventDefault();
  }

  return (
    <div className="grid gap-3">
      {records.map((record) => (
        <article key={record.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          {readOnly ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-[160px_140px_1fr]">
              <div><dt className="font-medium text-slate-500">測定日</dt><dd className="mt-1 text-slate-800">{record.recordDate}</dd></div>
              <div><dt className="font-medium text-slate-500">体重</dt><dd className="mt-1 text-slate-800">{record.weightKg}kg</dd></div>
              <div><dt className="font-medium text-slate-500">メモ</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{record.memo || "—"}</dd></div>
            </dl>
          ) : (
            <>
              <form
                key={`${record.id}:${record.recordDate}:${record.weightKg}:${record.memo ?? ""}`}
                action={updatePetWeightRecord}
                data-dirty-watch
                className="grid gap-3 lg:grid-cols-[170px_150px_1fr_auto]"
              >
                <input type="hidden" name="id" value={record.id} />
                <input type="hidden" name="petId" value={selectedPetId} />
                <input type="hidden" name="page" value={currentPage} />
                {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  測定日
                  <input className="!h-10 !min-h-10" type="date" name="recordDate" defaultValue={record.recordDate} max={today} required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  体重(kg)
                  <input className="h-10" type="number" name="weightKg" min="0.01" max={MAX_PET_WEIGHT_KG} step="0.01" defaultValue={record.weightKg} required />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  メモ
                  <textarea className="!h-16 !min-h-16" name="memo" maxLength={PET_WEIGHT_MEMO_MAX_LENGTH} rows={1} defaultValue={record.memo ?? ""} />
                </label>
                <DirtySubmitButton className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md border border-brand px-4 text-sm font-semibold text-brand hover:bg-brand-dark hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">
                  <Save className="h-4 w-4" aria-hidden />
                  保存
                </DirtySubmitButton>
              </form>
              <form action={deletePetWeightRecord} onSubmit={confirmDelete} className="mt-3 flex justify-end">
                <input type="hidden" name="id" value={record.id} />
                <input type="hidden" name="petId" value={selectedPetId} />
                <input type="hidden" name="page" value={currentPage} />
                {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
                <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" aria-hidden />
                  削除
                </button>
              </form>
            </>
          )}
        </article>
      ))}
    </div>
  );
}
