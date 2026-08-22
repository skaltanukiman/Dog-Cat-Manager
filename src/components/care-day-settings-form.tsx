"use client";

import { ChevronDown, Clock3, Save } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { saveCareDaySettings } from "@/app/actions/care-day-settings";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import {
  commitFormDirtyState,
  requestFormDirtyReevaluation
} from "@/components/form-dirty-state";
import { SETTINGS_CARD_STANDARD_PADDING } from "@/components/settings-layout";
import { StatusMessage } from "@/components/status-message";
import { formatMinutesAsTime } from "@/lib/care-day";
import {
  INITIAL_SETTINGS_SAVE_STATE,
  isCommittedSettingsSave
} from "@/lib/settings-save-state";

export function CareDaySettingsForm({
  careDayStartMinutes,
  canManage
}: {
  careDayStartMinutes: number;
  canManage: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [savedMinutes, setSavedMinutes] = useState(careDayStartMinutes);
  const [saveState, saveAction, isSaving] = useActionState(
    saveCareDaySettings,
    INITIAL_SETTINGS_SAVE_STATE
  );
  const formRef = useRef<HTMLFormElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (saveState.submissionId === 0) return;
    if (!isCommittedSettingsSave(saveState)) {
      requestFormDirtyReevaluation(formRef.current);
      return;
    }

    window.requestAnimationFrame(() => {
      // Actionが正規化して確定した値をDOMのdefault値にも反映し、次のdirty判定の基準を保存後へ進める。
      const input = formRef.current?.elements.namedItem("careDayStartTime");
      if (input instanceof HTMLInputElement && saveState.savedCareDayStartMinutes !== undefined) {
        const value = formatMinutesAsTime(saveState.savedCareDayStartMinutes);
        input.value = value;
        input.defaultValue = value;
        setSavedMinutes(saveState.savedCareDayStartMinutes);
      }
      commitFormDirtyState(formRef.current);
    });
  }, [saveState]);

  return (
    <section
      aria-label="お世話日の設定"
      data-settings-section="care-day"
      className="min-w-0 overflow-hidden rounded-md border border-brand/30 bg-white shadow-sm"
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((current) => !current)}
        className={`min-h-11 w-full text-left transition-colors duration-200 ease-out active:bg-brand/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand motion-reduce:transition-none ${SETTINGS_CARD_STANDARD_PADDING} ${
          isOpen ? "bg-brand/[0.15] hover:bg-brand/20" : "bg-brand/10 hover:bg-brand/[0.15]"
        }`}
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/20 text-brand">
            <Clock3 className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-ink" role="heading" aria-level={3}>
              お世話日の設定
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-600">
              食事・水・散歩・猫トイレなどのお世話を新しい日として扱い始める時刻を設定します。
            </span>
          </span>
        </span>
        <span className="mt-3 inline-flex rounded-md border border-brand/20 bg-white px-2 py-1 text-xs font-medium text-slate-700">
          切り替え時刻：{formatMinutesAsTime(savedMinutes)}
        </span>
        <span className="mt-3 flex items-center justify-end gap-1 text-sm font-bold text-brand">
          {isOpen ? "閉じる" : canManage ? "設定を変更" : "設定を確認"}
          <ChevronDown
            className={`h-5 w-5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>

      <div
        id={contentId}
        aria-hidden={!isOpen}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,visibility] duration-200 ${
          isOpen
            ? "visible grid-rows-[1fr] opacity-100"
            : "invisible grid-rows-[0fr] opacity-0 pointer-events-none"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`border-t border-slate-200 ${SETTINGS_CARD_STANDARD_PADDING}`}>
            <form ref={formRef} action={saveAction} data-dirty-watch aria-busy={isSaving}>
              <label className="block text-sm font-medium text-slate-700">
                お世話日の切り替え時刻
                <span className="mt-1 block w-full sm:max-w-md">
                  <input
                    name="careDayStartTime"
                    type="time"
                    required
                    step={60}
                    disabled={!canManage || isSaving}
                    defaultValue={formatMinutesAsTime(careDayStartMinutes)}
                    className="block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-ink disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </span>
              </label>
              <div className="mt-2 max-w-3xl space-y-1 text-sm leading-6 text-slate-600">
                <p>設定した時刻になると、食事・水・散歩・猫トイレなどが新しいお世話日に切り替わります。</p>
                <p>例：8:00に設定した場合、翌日の7:59までは同じお世話日として扱います。</p>
              </div>
              <div className="mt-4 w-full max-w-4xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                <div className="space-y-1">
                  <p>変更内容は、保存後すぐに反映されます。</p>
                  <p>
                    現在時刻や変更前の設定によっては、お世話の表示が「実施済み」から「未実施」、または「未実施」から「実施済み」に変わる場合があります。
                  </p>
                  <p>既存記録の日付は変更されません。</p>
                </div>
              </div>
              {!canManage ? (
                <p className="mt-4 rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  共有グループのオーナーまたは管理者のみ変更できます。
                </p>
              ) : null}
              {saveState.status ? (
                <div
                  key={saveState.submissionId}
                  data-settings-save-toast
                  className="fixed inset-x-4 bottom-20 z-50 sm:left-auto sm:right-5 sm:w-full sm:max-w-md"
                >
                  <StatusMessage status={saveState.status} errorId={saveState.errorId} />
                </div>
              ) : null}
              {canManage ? (
                <div className="mt-4 flex justify-end">
                  <DirtySubmitButton
                    disabled={isSaving}
                    className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Save className="h-4 w-4" aria-hidden />
                    {isSaving ? "保存中…" : "お世話日の設定を保存"}
                  </DirtySubmitButton>
                </div>
              ) : null}
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
