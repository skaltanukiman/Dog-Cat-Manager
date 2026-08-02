"use client";

import { CalendarClock, Clock3, HeartPulse, ImageIcon, PawPrint, Pencil, Star, Stethoscope, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";

import { deleteHamsterRecord, updateHealthRecord, updateMedicalRecord, updateMemoryRecord } from "@/app/actions/records";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { MemoryHamsterSelector } from "@/components/memory-hamster-selector";
import { RecordImageField } from "@/components/record-image-field";
import { RecordTimeInput } from "@/components/record-time-input";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import type { getRecordsPageData } from "@/lib/record-queries";
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
  MEMORY_TAG_SUGGESTIONS,
  RECORD_TYPE_LABELS,
  recordsUrl,
  type RecordScope
} from "@/lib/records";

type RecordItem = Awaited<ReturnType<typeof getRecordsPageData>>["records"][number];
const fieldClass = "grid gap-1 text-sm font-medium text-slate-700";
const recordTypeStyles = {
  HEALTH: {
    card: "border-slate-200 border-l-4 border-l-emerald-500 bg-white",
    marker: "bg-emerald-600",
    badge: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
  },
  MEDICAL: {
    card: "border-slate-200 border-l-4 border-l-sky-500 bg-white",
    marker: "bg-sky-600",
    badge: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200"
  },
  MEMORY: {
    card: "border-slate-200 border-l-4 border-l-rose-400 bg-white",
    marker: "bg-rose-500",
    badge: "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200"
  }
} satisfies Record<RecordItem["recordType"], { card: string; marker: string; badge: string }>;

function RecordPhoto({
  recordId,
  title,
  staticImagePath
}: {
  recordId: string;
  title: string;
  staticImagePath: string | null;
}) {
  const dialogTitleId = useId();
  const [failed, setFailed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const imageUrl = staticImagePath ?? `/api/records/${encodeURIComponent(recordId)}/image`;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  function handleImageError() {
    setFailed(true);
    setIsOpen(false);
  }

  if (failed) return <div className="grid h-48 place-items-center rounded-md bg-slate-100 text-sm text-slate-500"><ImageIcon className="mb-2 h-6 w-6" aria-hidden />写真を読み込めませんでした</div>;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${title}の写真を拡大表示`}
        title="クリックして拡大表示"
        onClick={() => setIsOpen(true)}
        className="block w-full cursor-zoom-in overflow-hidden rounded-md bg-slate-100 transition hover:ring-2 hover:ring-moss/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss"
      >
        {/* 通常画像は認証Cookie付きAPI、デモ画像はpublic配下の固定パスを直接参照する。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={title} onError={handleImageError} className="max-h-96 w-full object-contain" />
      </button>

      {isOpen ? (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6"
          onClick={() => setIsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-md bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
              <h3 id={dialogTitleId} className="min-w-0 truncate text-base font-bold text-ink">
                {title}の写真
              </h3>
              <button
                type="button"
                aria-label="写真を閉じる"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3 sm:p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={`${title}の写真（拡大表示）`}
                className="max-h-[75vh] max-w-full object-contain"
                onError={handleImageError}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function HealthFields({ detail }: { detail: NonNullable<RecordItem["healthDetail"]> }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className={fieldClass}>総合状態<select name="overallCondition" defaultValue={detail.overallCondition}>{HEALTH_OVERALL_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_OVERALL_LABELS[value]}</option>)}</select></label>
        <label className={fieldClass}>食欲<select name="appetite" defaultValue={detail.appetite}>{HEALTH_AMOUNT_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_AMOUNT_LABELS[value]}</option>)}</select></label>
        <label className={fieldClass}>活動量<select name="activityLevel" defaultValue={detail.activityLevel}>{HEALTH_AMOUNT_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_AMOUNT_LABELS[value]}</option>)}</select></label>
        <label className={fieldClass}>便<select name="stoolCondition" defaultValue={detail.stoolCondition}>{HEALTH_EXCRETION_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_EXCRETION_LABELS[value]}</option>)}</select></label>
        <label className={fieldClass}>尿<select name="urineCondition" defaultValue={detail.urineCondition}>{HEALTH_EXCRETION_CONDITIONS.map((value) => <option key={value} value={value}>{HEALTH_EXCRETION_LABELS[value]}</option>)}</select></label>
      </div>
      <fieldset className="grid gap-2"><legend className="text-sm font-semibold text-slate-700">気になる症状</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{HEALTH_SYMPTOMS.map((symptom) => <label key={symptom} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" name="symptoms" value={symptom} defaultChecked={detail.symptoms.includes(symptom)} />{HEALTH_SYMPTOM_LABELS[symptom]}</label>)}</div></fieldset>
    </>
  );
}

function RecordEditForm({
  record,
  hamsters,
  viewScope,
  returnHamsterId,
  today
}: {
  record: RecordItem;
  hamsters: Array<{ id: string; name: string; isActive: boolean }>;
  viewScope: RecordScope;
  returnHamsterId: string;
  today: string;
}) {
  if (record.recordType === "HEALTH" && record.healthDetail) {
    return (
      <form action={updateHealthRecord} data-dirty-watch className="mt-4 grid gap-4 border-t border-slate-200 pt-4">
        <input type="hidden" name="id" value={record.id} /><input type="hidden" name="hamsterId" value={record.hamster.id} />
        <input type="hidden" name="viewScope" value={viewScope} /><input type="hidden" name="returnHamsterId" value={returnHamsterId} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className={`${fieldClass} sm:w-56`}>記録日<input type="date" name="recordDate" defaultValue={record.recordDate} max={today} required /></label>
          <RecordTimeInput defaultValue={record.recordTime} />
        </div>
        <HealthFields detail={record.healthDetail} />
        <label className={fieldClass}>メモ<textarea name="memo" defaultValue={record.memo ?? ""} maxLength={2000} /></label>
        <DirtySubmitButton className="inline-flex h-10 items-center justify-center rounded-md bg-moss px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-fit">変更を保存</DirtySubmitButton>
      </form>
    );
  }

  if (record.recordType === "MEDICAL" && record.medicalDetail) {
    const detail = record.medicalDetail;
    return (
      <form action={updateMedicalRecord} data-dirty-watch className="mt-4 grid gap-4 border-t border-slate-200 pt-4">
        <input type="hidden" name="id" value={record.id} /><input type="hidden" name="hamsterId" value={record.hamster.id} />
        <input type="hidden" name="viewScope" value={viewScope} /><input type="hidden" name="returnHamsterId" value={returnHamsterId} />
        <div className="grid gap-3 sm:grid-cols-2"><label className={fieldClass}>通院日<input type="date" name="recordDate" defaultValue={record.recordDate} max={today} required /></label><label className={fieldClass}>動物病院名<input name="hospitalName" defaultValue={detail.hospitalName ?? ""} maxLength={120} /></label></div>
        <label className={fieldClass}>通院理由・症状<textarea name="reason" defaultValue={detail.reason} maxLength={2000} required /></label>
        <div className="grid gap-3 md:grid-cols-2"><label className={fieldClass}>診断内容<textarea name="diagnosis" defaultValue={detail.diagnosis ?? ""} maxLength={2000} /></label><label className={fieldClass}>検査内容<textarea name="examination" defaultValue={detail.examination ?? ""} maxLength={2000} /></label><label className={fieldClass}>処置・治療内容<textarea name="treatment" defaultValue={detail.treatment ?? ""} maxLength={2000} /></label><label className={fieldClass}>処方薬<textarea name="medication" defaultValue={detail.medication ?? ""} maxLength={2000} /></label><label className={fieldClass}>投薬方法<textarea name="medicationInstructions" defaultValue={detail.medicationInstructions ?? ""} maxLength={2000} /></label><label className={fieldClass}>メモ<textarea name="memo" defaultValue={record.memo ?? ""} maxLength={2000} /></label></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className={fieldClass}>次回通院予定日<input type="date" name="nextVisitDate" defaultValue={detail.nextVisitDate ?? ""} /></label><label className={fieldClass}>診察費（円・整数）<input type="number" name="consultationFee" defaultValue={detail.consultationFee ?? ""} min="0" max="99999999" step="1" /></label></div>
        <DirtySubmitButton className="inline-flex h-10 items-center justify-center rounded-md bg-moss px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-fit">変更を保存</DirtySubmitButton>
      </form>
    );
  }

  if (record.recordType === "MEMORY" && record.memoryDetail) {
    return (
      <form action={updateMemoryRecord} data-dirty-watch className="mt-4 grid gap-4 border-t border-slate-200 pt-4">
        <input type="hidden" name="id" value={record.id} /><input type="hidden" name="hamsterId" value={record.hamster.id} />
        <input type="hidden" name="viewScope" value={viewScope} /><input type="hidden" name="returnHamsterId" value={returnHamsterId} />
        <MemoryHamsterSelector
          key={`${record.id}:${record.memoryDetail.hamsters.map((hamster) => hamster.id).join(",")}`}
          hamsters={hamsters}
          selectedIds={record.memoryDetail.hamsters.map((hamster) => hamster.id)}
          representativeId={record.hamster.id}
        />
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]"><label className={fieldClass}>日付<input type="date" name="recordDate" defaultValue={record.recordDate} max={today} required /></label><label className={fieldClass}>タイトル<input name="title" defaultValue={record.title} maxLength={100} required /></label></div>
        <label className={fieldClass}>内容<textarea name="content" defaultValue={record.memo ?? ""} maxLength={5000} required /></label>
        <label className={fieldClass}>タグ（「、」またはカンマ区切り）<input name="tags" defaultValue={record.memoryDetail.tags.join("、")} maxLength={619} /><span className="text-xs font-normal text-slate-500">候補: {MEMORY_TAG_SUGGESTIONS.join("、")}</span></label>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" name="isFavorite" value="true" defaultChecked={record.memoryDetail.isFavorite} />お気に入りにする</label>
        <RecordImageField recordId={record.id} hasCurrentImage={Boolean(record.memoryDetail.imageFileName)} />
        <DirtySubmitButton className="inline-flex h-10 items-center justify-center rounded-md bg-moss px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-fit">変更を保存</DirtySubmitButton>
      </form>
    );
  }
  return null;
}

function TypeIcon({ type }: { type: RecordItem["recordType"] }) {
  if (type === "HEALTH") return <HeartPulse className="h-4 w-4" aria-hidden />;
  if (type === "MEDICAL") return <Stethoscope className="h-4 w-4" aria-hidden />;
  return <ImageIcon className="h-4 w-4" aria-hidden />;
}

export function RecordTimeline({
  records,
  hamsters,
  scope,
  returnHamsterId,
  canEdit,
  today,
  basePath = "/records"
}: {
  records: RecordItem[];
  hamsters: Array<{ id: string; name: string; isActive: boolean }>;
  scope: RecordScope;
  returnHamsterId: string;
  canEdit: boolean;
  today: string;
  basePath?: "/records" | "/demo/records";
}) {
  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("この記録を削除します。元に戻せません。よろしいですか？")) event.preventDefault();
  }

  if (records.length === 0) return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">条件に一致する記録はありません。</div>;

  return (
    <UnsavedChangesGuard>
      <div className="relative grid gap-4 before:absolute before:bottom-0 before:left-4 before:top-0 before:w-px before:bg-slate-200 sm:before:left-5">
        {records.map((record) => {
          const editable = canEdit && (record.recordType === "MEMORY" || record.hamster.isActive);
          const typeStyle = recordTypeStyles[record.recordType];
          const recordHamsters = record.recordType === "MEMORY"
            ? record.memoryDetail?.hamsters ?? [record.hamster]
            : scope === "household"
              ? [record.hamster]
              : [];
          return (
            <article key={record.id} className={`relative ml-9 rounded-lg border p-4 shadow-sm sm:ml-12 sm:p-5 ${typeStyle.card}`}>
              <span className={`absolute -left-[2.25rem] top-5 grid h-8 w-8 place-items-center rounded-full border-2 border-white text-white shadow sm:-left-[3.1rem] sm:h-10 sm:w-10 ${typeStyle.marker}`}><TypeIcon type={record.recordType} /></span>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${typeStyle.badge}`}><TypeIcon type={record.recordType} />{RECORD_TYPE_LABELS[record.recordType]}</span>{recordHamsters.map((hamster) => <Link key={hamster.id} href={recordsUrl({ basePath, scope: "hamster", includeScope: true, hamsterId: hamster.id })} scroll={false} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800 ring-1 ring-inset ring-violet-200 hover:bg-violet-100"><PawPrint className="h-3.5 w-3.5" aria-hidden />{hamster.name}</Link>)}{record.memoryDetail?.isFavorite ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800"><Star className="h-3.5 w-3.5 fill-current" aria-hidden />お気に入り</span> : null}</div>
                  <h3 className="mt-2 text-lg font-bold text-ink">{record.title}</h3>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>{record.recordDate.replaceAll("-", "/")}</span>{record.recordTime ? <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden />{record.recordTime}</span> : null}<span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" aria-hidden />{record.createdByLabel}</span></div>
                </div>
                {editable ? <form action={deleteHamsterRecord} onSubmit={confirmDelete}><input type="hidden" name="id" value={record.id} /><input type="hidden" name="hamsterId" value={record.hamster.id} /><input type="hidden" name="viewScope" value={scope} /><input type="hidden" name="returnHamsterId" value={returnHamsterId} /><button type="submit" className="inline-flex h-9 items-center gap-1 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" aria-hidden />削除</button></form> : null}
              </div>

              {record.recordType === "HEALTH" && record.healthDetail ? <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3"><p><span className="font-semibold">総合:</span> {HEALTH_OVERALL_LABELS[record.healthDetail.overallCondition]}</p><p><span className="font-semibold">食欲:</span> {HEALTH_AMOUNT_LABELS[record.healthDetail.appetite]}</p><p><span className="font-semibold">活動:</span> {HEALTH_AMOUNT_LABELS[record.healthDetail.activityLevel]}</p><p><span className="font-semibold">便:</span> {HEALTH_EXCRETION_LABELS[record.healthDetail.stoolCondition]}</p><p><span className="font-semibold">尿:</span> {HEALTH_EXCRETION_LABELS[record.healthDetail.urineCondition]}</p>{record.healthDetail.symptoms.length ? <p className="sm:col-span-2 lg:col-span-3"><span className="font-semibold">症状:</span> {record.healthDetail.symptoms.map((value) => HEALTH_SYMPTOM_LABELS[value]).join("、")}</p> : null}</div> : null}
              {record.recordType === "MEDICAL" && record.medicalDetail ? <div className="mt-4 grid gap-2 text-sm"><p><span className="font-semibold">理由・症状:</span> {record.medicalDetail.reason}</p>{record.medicalDetail.diagnosis ? <p><span className="font-semibold">診断:</span> {record.medicalDetail.diagnosis}</p> : null}{record.medicalDetail.medication ? <p><span className="font-semibold">処方薬:</span> {record.medicalDetail.medication}</p> : null}{record.medicalDetail.nextVisitDate ? <p className="inline-flex w-fit items-center gap-2 rounded-md bg-sky-50 px-3 py-2 font-semibold text-sky-800"><CalendarClock className="h-4 w-4" aria-hidden />次回通院予定: {record.medicalDetail.nextVisitDate.replaceAll("-", "/")}</p> : null}</div> : null}
              {record.recordType === "MEMORY" && record.memoryDetail ? <div className="mt-4 grid gap-3">{record.memoryDetail.imageFileName || record.staticImagePath ? <RecordPhoto recordId={record.id} title={record.title} staticImagePath={record.staticImagePath} /> : null}{record.memoryDetail.tags.length ? <div className="flex flex-wrap gap-1.5">{record.memoryDetail.tags.map((tag) => <span key={tag} className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">#{tag}</span>)}</div> : null}</div> : null}
              {record.memo ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{record.memo}</p> : null}
              {editable ? <details className="group mt-4"><summary className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-moss"><Pencil className="h-4 w-4" aria-hidden /><span className="group-open:hidden">編集フォームを開く</span><span className="hidden group-open:inline">編集フォームを閉じる</span></summary><RecordEditForm record={record} hamsters={hamsters} viewScope={scope} returnHamsterId={returnHamsterId} today={today} /></details> : !canEdit ? null : <p className="mt-4 text-xs text-amber-700">管理外のため、この健康・通院記録は閲覧のみです。</p>}
            </article>
          );
        })}
      </div>
    </UnsavedChangesGuard>
  );
}
