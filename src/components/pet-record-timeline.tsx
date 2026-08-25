"use client";

import {
  CalendarClock,
  Clock3,
  HeartPulse,
  ImageIcon,
  PawPrint,
  Pencil,
  Pill,
  Star,
  Stethoscope,
  Syringe,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";

import { updatePetHealthRecord } from "@/app/actions/pet-health-records";
import { updatePetMedicalRecord } from "@/app/actions/pet-medical-records";
import { updatePetMedicationRecord } from "@/app/actions/pet-medication-records";
import { updatePetMemoryRecord } from "@/app/actions/pet-memory-records";
import { deletePetRecord } from "@/app/actions/pet-records";
import { updatePetVaccinationRecord } from "@/app/actions/pet-vaccination-records";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { MemoryPetSelector } from "@/components/memory-pet-selector";
import { PetThumbnail } from "@/components/pet-thumbnail";
import { RecordImageField } from "@/components/record-image-field";
import { RecordTimeInput } from "@/components/record-time-input";
import { AutoDismissSuccessMessage } from "@/components/status-message";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import { petRecordTypeStyles } from "@/lib/pet-record-style";
import type { getPetRecordsPageData } from "@/lib/pet-record-queries";
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
  PET_HEALTH_SYMPTOM_LABELS as HEALTH_SYMPTOM_LABELS,
  PET_MEMORY_TAG_SUGGESTIONS,
  PET_RECORD_TYPE_LABELS,
  petRecordsUrl,
  type PetRecordScope,
  type PetRecordTypeFilter
} from "@/lib/pet-records";

type PetRecordItem = Awaited<ReturnType<typeof getPetRecordsPageData>>["records"][number];
const fieldClass = "grid gap-1 text-sm font-medium text-slate-700";
const submitClass = "inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-fit";
const speciesLabel = { DOG: "犬", CAT: "猫" } as const;
type PetRecordReturnFilters = {
  type: PetRecordTypeFilter;
  from: string;
  to: string;
  keyword: string;
  favoriteOnly: boolean;
  page: number;
};
function TypeIcon({ type }: { type: PetRecordItem["recordType"] }) {
  if (type === "HEALTH") return <HeartPulse className="h-4 w-4" aria-hidden />;
  if (type === "MEDICAL") return <Stethoscope className="h-4 w-4" aria-hidden />;
  if (type === "MEDICATION") return <Pill className="h-4 w-4" aria-hidden />;
  if (type === "VACCINATION") return <Syringe className="h-4 w-4" aria-hidden />;
  return <ImageIcon className="h-4 w-4" aria-hidden />;
}

function PetRecordPhoto({ recordId, title }: { recordId: string; title: string }) {
  const dialogTitleId = useId();
  const [failed, setFailed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const imageUrl = `/api/pet-records/${encodeURIComponent(recordId)}/image`;

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

  if (failed) return <div className="grid h-48 place-items-center rounded-md bg-slate-100 text-sm text-slate-500">写真を読み込めませんでした</div>;
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-label={`${title}の写真を拡大表示`} onClick={() => setIsOpen(true)} className="block w-full cursor-zoom-in overflow-hidden rounded-md bg-slate-100 hover:ring-2 hover:ring-brand/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={title} onError={handleImageError} className="max-h-96 w-full object-contain" />
      </button>
      {isOpen ? (
        <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6" onClick={() => setIsOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-md bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
              <h3 id={dialogTitleId} className="truncate font-bold text-ink">{title}の写真</h3>
              <button type="button" aria-label="写真を閉じる" onClick={() => setIsOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200"><X className="h-4 w-4" aria-hidden /></button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={`${title}の写真（拡大表示）`} className="max-h-[75vh] max-w-full object-contain" onError={handleImageError} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MutationContextFields({
  record,
  viewScope,
  returnPetId,
  includeInactive,
  returnFilters
}: {
  record: PetRecordItem;
  viewScope: PetRecordScope;
  returnPetId: string;
  includeInactive: boolean;
  returnFilters: PetRecordReturnFilters;
}) {
  return (
    <>
      <input type="hidden" name="id" value={record.id} />
      <input type="hidden" name="petId" value={record.pet.id} />
      <input type="hidden" name="updatedAt" value={record.updatedAt} />
      <input type="hidden" name="viewScope" value={viewScope} />
      <input type="hidden" name="returnPetId" value={returnPetId} />
      {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
      <input type="hidden" name="returnType" value={returnFilters.type} />
      <input type="hidden" name="returnFrom" value={returnFilters.from} />
      <input type="hidden" name="returnTo" value={returnFilters.to} />
      <input type="hidden" name="returnKeyword" value={returnFilters.keyword} />
      {returnFilters.favoriteOnly ? <input type="hidden" name="returnFavorite" value="1" /> : null}
      <input type="hidden" name="returnPage" value={returnFilters.page} />
    </>
  );
}

function DateAndTimeEdit({ record, label, today }: { record: PetRecordItem; label: string; today: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className={`${fieldClass} sm:w-56`}>{label}<input type="date" name="recordDate" defaultValue={record.recordDate} max={today} required /></label>
      <RecordTimeInput defaultValue={record.recordTime} />
    </div>
  );
}

function HealthEditFields({ detail }: { detail: NonNullable<PetRecordItem["healthDetail"]> }) {
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

function PetRecordEditForm({
  record,
  pets,
  viewScope,
  returnPetId,
  includeInactive,
  returnFilters,
  today
}: {
  record: PetRecordItem;
  pets: Array<{ id: string; name: string; species: "DOG" | "CAT"; isActive: boolean }>;
  viewScope: PetRecordScope;
  returnPetId: string;
  includeInactive: boolean;
  returnFilters: PetRecordReturnFilters;
  today: string;
}) {
  const context = <MutationContextFields record={record} viewScope={viewScope} returnPetId={returnPetId} includeInactive={includeInactive} returnFilters={returnFilters} />;
  const submit = <DirtySubmitButton className={submitClass}>変更を保存</DirtySubmitButton>;

  if (record.recordType === "HEALTH" && record.healthDetail) {
    return <form action={updatePetHealthRecord} data-dirty-watch className="mt-4 grid gap-4 border-t border-slate-200 pt-4">{context}<DateAndTimeEdit record={record} label="記録日" today={today} /><HealthEditFields detail={record.healthDetail} /><label className={fieldClass}>メモ<textarea name="memo" defaultValue={record.memo ?? ""} maxLength={2000} /></label>{submit}</form>;
  }
  if (record.recordType === "MEDICAL" && record.medicalDetail) {
    const detail = record.medicalDetail;
    return (
      <form action={updatePetMedicalRecord} data-dirty-watch className="mt-4 grid gap-4 border-t border-slate-200 pt-4">
        {context}<DateAndTimeEdit record={record} label="受診日" today={today} />
        <label className={fieldClass}>動物病院名<input name="hospitalName" defaultValue={detail.hospitalName ?? ""} maxLength={120} /></label>
        <label className={fieldClass}>受診理由・症状<textarea name="reason" defaultValue={detail.reason} maxLength={2000} required /></label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={fieldClass}>診断<textarea name="diagnosis" defaultValue={detail.diagnosis ?? ""} maxLength={2000} /></label>
          <label className={fieldClass}>検査<textarea name="examination" defaultValue={detail.examination ?? ""} maxLength={2000} /></label>
          <label className={fieldClass}>処置・治療<textarea name="treatment" defaultValue={detail.treatment ?? ""} maxLength={2000} /></label>
          <label className={fieldClass}>処方薬<textarea name="medication" defaultValue={detail.medication ?? ""} maxLength={2000} /></label>
          <label className={fieldClass}>投薬指示<textarea name="medicationInstructions" defaultValue={detail.medicationInstructions ?? ""} maxLength={2000} /></label>
          <label className={fieldClass}>メモ<textarea name="memo" defaultValue={record.memo ?? ""} maxLength={2000} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={fieldClass}>次回受診日<input type="date" name="nextVisitDate" defaultValue={detail.nextVisitDate ?? ""} /></label>
          <label className={fieldClass}>診察費（円・整数）<input type="number" name="consultationFee" defaultValue={detail.consultationFee ?? ""} min="0" max="99999999" step="1" /></label>
        </div>{submit}
      </form>
    );
  }
  if (record.recordType === "MEDICATION" && record.medicationDetail) {
    const detail = record.medicationDetail;
    return <form action={updatePetMedicationRecord} data-dirty-watch className="mt-4 grid gap-4 border-t border-slate-200 pt-4">{context}<DateAndTimeEdit record={record} label="投薬日" today={today} /><div className="grid gap-3 sm:grid-cols-2"><label className={fieldClass}>薬名<input name="medicationName" defaultValue={detail.medicationName} maxLength={200} required /></label><label className={fieldClass}>投与量<input name="dosage" defaultValue={detail.dosage ?? ""} maxLength={100} /></label></div><label className={fieldClass}>メモ<textarea name="memo" defaultValue={record.memo ?? ""} maxLength={2000} /></label>{submit}</form>;
  }
  if (record.recordType === "VACCINATION" && record.vaccinationDetail) {
    const detail = record.vaccinationDetail;
    return <form action={updatePetVaccinationRecord} data-dirty-watch className="mt-4 grid gap-4 border-t border-slate-200 pt-4">{context}<DateAndTimeEdit record={record} label="接種日" today={today} /><div className="grid gap-3 sm:grid-cols-2"><label className={fieldClass}>ワクチン名<input name="vaccineName" defaultValue={detail.vaccineName} maxLength={200} required /></label><label className={fieldClass}>動物病院名<input name="hospitalName" defaultValue={detail.hospitalName ?? ""} maxLength={200} /></label></div><label className={fieldClass}>次回接種予定日<input type="date" name="nextDueDate" defaultValue={detail.nextDueDate ?? ""} /></label><label className={fieldClass}>メモ<textarea name="memo" defaultValue={record.memo ?? ""} maxLength={2000} /></label>{submit}</form>;
  }
  if (record.recordType === "MEMORY" && record.memoryDetail) {
    return (
      <form action={updatePetMemoryRecord} data-dirty-watch className="mt-4 grid gap-4 border-t border-slate-200 pt-4">
        {context}
        <MemoryPetSelector key={`${record.id}:${record.memoryDetail.pets.map((pet) => pet.id).join(",")}`} pets={pets} selectedIds={record.memoryDetail.pets.map((pet) => pet.id)} representativeId={record.pet.id} isEditing />
        <DateAndTimeEdit record={record} label="日付" today={today} />
        <label className={fieldClass}>タイトル<input name="title" defaultValue={record.title} maxLength={100} required /></label>
        <label className={fieldClass}>本文<textarea name="content" defaultValue={record.memo ?? ""} maxLength={5000} required /></label>
        <label className={fieldClass}>タグ（「、」またはカンマ区切り）<input name="tags" defaultValue={record.memoryDetail.tags.join("、")} maxLength={619} /><span className="text-xs font-normal text-slate-500">候補: {PET_MEMORY_TAG_SUGGESTIONS.join("、")}</span></label>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" name="isFavorite" value="true" defaultChecked={record.memoryDetail.isFavorite} />お気に入りにする</label>
        <RecordImageField recordId={record.id} hasCurrentImage={Boolean(record.memoryDetail.imageFileName)} />
        {submit}
      </form>
    );
  }
  return null;
}

export function PetRecordTimeline({
  records,
  pets,
  scope,
  returnPetId,
  includeInactive,
  returnFilters,
  canEdit,
  today
}: {
  records: PetRecordItem[];
  pets: Array<{ id: string; name: string; species: "DOG" | "CAT"; isActive: boolean }>;
  scope: PetRecordScope;
  returnPetId: string;
  includeInactive: boolean;
  returnFilters: PetRecordReturnFilters;
  canEdit: boolean;
  today: string;
}) {
  const router = useRouter();
  const [deletedRecordIds, setDeletedRecordIds] = useState<string[]>([]);
  const [deleteSuccess, setDeleteSuccess] = useState<{ key: number; page: number } | null>(null);
  const [isDeletePending, startDeleteTransition] = useTransition();
  const normalizedSuccessKey = useRef<number | null>(null);
  const visibleRecords = records.filter((record) => !deletedRecordIds.includes(record.id));

  useEffect(() => {
    if (
      !deleteSuccess ||
      deleteSuccess.page === returnFilters.page ||
      normalizedSuccessKey.current === deleteSuccess.key
    ) {
      return;
    }

    normalizedSuccessKey.current = deleteSuccess.key;
    router.replace(
      petRecordsUrl({
        scope,
        includeScope: true,
        petId: returnPetId,
        includeInactive,
        ...returnFilters
      }),
      { scroll: false }
    );
  }, [deleteSuccess, includeInactive, returnFilters, returnPetId, router, scope]);

  function handleDelete(event: FormEvent<HTMLFormElement>, recordId: string) {
    event.preventDefault();
    if (!window.confirm("この記録を削除します。元に戻せません。よろしいですか？")) return;

    const formData = new FormData(event.currentTarget);
    startDeleteTransition(async () => {
      const result = await deletePetRecord(formData);
      if (!result.success) return;

      setDeletedRecordIds((current) => [...current, recordId]);
      setDeleteSuccess((current) => ({ key: (current?.key ?? 0) + 1, page: returnFilters.page }));
      // URLを変更せず、同一画面の再取得だけを行うため現在のスクロール位置を保てる。
      router.refresh();
    });
  }

  if (visibleRecords.length === 0) {
    return (
      <div className="grid gap-4">
        {deleteSuccess ? <AutoDismissSuccessMessage key={deleteSuccess.key} message="記録を削除しました。" /> : null}
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">条件に一致する記録はありません。</div>
      </div>
    );
  }

  return (
    <UnsavedChangesGuard>
      <div className="grid gap-4">
        {deleteSuccess ? <AutoDismissSuccessMessage key={deleteSuccess.key} message="記録を削除しました。" /> : null}
        <div className="relative grid gap-4 before:absolute before:bottom-0 before:left-4 before:top-0 before:w-px before:bg-slate-200 sm:before:left-5">
          {visibleRecords.map((record) => {
          const relatedPets = record.recordType === "MEMORY" ? record.memoryDetail?.pets ?? [record.pet] : [record.pet];
          const editable = canEdit && record.pet.isActive && relatedPets.every((pet) => pet.isActive);
          const typeStyle = petRecordTypeStyles[record.recordType];
          return (
            <article key={record.id} className={`relative ml-9 rounded-lg border border-l-4 border-slate-200 bg-white p-4 shadow-sm sm:ml-12 sm:p-5 ${typeStyle.card}`}>
              <span className={`absolute -left-[2.25rem] top-5 grid h-8 w-8 place-items-center rounded-full border-2 border-white text-white shadow sm:-left-[3.1rem] sm:h-10 sm:w-10 ${typeStyle.marker}`}><TypeIcon type={record.recordType} /></span>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
                <PetThumbnail petId={record.pet.id} petName={record.pet.name} profileImageFileName={record.pet.profileImageFileName} size="timeline" />
                <div className="min-w-0 self-center sm:col-start-2 sm:self-start">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${typeStyle.badge}`}><TypeIcon type={record.recordType} />{PET_RECORD_TYPE_LABELS[record.recordType]}</span>
                </div>
                <h3 className="col-span-full mt-2 min-w-0 break-words text-lg font-bold text-ink sm:col-span-1 sm:col-start-2">{record.title}</h3>
                <div className="col-span-full mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 sm:col-span-1 sm:col-start-2"><span>{record.recordDate.replaceAll("-", "/")}</span>{record.recordTime ? <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden />{record.recordTime}</span> : null}<span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" aria-hidden />{record.createdByLabel}</span></div>
                <div className="col-span-full mt-2 flex min-w-0 flex-col items-start gap-1.5 sm:col-span-1 sm:col-start-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                  <div className="flex max-w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs font-semibold text-violet-700 sm:gap-2">
                    <PawPrint className="h-3.5 w-3.5 shrink-0 sm:hidden" aria-hidden />
                    {relatedPets.map((pet, index) => <span key={pet.id} className="inline-flex max-w-full min-w-0 items-center gap-1"><Link href={petRecordsUrl({ scope: "pet", includeScope: true, petId: pet.id, includeInactive: includeInactive || !pet.isActive })} scroll={false} className="inline-flex max-w-full min-w-0 items-center gap-1 break-words sm:rounded-full sm:bg-violet-50 sm:px-2.5 sm:py-1 sm:font-bold sm:text-violet-800 sm:ring-1 sm:ring-inset sm:ring-violet-200"><PawPrint className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden /><span className="min-w-0 break-words">{pet.name}（{speciesLabel[pet.species]}）</span></Link>{index < relatedPets.length - 1 ? <span className="sm:hidden" aria-hidden>・</span> : null}</span>)}
                  </div>
                  {record.memoryDetail?.isFavorite ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 sm:rounded-full sm:bg-amber-100 sm:px-2.5 sm:py-1 sm:font-bold sm:text-amber-800"><Star className="h-3.5 w-3.5 fill-current" aria-hidden />お気に入り</span> : null}
                </div>
                <div className="col-span-full sm:col-span-2 sm:col-start-2">
              {record.recordType === "HEALTH" && record.healthDetail ? <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3"><p><span className="font-semibold">体調:</span> {HEALTH_OVERALL_LABELS[record.healthDetail.overallCondition]}</p><p><span className="font-semibold">食欲:</span> {HEALTH_AMOUNT_LABELS[record.healthDetail.appetite]}</p><p><span className="font-semibold">活動量:</span> {HEALTH_AMOUNT_LABELS[record.healthDetail.activityLevel]}</p><p><span className="font-semibold">便:</span> {HEALTH_EXCRETION_LABELS[record.healthDetail.stoolCondition]}</p><p><span className="font-semibold">尿:</span> {HEALTH_EXCRETION_LABELS[record.healthDetail.urineCondition]}</p>{record.healthDetail.symptoms.length ? <p className="sm:col-span-2 lg:col-span-3"><span className="font-semibold">症状:</span> {record.healthDetail.symptoms.map((value) => HEALTH_SYMPTOM_LABELS[value]).join("、")}</p> : null}</div> : null}
              {record.recordType === "MEDICAL" && record.medicalDetail ? <div className="mt-4 grid gap-2 text-sm">{record.medicalDetail.hospitalName ? <p className="font-semibold">{record.medicalDetail.hospitalName}</p> : null}<p><span className="font-semibold">受診理由:</span> {record.medicalDetail.reason}</p>{record.medicalDetail.diagnosis ? <p><span className="font-semibold">診断:</span> {record.medicalDetail.diagnosis}</p> : null}{record.medicalDetail.examination ? <p><span className="font-semibold">検査:</span> {record.medicalDetail.examination}</p> : null}{record.medicalDetail.treatment ? <p><span className="font-semibold">処置・治療:</span> {record.medicalDetail.treatment}</p> : null}{record.medicalDetail.medication ? <p><span className="font-semibold">処方薬:</span> {record.medicalDetail.medication}</p> : null}{record.medicalDetail.medicationInstructions ? <p><span className="font-semibold">投薬指示:</span> {record.medicalDetail.medicationInstructions}</p> : null}{record.medicalDetail.nextVisitDate ? <p className="inline-flex w-fit items-center gap-2 rounded-md bg-sky-50 px-3 py-2 font-semibold text-sky-800"><CalendarClock className="h-4 w-4" aria-hidden />次回受診: {record.medicalDetail.nextVisitDate.replaceAll("-", "/")}</p> : null}{record.medicalDetail.consultationFee !== null ? <p><span className="font-semibold">診察費:</span> {Number(record.medicalDetail.consultationFee).toLocaleString("ja-JP")}円</p> : null}</div> : null}
              {record.recordType === "MEDICATION" && record.medicationDetail ? <div className="mt-4 grid gap-2 text-sm"><p><span className="font-semibold">薬名:</span> {record.medicationDetail.medicationName}</p>{record.medicationDetail.dosage ? <p><span className="font-semibold">投与量:</span> {record.medicationDetail.dosage}</p> : null}</div> : null}
              {record.recordType === "VACCINATION" && record.vaccinationDetail ? <div className="mt-4 grid gap-2 text-sm"><p className="font-semibold">{record.vaccinationDetail.vaccineName}</p>{record.vaccinationDetail.hospitalName ? <p>{record.vaccinationDetail.hospitalName}</p> : null}{record.vaccinationDetail.nextDueDate ? <p className="inline-flex w-fit items-center gap-2 rounded-md bg-amber-50 px-3 py-2 font-semibold text-amber-800"><CalendarClock className="h-4 w-4" aria-hidden />次回予定: {record.vaccinationDetail.nextDueDate.replaceAll("-", "/")}</p> : null}</div> : null}
              {record.recordType === "MEMORY" && record.memoryDetail ? <div className="mt-4 grid gap-3">{record.memoryDetail.imageFileName ? <PetRecordPhoto recordId={record.id} title={record.title} /> : null}{record.memoryDetail.tags.length ? <div className="flex flex-wrap gap-1.5">{record.memoryDetail.tags.map((tag) => <span key={tag} className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">#{tag}</span>)}</div> : null}</div> : null}
              {record.memo ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{record.memo}</p> : null}
              {editable ? <details className="group mt-4"><summary className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-brand"><Pencil className="h-4 w-4" aria-hidden /><span className="group-open:hidden">編集フォームを開く</span><span className="hidden group-open:inline">編集フォームを閉じる</span></summary><PetRecordEditForm record={record} pets={pets} viewScope={scope} returnPetId={returnPetId} includeInactive={includeInactive} returnFilters={returnFilters} today={today} /></details> : !canEdit ? null : <p className="mt-4 text-xs text-amber-700">管理終了したPetが関連するため、この記録は閲覧のみです。</p>}
                </div>
                {editable ? <form onSubmit={(event) => handleDelete(event, record.id)} className="col-span-full mt-4 justify-self-end sm:col-start-3 sm:row-start-1 sm:mt-0"><MutationContextFields record={record} viewScope={scope} returnPetId={returnPetId} includeInactive={includeInactive} returnFilters={returnFilters} /><button type="submit" disabled={isDeletePending} className="inline-flex h-9 items-center gap-1 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden />{isDeletePending ? "削除中..." : "削除"}</button></form> : null}
              </div>
            </article>
          );
          })}
        </div>
      </div>
    </UnsavedChangesGuard>
  );
}
