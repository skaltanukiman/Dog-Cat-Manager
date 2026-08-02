"use client";

import { HeartPulse, ImagePlus, Stethoscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import {
  createHealthRecord,
  createMedicalRecord,
  createMemoryRecord,
  type RecordCreateActionResult
} from "@/app/actions/records";
import { RecordImageField } from "@/components/record-image-field";
import { MemoryHamsterSelector } from "@/components/memory-hamster-selector";
import { MemoryTagInput } from "@/components/memory-tag-input";
import { RecordTimeInput } from "@/components/record-time-input";
import { AutoDismissSuccessMessage } from "@/components/status-message";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import {
  HEALTH_AMOUNT_CONDITIONS,
  HEALTH_EXCRETION_CONDITIONS,
  HEALTH_OVERALL_CONDITIONS,
  HEALTH_SYMPTOMS
} from "@/lib/record-schemas";
import {
  HEALTH_AMOUNT_LABELS,
  HEALTH_EXCRETION_LABELS,
  HEALTH_OVERALL_LABELS,
  HEALTH_SYMPTOM_LABELS,
  recordCreateKindForHamsterStatus,
  type RecordCreateKind
} from "@/lib/records";

const fieldClass = "grid gap-1 text-sm font-medium text-slate-700";
// 初期値と同じ正常状態へ戻す操作。再利用できるよう実装を残し、現在は画面に表示しない。
const SHOW_USUAL_CONDITION_CONTROL = false;

type CreateAction = (formData: FormData) => Promise<RecordCreateActionResult>;
type CreateError = Extract<RecordCreateActionResult, { success: false }>;

function RecordCreateError({ error }: { error?: CreateError }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{error.errorMessage}</p>
      {error.errorId ? <p className="mt-1 break-all text-xs">エラーID: {error.errorId}</p> : null}
    </div>
  );
}

export function RecordCreateForms({ hamsterId, hamsterIsActive, hamsters, today, savedMemoryTags }: { hamsterId: string; hamsterIsActive: boolean; hamsters: Array<{ id: string; name: string; isActive: boolean }>; today: string; savedMemoryTags: string[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<RecordCreateKind>(recordCreateKindForHamsterStatus("health", hamsterIsActive));
  const [previousHamsterIsActive, setPreviousHamsterIsActive] = useState(hamsterIsActive);
  const healthFormRef = useRef<HTMLFormElement>(null);
  const [pendingKind, setPendingKind] = useState<RecordCreateKind | null>(null);
  const [submitErrors, setSubmitErrors] = useState<Partial<Record<RecordCreateKind, CreateError>>>({});
  const [submitSuccesses, setSubmitSuccesses] = useState<Partial<Record<RecordCreateKind, boolean>>>({});
  const [formVersions, setFormVersions] = useState<Record<RecordCreateKind, number>>({ health: 0, medical: 0, memory: 0 });
  const [, startTransition] = useTransition();

  if (previousHamsterIsActive !== hamsterIsActive) {
    setPreviousHamsterIsActive(hamsterIsActive);
    if (!hamsterIsActive) {
      setKind((currentKind) => recordCreateKindForHamsterStatus(currentKind, hamsterIsActive));
    }
  }

  function submitRecord(recordKind: RecordCreateKind, action: CreateAction) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      setSubmitErrors((current) => ({ ...current, [recordKind]: undefined }));
      setSubmitSuccesses((current) => ({ ...current, [recordKind]: false }));
      setPendingKind(recordKind);
      startTransition(async () => {
        const result = await action(new FormData(form));
        if (result.success) {
          setSubmitSuccesses((current) => ({ ...current, [recordKind]: true }));
          setFormVersions((current) => ({ ...current, [recordKind]: current[recordKind] + 1 }));
          router.refresh();
        } else {
          setSubmitErrors((current) => ({ ...current, [recordKind]: result }));
        }
        setPendingKind(null);
      });
    };
  }

  function setUsualCondition() {
    const form = healthFormRef.current;
    if (!form) return;
    const values: Record<string, string> = {
      overallCondition: "GOOD",
      appetite: "NORMAL",
      activityLevel: "NORMAL",
      stoolCondition: "NORMAL",
      urineCondition: "NORMAL"
    };
    for (const [name, value] of Object.entries(values)) {
      const input = form.elements.namedItem(name);
      if (input instanceof HTMLSelectElement) {
        input.value = value;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  return (
    <UnsavedChangesGuard>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <fieldset className="sm:hidden">
          <legend className="mb-2 text-xs font-semibold text-slate-600">記録の種類</legend>
          <div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1" aria-label="登録する記録種類">
            <button
              type="button"
              onClick={() => setKind("health")}
              disabled={!hamsterIsActive}
              aria-pressed={kind === "health"}
              className={`flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                kind === "health" ? "bg-moss/10 font-semibold text-moss ring-1 ring-inset ring-moss/20" : "text-slate-600 hover:bg-white/70 hover:text-ink"
              }`}
            >
              体調
            </button>
            <button
              type="button"
              onClick={() => setKind("medical")}
              disabled={!hamsterIsActive}
              aria-pressed={kind === "medical"}
              className={`flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                kind === "medical" ? "bg-moss/10 font-semibold text-moss ring-1 ring-inset ring-moss/20" : "text-slate-600 hover:bg-white/70 hover:text-ink"
              }`}
            >
              通院
            </button>
            <button
              type="button"
              onClick={() => setKind("memory")}
              aria-pressed={kind === "memory"}
              className={`flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-1 ${
                kind === "memory" ? "bg-moss/10 font-semibold text-moss ring-1 ring-inset ring-moss/20" : "text-slate-600 hover:bg-white/70 hover:text-ink"
              }`}
            >
              思い出
            </button>
          </div>
        </fieldset>

        <div className="hidden flex-wrap gap-2 sm:flex" aria-label="登録する記録種類">
          <button type="button" onClick={() => setKind("health")} disabled={!hamsterIsActive} className={`inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold ${kind === "health" ? "border-moss bg-moss text-white" : "border-slate-200 text-slate-700"} disabled:cursor-not-allowed disabled:opacity-50`}>
            <HeartPulse className="h-4 w-4" aria-hidden />体調を記録
          </button>
          <button type="button" onClick={() => setKind("medical")} disabled={!hamsterIsActive} className={`inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold ${kind === "medical" ? "border-moss bg-moss text-white" : "border-slate-200 text-slate-700"} disabled:cursor-not-allowed disabled:opacity-50`}>
            <Stethoscope className="h-4 w-4" aria-hidden />通院を記録
          </button>
          <button type="button" onClick={() => setKind("memory")} className={`inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold ${kind === "memory" ? "border-moss bg-moss text-white" : "border-slate-200 text-slate-700"}`}>
            <ImagePlus className="h-4 w-4" aria-hidden />思い出を追加
          </button>
        </div>
        {!hamsterIsActive ? <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">管理外のハムスターには体調・通院記録を追加できません。思い出記録は追加できます。</p> : null}

        {hamsterIsActive ? (
          <div className={kind === "health" ? "" : "hidden"}>
          <form key={formVersions.health} ref={healthFormRef} onSubmit={submitRecord("health", createHealthRecord)} data-dirty-watch className="mt-5 grid gap-4">
            <input type="hidden" name="hamsterId" value={hamsterId} />
            <RecordCreateError error={submitErrors.health} />
            {submitSuccesses.health ? <AutoDismissSuccessMessage message="記録を登録しました。" /> : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className={`${fieldClass} sm:w-56`}>記録日<input type="date" name="recordDate" defaultValue={today} max={today} required /></label>
                <RecordTimeInput />
              </div>
              {SHOW_USUAL_CONDITION_CONTROL ? <button type="button" onClick={setUsualCondition} className="inline-flex h-10 items-center justify-center rounded-md border border-moss px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white">いつも通りに設定</button> : null}
            </div>
            {SHOW_USUAL_CONDITION_CONTROL ? <p className="text-xs text-slate-500">「いつも通り」は5つの状態だけを正常値へ設定します。症状とメモは消去しません。</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className={fieldClass}>総合状態<select name="overallCondition" defaultValue="GOOD">{HEALTH_OVERALL_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_OVERALL_LABELS[value]}</option>)}</select></label>
              <label className={fieldClass}>食欲<select name="appetite" defaultValue="NORMAL">{HEALTH_AMOUNT_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_AMOUNT_LABELS[value]}</option>)}</select></label>
              <label className={fieldClass}>活動量<select name="activityLevel" defaultValue="NORMAL">{HEALTH_AMOUNT_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_AMOUNT_LABELS[value]}</option>)}</select></label>
              <label className={fieldClass}>便<select name="stoolCondition" defaultValue="NORMAL">{HEALTH_EXCRETION_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_EXCRETION_LABELS[value]}</option>)}</select></label>
              <label className={fieldClass}>尿<select name="urineCondition" defaultValue="NORMAL">{HEALTH_EXCRETION_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_EXCRETION_LABELS[value]}</option>)}</select></label>
            </div>
            <fieldset className="grid gap-2"><legend className="text-sm font-semibold text-slate-700">気になる症状（複数選択可）</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{HEALTH_SYMPTOMS.map((symptom) => <label key={symptom} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" name="symptoms" value={symptom} />{HEALTH_SYMPTOM_LABELS[symptom]}</label>)}</div></fieldset>
            <label className={fieldClass}>メモ<textarea name="memo" maxLength={2000} placeholder="その他の症状や気になったことを入力" /></label>
            <button type="submit" disabled={pendingKind !== null} className="inline-flex h-11 items-center justify-center rounded-md bg-moss px-5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-wait disabled:opacity-60 sm:w-fit">{pendingKind === "health" ? "保存中..." : "体調記録を保存"}</button>
          </form>
          </div>
        ) : null}

        {hamsterIsActive ? (
          <div className={kind === "medical" ? "" : "hidden"}>
          <form key={formVersions.medical} onSubmit={submitRecord("medical", createMedicalRecord)} data-dirty-watch className="mt-5 grid gap-4">
            <input type="hidden" name="hamsterId" value={hamsterId} />
            <RecordCreateError error={submitErrors.medical} />
            {submitSuccesses.medical ? <AutoDismissSuccessMessage message="記録を登録しました。" /> : null}
            <div className="grid gap-3 sm:grid-cols-2"><label className={fieldClass}>通院日<input type="date" name="recordDate" defaultValue={today} max={today} required /></label><label className={fieldClass}>動物病院名（任意）<input name="hospitalName" maxLength={120} /></label></div>
            <label className={fieldClass}>通院理由・症状<textarea name="reason" maxLength={2000} required /></label>
            <div className="grid gap-3 md:grid-cols-2"><label className={fieldClass}>診断内容<textarea name="diagnosis" maxLength={2000} /></label><label className={fieldClass}>検査内容<textarea name="examination" maxLength={2000} /></label><label className={fieldClass}>処置・治療内容<textarea name="treatment" maxLength={2000} /></label><label className={fieldClass}>処方薬<textarea name="medication" maxLength={2000} /></label><label className={fieldClass}>投薬方法<textarea name="medicationInstructions" maxLength={2000} /></label><label className={fieldClass}>メモ<textarea name="memo" maxLength={2000} /></label></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className={fieldClass}>次回通院予定日（任意）<input type="date" name="nextVisitDate" /></label><label className={fieldClass}>診察費（円・整数）<input type="number" name="consultationFee" min="0" max="99999999" step="1" inputMode="numeric" /></label></div>
            <button type="submit" disabled={pendingKind !== null} className="inline-flex h-11 items-center justify-center rounded-md bg-moss px-5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-wait disabled:opacity-60 sm:w-fit">{pendingKind === "medical" ? "保存中..." : "通院記録を保存"}</button>
          </form>
          </div>
        ) : null}

        <div className={kind === "memory" ? "" : "hidden"}>
          <form key={formVersions.memory} onSubmit={submitRecord("memory", createMemoryRecord)} data-dirty-watch className="mt-5 grid gap-4">
            <input type="hidden" name="hamsterId" value={hamsterId} />
            <RecordCreateError error={submitErrors.memory} />
            {submitSuccesses.memory ? <AutoDismissSuccessMessage message="記録を登録しました。" /> : null}
            <MemoryHamsterSelector
              key={hamsterId}
              hamsters={hamsters}
              selectedIds={[hamsterId]}
              representativeId={hamsterId}
              lockRepresentative
              hasError={submitErrors.memory?.field === "hamsterIds"}
            />
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]"><label className={fieldClass}>日付<input type="date" name="recordDate" defaultValue={today} max={today} required /></label><label className={fieldClass}>タイトル<input name="title" maxLength={100} required placeholder="初めて手の上で寝てくれた" /></label></div>
            <label className={fieldClass}>内容<textarea name="content" maxLength={5000} required /></label>
            <MemoryTagInput savedTags={savedMemoryTags} />
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" name="isFavorite" value="true" />お気に入りにする</label>
            <RecordImageField />
            <button type="submit" disabled={pendingKind !== null} className="inline-flex h-11 items-center justify-center rounded-md bg-moss px-5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-wait disabled:opacity-60 sm:w-fit">{pendingKind === "memory" ? "保存中..." : "思い出を保存"}</button>
          </form>
        </div>
      </section>
    </UnsavedChangesGuard>
  );
}
