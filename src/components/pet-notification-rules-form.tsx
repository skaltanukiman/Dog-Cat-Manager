"use client";

import { Bell, ChevronDown, Plus, Save, Trash2 } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { savePetNotificationRules } from "@/app/actions/pet-notifications";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { commitFormDirtyState, requestFormDirtyReevaluation } from "@/components/form-dirty-state";
import { AutoDismissSuccessMessage, StatusMessage } from "@/components/status-message";
import { formatMinutesAsTime, parseTimeInputToMinutes } from "@/lib/care-day";
import {
  careDayOffset,
  MAX_NOTIFY_BEFORE_MINUTES,
  notificationKindsForSpecies,
  PET_NOTIFICATION_KIND_LABELS,
  PET_NOTIFICATION_LABEL_MAX_LENGTH,
  PET_NOTIFICATION_RULE_MAX_COUNT,
  type NotificationPetSpecies,
  type PetNotificationKind
} from "@/lib/pet-notifications";
import {
  INITIAL_PET_NOTIFICATION_SAVE_STATE,
  isCommittedPetNotificationSave
} from "@/lib/pet-notification-save-state";
import type { PetNotificationRuleInput } from "@/lib/pet-notification-settings";

type EditableRule = PetNotificationRuleInput & { clientId: string };

const DEFAULTS: Record<PetNotificationKind, { label: string; deadlineMinutes: number }> = {
  FEEDING: { label: "食事", deadlineMinutes: 8 * 60 },
  WATER: { label: "水の確認", deadlineMinutes: 18 * 60 },
  WALK: { label: "散歩", deadlineMinutes: 9 * 60 },
  LITTER_CLEANING: { label: "トイレ清掃", deadlineMinutes: 20 * 60 }
};

function withClientIds(rules: readonly PetNotificationRuleInput[]): EditableRule[] {
  return rules.map((rule, index) => ({ ...rule, clientId: `saved-${index}-${rule.kind}-${rule.deadlineMinutes}` }));
}

function serializedRules(rules: readonly EditableRule[]) {
  return JSON.stringify(rules.map((rule) => ({
    kind: rule.kind,
    label: rule.label,
    deadlineMinutes: rule.deadlineMinutes,
    notifyBeforeMinutes: rule.notifyBeforeMinutes,
    enabled: rule.enabled
  })));
}

export function PetNotificationRulesForm({ petId, petName, species, isActive, careDayStartMinutes, initialRules, disabled = false }: {
  petId: string;
  petName: string;
  species: NotificationPetSpecies;
  isActive: boolean;
  careDayStartMinutes: number;
  initialRules: PetNotificationRuleInput[];
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [rules, setRules] = useState<EditableRule[]>(() => withClientIds(initialRules));
  const [saveState, saveAction, isSaving] = useActionState(savePetNotificationRules, INITIAL_PET_NOTIFICATION_SAVE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const nextId = useRef(initialRules.length);
  const contentId = useId();
  const allowedKinds = notificationKindsForSpecies(species);

  useEffect(() => {
    requestFormDirtyReevaluation(formRef.current);
  }, [rules]);

  useEffect(() => {
    if (saveState.submissionId === 0) return;
    if (!isCommittedPetNotificationSave(saveState) || !saveState.savedRules) {
      requestFormDirtyReevaluation(formRef.current);
      return;
    }
    window.requestAnimationFrame(() => {
      setRules(withClientIds(saveState.savedRules ?? []));
      window.requestAnimationFrame(() => commitFormDirtyState(formRef.current));
    });
  }, [saveState]);

  function updateRule(clientId: string, update: Partial<PetNotificationRuleInput>) {
    setRules((current) => current.map((rule) => rule.clientId === clientId ? { ...rule, ...update } : rule));
  }

  function addRule(kind: PetNotificationKind) {
    if (rules.length >= PET_NOTIFICATION_RULE_MAX_COUNT) return;
    const defaults = DEFAULTS[kind];
    const used = new Set(rules.filter((rule) => rule.kind === kind).map((rule) => rule.deadlineMinutes));
    let deadlineMinutes = defaults.deadlineMinutes;
    while (used.has(deadlineMinutes)) deadlineMinutes = (deadlineMinutes + 60) % 1440;
    const sameKindCount = rules.filter((rule) => rule.kind === kind).length;
    setRules((current) => [...current, {
      clientId: `new-${nextId.current++}`,
      kind,
      label: sameKindCount === 0 ? defaults.label : `${defaults.label}${sameKindCount + 1}`,
      deadlineMinutes,
      notifyBeforeMinutes: Math.min(30, careDayOffset(deadlineMinutes, careDayStartMinutes)),
      enabled: true
    }]);
  }

  const counts = allowedKinds.map((kind) => ({
    kind,
    count: rules.filter((rule) => rule.kind === kind).length
  }));
  const enabledCount = rules.filter((rule) => rule.enabled).length;

  return <section aria-label={`${petName}の通知設定`} data-pet-notification-settings className="mt-5 border-t border-slate-200 pt-4">
    <button type="button" aria-expanded={isOpen} aria-controls={contentId} onClick={() => setIsOpen((current) => !current)} className="min-h-11 w-full rounded-md bg-brand/10 p-3 text-left hover:bg-brand/[0.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      <span className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/20 text-brand"><Bell className="h-5 w-5" aria-hidden /></span><span className="min-w-0 flex-1"><span className="block font-bold text-ink">通知設定</span><span className="mt-1 block text-xs leading-5 text-slate-600">{rules.length === 0 ? "通知設定なし" : counts.map(({ kind, count }) => `${PET_NOTIFICATION_KIND_LABELS[kind]} ${count}件`).join(" / ")}<span className="ml-2">有効 {enabledCount}件</span></span></span></span>
      <span className="mt-2 flex items-center justify-end gap-1 text-sm font-bold text-brand">{isOpen ? "閉じる" : "設定する"}<ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden /></span>
    </button>
    <div id={contentId} aria-hidden={!isOpen} className={`grid overflow-hidden transition-[grid-template-rows,opacity,visibility] duration-200 ${isOpen ? "visible grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0 pointer-events-none"}`}><div className="min-h-0 overflow-hidden">
      <form ref={formRef} action={saveAction} data-dirty-watch aria-busy={isSaving} className="space-y-5 px-1 pt-4">
        <input type="hidden" name="petId" value={petId} />
        <input type="hidden" name="rules" value={serializedRules(rules)} data-dirty-control />
        {!isActive ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">管理終了中のため通知は送信されません。設定は保持され、管理中へ戻すと再利用できます。</p> : null}
        {disabled ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">この共有グループでは通知設定を変更できません。</p> : null}
        {allowedKinds.map((kind) => {
          const kindRules = rules.filter((rule) => rule.kind === kind).sort((left, right) => careDayOffset(left.deadlineMinutes, careDayStartMinutes) - careDayOffset(right.deadlineMinutes, careDayStartMinutes));
          return <fieldset key={kind} className="min-w-0 rounded-md border border-slate-200 p-3 sm:p-4"><legend className="px-1 font-bold text-ink">{PET_NOTIFICATION_KIND_LABELS[kind]}</legend>
            <div className="space-y-3">{kindRules.length === 0 ? <p className="text-sm text-slate-500">設定なし</p> : kindRules.map((rule) => <div key={rule.clientId} className="min-w-0 rounded-md bg-slate-50 p-3">
              <div className="flex min-w-0 items-center justify-between gap-3"><label className="flex min-h-11 min-w-0 items-center gap-2 text-sm font-semibold text-slate-700"><input name={`enabled-${rule.clientId}`} type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.clientId, { enabled: event.currentTarget.checked })} disabled={disabled || isSaving} className="h-5 w-5 shrink-0 rounded border-slate-300 text-brand"/><span className="truncate">有効</span></label><button type="button" onClick={() => setRules((current) => current.filter((entry) => entry.clientId !== rule.clientId))} disabled={disabled || isSaving} aria-label={`${rule.label}を削除`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:text-slate-300"><Trash2 className="h-4 w-4" aria-hidden /></button></div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                <label className="min-w-0 text-sm font-medium text-slate-700 sm:col-span-3">ルール名<input name={`label-${rule.clientId}`} value={rule.label} onChange={(event) => updateRule(rule.clientId, { label: event.currentTarget.value })} required maxLength={PET_NOTIFICATION_LABEL_MAX_LENGTH} disabled={disabled || isSaving} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base text-ink"/></label>
                <label className="min-w-0 text-sm font-medium text-slate-700">期限<input name={`deadline-${rule.clientId}`} type="time" required step={60} value={formatMinutesAsTime(rule.deadlineMinutes)} onChange={(event) => { const value = parseTimeInputToMinutes(event.currentTarget.value); if (value !== null) updateRule(rule.clientId, { deadlineMinutes: value }); }} disabled={disabled || isSaving} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base text-ink"/></label>
                <label className="min-w-0 text-sm font-medium text-slate-700 sm:col-span-2">何分前に通知する<input name={`before-${rule.clientId}`} type="number" required min={0} max={MAX_NOTIFY_BEFORE_MINUTES} step={1} value={rule.notifyBeforeMinutes} onChange={(event) => updateRule(rule.clientId, { notifyBeforeMinutes: Number(event.currentTarget.value) })} disabled={disabled || isSaving} className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base text-ink"/></label>
              </div>
            </div>)}</div>
            <button type="button" onClick={() => addRule(kind)} disabled={disabled || isSaving || rules.length >= PET_NOTIFICATION_RULE_MAX_COUNT} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-brand px-3 text-sm font-semibold text-brand hover:bg-brand/10 disabled:border-slate-200 disabled:text-slate-400 sm:w-auto"><Plus className="h-4 w-4" aria-hidden />{PET_NOTIFICATION_KIND_LABELS[kind]}通知を追加</button>
          </fieldset>;
        })}
        <p className="text-xs text-slate-500">通知ルールは1匹につき最大{PET_NOTIFICATION_RULE_MAX_COUNT}件です。通知予定時刻はお世話日の開始より前には設定できません。</p>
        {saveState.status ? <div key={saveState.submissionId}>
          {saveState.status === "petNotificationSaved"
            ? <AutoDismissSuccessMessage message={`${petName}の通知設定を保存しました。`} />
            : <StatusMessage status={saveState.status} errorId={saveState.errorId} />}
        </div> : null}
        {!disabled ? <div className="flex justify-end"><DirtySubmitButton disabled={isSaving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark disabled:bg-slate-300 sm:w-auto"><Save className="h-4 w-4" aria-hidden />{isSaving ? "保存中…" : "通知設定を保存"}</DirtySubmitButton></div> : null}
      </form>
    </div></div>
  </section>;
}
