"use client";

import { HeartPulse, ImagePlus, Pill, Stethoscope, Syringe } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { createPetHealthRecord } from "@/app/actions/pet-health-records";
import { createPetMedicalRecord } from "@/app/actions/pet-medical-records";
import { createPetMedicationRecord } from "@/app/actions/pet-medication-records";
import {
  createPetMemoryRecord,
  type PetRecordCreateActionResult
} from "@/app/actions/pet-memory-records";
import { createPetVaccinationRecord } from "@/app/actions/pet-vaccination-records";
import { MemoryPetSelector } from "@/components/memory-pet-selector";
import { MemoryTagInput } from "@/components/memory-tag-input";
import { RecordImageField } from "@/components/record-image-field";
import { RecordTimeInput } from "@/components/record-time-input";
import { AutoDismissSuccessMessage } from "@/components/status-message";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import {
  PET_HEALTH_AMOUNT_CONDITIONS as HEALTH_AMOUNT_CONDITIONS,
  PET_HEALTH_EXCRETION_CONDITIONS as HEALTH_EXCRETION_CONDITIONS,
  PET_HEALTH_OVERALL_CONDITIONS as HEALTH_OVERALL_CONDITIONS,
  PET_HEALTH_SYMPTOMS as HEALTH_SYMPTOMS
} from "@/lib/pet-record-schemas";
import {
  PET_HEALTH_AMOUNT_LABELS as HEALTH_AMOUNT_LABELS,
  PET_HEALTH_EXCRETION_LABELS as HEALTH_EXCRETION_LABELS,
  PET_HEALTH_OVERALL_LABELS as HEALTH_OVERALL_LABELS,
  PET_HEALTH_SYMPTOM_LABELS as HEALTH_SYMPTOM_LABELS
} from "@/lib/pet-records";

type PetRecordCreateKind = "health" | "medical" | "medication" | "vaccination" | "memory";
type CreateAction = (formData: FormData) => Promise<PetRecordCreateActionResult>;
type CreateError = Extract<PetRecordCreateActionResult, { success: false }>;
const fieldClass = "grid gap-1 text-sm font-medium text-slate-700";
const submitClass = "inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-fit";

const kinds: Array<{
  value: PetRecordCreateKind;
  label: string;
  shortLabel: string;
  icon: typeof HeartPulse;
}> = [
  { value: "health", label: "体調を記録", shortLabel: "体調", icon: HeartPulse },
  { value: "medical", label: "通院を記録", shortLabel: "通院", icon: Stethoscope },
  { value: "medication", label: "投薬を記録", shortLabel: "投薬", icon: Pill },
  { value: "vaccination", label: "ワクチンを記録", shortLabel: "ワクチン", icon: Syringe },
  { value: "memory", label: "思い出を追加", shortLabel: "思い出", icon: ImagePlus }
];

function CreateErrorMessage({ error }: { error?: CreateError }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{error.errorMessage}</p>
      {error.errorId ? <p className="mt-1 break-all text-xs">エラーID: {error.errorId}</p> : null}
    </div>
  );
}

function HealthConditionFields() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className={fieldClass}>総合状態<select name="overallCondition" defaultValue="GOOD">{HEALTH_OVERALL_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_OVERALL_LABELS[value]}</option>)}</select></label>
        <label className={fieldClass}>食欲<select name="appetite" defaultValue="NORMAL">{HEALTH_AMOUNT_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_AMOUNT_LABELS[value]}</option>)}</select></label>
        <label className={fieldClass}>活動量<select name="activityLevel" defaultValue="NORMAL">{HEALTH_AMOUNT_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_AMOUNT_LABELS[value]}</option>)}</select></label>
        <label className={fieldClass}>便<select name="stoolCondition" defaultValue="NORMAL">{HEALTH_EXCRETION_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_EXCRETION_LABELS[value]}</option>)}</select></label>
        <label className={fieldClass}>尿<select name="urineCondition" defaultValue="NORMAL">{HEALTH_EXCRETION_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_EXCRETION_LABELS[value]}</option>)}</select></label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold text-slate-700">気になる症状（複数選択可）</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {HEALTH_SYMPTOMS.map((symptom) => <label key={symptom} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" name="symptoms" value={symptom} />{HEALTH_SYMPTOM_LABELS[symptom]}</label>)}
        </div>
      </fieldset>
    </>
  );
}

function DateAndTime({ label, today }: { label: string; today: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className={`${fieldClass} sm:w-56`}>{label}<input type="date" name="recordDate" defaultValue={today} max={today} required /></label>
      <RecordTimeInput />
    </div>
  );
}

export function PetRecordCreateForms({
  petId,
  pets,
  today,
  savedMemoryTags
}: {
  petId: string;
  pets: Array<{ id: string; name: string; species: "DOG" | "CAT"; isActive: boolean }>;
  today: string;
  savedMemoryTags: string[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<PetRecordCreateKind>("health");
  const [pendingKind, setPendingKind] = useState<PetRecordCreateKind | null>(null);
  const [submitErrors, setSubmitErrors] = useState<Partial<Record<PetRecordCreateKind, CreateError>>>({});
  const [submitSuccesses, setSubmitSuccesses] = useState<Partial<Record<PetRecordCreateKind, boolean>>>({});
  const [formVersions, setFormVersions] = useState<Record<PetRecordCreateKind, number>>({
    health: 0,
    medical: 0,
    medication: 0,
    vaccination: 0,
    memory: 0
  });
  const [, startTransition] = useTransition();

  function submitRecord(recordKind: PetRecordCreateKind, action: CreateAction) {
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

  function feedback(recordKind: PetRecordCreateKind) {
    return (
      <>
        <CreateErrorMessage error={submitErrors[recordKind]} />
        {submitSuccesses[recordKind] ? <AutoDismissSuccessMessage message="記録しました。" /> : null}
      </>
    );
  }

  return (
    <UnsavedChangesGuard>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" aria-label="登録する記録種類">
          {kinds.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setKind(option.value)}
                aria-pressed={kind === option.value}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold ${kind === option.value ? "border-brand bg-brand text-white" : "border-slate-200 text-slate-700 hover:border-brand hover:text-brand"}`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="sm:hidden">{option.shortLabel}</span><span className="hidden sm:inline">{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className={kind === "health" ? "" : "hidden"}>
          <form key={formVersions.health} onSubmit={submitRecord("health", createPetHealthRecord)} data-dirty-watch className="mt-5 grid gap-4">
            <input type="hidden" name="petId" value={petId} />
            {feedback("health")}
            <DateAndTime label="記録日" today={today} />
            <HealthConditionFields />
            <label className={fieldClass}>メモ<textarea name="memo" maxLength={2000} placeholder="その他の症状や気になったことを入力" /></label>
            <button type="submit" disabled={pendingKind !== null} className={submitClass}>{pendingKind === "health" ? "保存中..." : "体調記録を保存"}</button>
          </form>
        </div>

        <div className={kind === "medical" ? "" : "hidden"}>
          <form key={formVersions.medical} onSubmit={submitRecord("medical", createPetMedicalRecord)} data-dirty-watch className="mt-5 grid gap-4">
            <input type="hidden" name="petId" value={petId} />
            {feedback("medical")}
            <DateAndTime label="受診日" today={today} />
            <label className={fieldClass}>動物病院名（任意）<input name="hospitalName" maxLength={120} /></label>
            <label className={fieldClass}>受診理由・症状<textarea name="reason" maxLength={2000} required /></label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className={fieldClass}>診断<textarea name="diagnosis" maxLength={2000} /></label>
              <label className={fieldClass}>検査<textarea name="examination" maxLength={2000} /></label>
              <label className={fieldClass}>処置・治療<textarea name="treatment" maxLength={2000} /></label>
              <label className={fieldClass}>処方薬<textarea name="medication" maxLength={2000} /></label>
              <label className={fieldClass}>投薬指示<textarea name="medicationInstructions" maxLength={2000} /></label>
              <label className={fieldClass}>メモ<textarea name="memo" maxLength={2000} /></label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>次回受診日（任意）<input type="date" name="nextVisitDate" /></label>
              <label className={fieldClass}>診察費（円・整数）<input type="number" name="consultationFee" min="0" max="99999999" step="1" inputMode="numeric" /></label>
            </div>
            <button type="submit" disabled={pendingKind !== null} className={submitClass}>{pendingKind === "medical" ? "保存中..." : "通院記録を保存"}</button>
          </form>
        </div>

        <div className={kind === "medication" ? "" : "hidden"}>
          <form key={formVersions.medication} onSubmit={submitRecord("medication", createPetMedicationRecord)} data-dirty-watch className="mt-5 grid gap-4">
            <input type="hidden" name="petId" value={petId} />
            {feedback("medication")}
            <DateAndTime label="投薬日" today={today} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>薬名<input name="medicationName" maxLength={200} required /></label>
              <label className={fieldClass}>投与量（任意）<input name="dosage" maxLength={100} placeholder="1錠、2.5mL、2滴など" /></label>
            </div>
            <label className={fieldClass}>メモ<textarea name="memo" maxLength={2000} /></label>
            <button type="submit" disabled={pendingKind !== null} className={submitClass}>{pendingKind === "medication" ? "保存中..." : "投薬記録を保存"}</button>
          </form>
        </div>

        <div className={kind === "vaccination" ? "" : "hidden"}>
          <form key={formVersions.vaccination} onSubmit={submitRecord("vaccination", createPetVaccinationRecord)} data-dirty-watch className="mt-5 grid gap-4">
            <input type="hidden" name="petId" value={petId} />
            {feedback("vaccination")}
            <DateAndTime label="接種日" today={today} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>ワクチン名<input name="vaccineName" maxLength={200} required /></label>
              <label className={fieldClass}>動物病院名（任意）<input name="hospitalName" maxLength={200} /></label>
            </div>
            <label className={fieldClass}>次回接種予定日（任意）<input type="date" name="nextDueDate" /></label>
            <label className={fieldClass}>メモ<textarea name="memo" maxLength={2000} /></label>
            <button type="submit" disabled={pendingKind !== null} className={submitClass}>{pendingKind === "vaccination" ? "保存中..." : "ワクチン記録を保存"}</button>
          </form>
        </div>

        <div className={kind === "memory" ? "" : "hidden"}>
          <form key={formVersions.memory} onSubmit={submitRecord("memory", createPetMemoryRecord)} data-dirty-watch className="mt-5 grid gap-4">
            <input type="hidden" name="petId" value={petId} />
            {feedback("memory")}
            <MemoryPetSelector
              key={petId}
              pets={pets}
              selectedIds={[petId]}
              representativeId={petId}
              lockRepresentative
              hasError={submitErrors.memory?.field === "petIds"}
            />
            <DateAndTime label="日付" today={today} />
            <label className={fieldClass}>タイトル<input name="title" maxLength={100} required /></label>
            <label className={fieldClass}>本文<textarea name="content" maxLength={5000} required /></label>
            <MemoryTagInput savedTags={savedMemoryTags} />
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" name="isFavorite" value="true" />お気に入りにする</label>
            <RecordImageField />
            <button type="submit" disabled={pendingKind !== null} className={submitClass}>{pendingKind === "memory" ? "保存中..." : "思い出を保存"}</button>
          </form>
        </div>
      </section>
    </UnsavedChangesGuard>
  );
}
