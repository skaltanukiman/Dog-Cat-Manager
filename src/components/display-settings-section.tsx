"use client";

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SETTINGS_CARD_SCROLL_BUTTON_SAFE_PADDING,
  SETTINGS_CARD_SCROLL_SAFE_CONTENT_EXPAND
} from "@/components/settings-layout";
import type { PetRecordScope } from "@/lib/pet-records";

const RECORD_SCOPE_OPTIONS: ReadonlyArray<{
  value: PetRecordScope;
  label: string;
  description: string;
}> = [
  {
    value: "pet",
    label: "選択中のPet",
    description: "記録画面を開いたとき、選択した1匹の記録を表示します。"
  },
  {
    value: "household",
    label: "共有グループ全体",
    description: "記録画面を開いたとき、現在の共有グループに所属する全Petの記録を表示します。"
  }
];

type DisplaySettingsSectionProps = {
  recordTimelineDefaultScope: PetRecordScope;
  savedSettings?: {
    recordTimelineDefaultScope: PetRecordScope;
  };
  savedSubmissionId?: number;
};

export function DisplaySettingsSection({
  recordTimelineDefaultScope: initialRecordTimelineDefaultScope,
  savedSettings,
  savedSubmissionId = 0
}: DisplaySettingsSectionProps) {
  const [recordTimelineDefaultScope, setRecordTimelineDefaultScope] = useState(
    initialRecordTimelineDefaultScope
  );
  const selectedOption =
    RECORD_SCOPE_OPTIONS.find((option) => option.value === recordTimelineDefaultScope) ??
    RECORD_SCOPE_OPTIONS[1];

  useEffect(() => {
    if (savedSubmissionId === 0 || !savedSettings) return;

    const frame = window.requestAnimationFrame(() => {
      setRecordTimelineDefaultScope(savedSettings.recordTimelineDefaultScope);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [savedSettings, savedSubmissionId]);

  return (
    <section
      aria-labelledby="display-settings-heading"
      data-settings-section="display"
      className={`min-w-0 rounded-md border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_SCROLL_BUTTON_SAFE_PADDING}`}
    >
      <div className={`space-y-5 ${SETTINGS_CARD_SCROLL_SAFE_CONTENT_EXPAND}`}>
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-brand" aria-hidden />
            <h3 id="display-settings-heading" className="text-base font-bold text-ink">
              画面の表示設定
            </h3>
          </div>
          <p className="text-sm leading-6 text-slate-600">各画面の初期表示を変更します。</p>
        </header>

        <fieldset className="min-w-0 space-y-3">
          <legend className="text-sm font-bold text-ink md:text-base">記録画面の初期表示</legend>
          <div className="grid min-w-0 grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 md:gap-3 md:rounded-md md:border md:border-slate-200 md:bg-slate-50 md:p-4">
            {RECORD_SCOPE_OPTIONS.map((option) => {
              const isSelected = option.value === recordTimelineDefaultScope;

              return (
                <label
                  key={option.value}
                  className={`flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded-md border px-1.5 py-2 text-center text-[11px] leading-4 transition focus-within:outline-none focus-within:ring-2 focus-within:ring-brand/40 focus-within:ring-offset-1 min-[360px]:px-2 min-[360px]:text-xs md:min-h-0 md:items-start md:justify-start md:gap-3 md:border-slate-200 md:bg-white md:p-3 md:text-left md:text-sm md:font-normal md:text-slate-700 ${
                    isSelected
                      ? "border-brand bg-brand/10 font-semibold text-ink shadow-sm ring-1 ring-inset ring-brand/20"
                      : "border-transparent bg-white font-medium text-slate-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="recordTimelineDefaultScope"
                    value={option.value}
                    checked={isSelected}
                    onChange={() => setRecordTimelineDefaultScope(option.value)}
                    className="sr-only md:not-sr-only md:mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{option.label}</span>
                    <span className="mt-1 hidden text-xs leading-5 text-slate-500 md:block">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-xs leading-5 text-slate-500 md:hidden">
            {selectedOption.description}
          </p>
        </fieldset>
      </div>
    </section>
  );
}
