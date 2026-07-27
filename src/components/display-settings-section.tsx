"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import type { CleaningMobileDefaultDateFilter } from "@/lib/cleaning-settings";
import type { HamsterSelectorMode } from "@/lib/dashboard-settings";
import type { RecordScope } from "@/lib/records";

type DisplaySettingOption<T extends string> = {
  value: T;
  label: string;
  mobileLabelParts: readonly string[];
  description: string;
};

const HAMSTER_SELECTOR_OPTIONS: readonly DisplaySettingOption<HamsterSelectorMode>[] = [
  {
    value: "combobox",
    label: "コンボボックス式",
    mobileLabelParts: ["コンボ", "ボックス式"],
    description: "文字入力で候補を絞り込みながら選択します。"
  },
  {
    value: "select",
    label: "プルダウン式",
    mobileLabelParts: ["プルダウン式"],
    description: "一覧から選択する形式で表示します。"
  }
];

const RECORD_SCOPE_OPTIONS: readonly DisplaySettingOption<RecordScope>[] = [
  {
    value: "hamster",
    label: "選択中のハムスター",
    mobileLabelParts: ["選択中の", "ハムスター"],
    description: "記録画面を開いたとき、選択した1匹の記録を表示します。"
  },
  {
    value: "household",
    label: "グループ全体",
    mobileLabelParts: ["グループ全体"],
    description: "記録画面を開いたとき、現在の共有グループに所属する全ハムスターの記録を表示します。"
  }
];

const CLEANING_DATE_FILTER_OPTIONS: readonly DisplaySettingOption<CleaningMobileDefaultDateFilter>[] = [
  {
    value: "today",
    label: "当日のみ",
    mobileLabelParts: ["当日のみ"],
    description: "衛生管理画面をスマートフォンで開いたとき、今日の入力欄だけを表示します。"
  },
  {
    value: "all",
    label: "すべての日付",
    mobileLabelParts: ["すべての日付"],
    description: "衛生管理画面をスマートフォンで開いたとき、その月の入力欄をすべて表示します。"
  }
];

function selectedOption<T extends string>(options: readonly DisplaySettingOption<T>[], value: T) {
  return options.find((option) => option.value === value) ?? options[0];
}

export function getDisplaySettingsSummary({
  hamsterSelectorMode,
  recordTimelineDefaultScope,
  cleaningMobileDefaultDateFilter
}: {
  hamsterSelectorMode: HamsterSelectorMode;
  recordTimelineDefaultScope: RecordScope;
  cleaningMobileDefaultDateFilter: CleaningMobileDefaultDateFilter;
}) {
  return [
    selectedOption(HAMSTER_SELECTOR_OPTIONS, hamsterSelectorMode).label,
    selectedOption(RECORD_SCOPE_OPTIONS, recordTimelineDefaultScope).label,
    selectedOption(CLEANING_DATE_FILTER_OPTIONS, cleaningMobileDefaultDateFilter).label
  ].join("・");
}

function ResponsiveRadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly DisplaySettingOption<T>[];
  onChange: (value: T) => void;
}) {
  const currentOption = selectedOption(options, value);

  return (
    <fieldset className="min-w-0 space-y-2 md:space-y-3">
      <legend className="text-sm font-bold text-ink md:text-base">{legend}</legend>
      <div className="grid min-w-0 grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 md:gap-3 md:rounded-md md:border md:border-slate-200 md:bg-slate-50 md:p-4">
        {options.map((option) => {
          const isSelected = option.value === value;

          return (
            <label
              key={option.value}
              className={`flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded-md border px-1.5 py-2 text-center text-[11px] leading-4 transition focus-within:outline-none focus-within:ring-2 focus-within:ring-moss/40 focus-within:ring-offset-1 min-[360px]:px-2 min-[360px]:text-xs md:min-h-0 md:items-start md:justify-start md:gap-3 md:border-slate-200 md:bg-white md:p-3 md:text-left md:text-sm md:font-normal md:text-slate-700 md:shadow-none md:ring-0 ${
                isSelected
                  ? "border-moss bg-moss/10 font-semibold text-ink shadow-sm ring-1 ring-inset ring-moss/20"
                  : "border-transparent bg-white font-medium text-slate-600"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={isSelected}
                onChange={() => onChange(option.value)}
                className="sr-only md:not-sr-only md:mt-0.5"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap justify-center gap-x-1 md:hidden">
                  {option.mobileLabelParts.map((part) => (
                    <span key={part} className="whitespace-nowrap">
                      {part}
                    </span>
                  ))}
                </span>
                <span className="hidden font-semibold text-ink md:block">{option.label}</span>
                <span className="mt-1 hidden text-xs leading-5 text-slate-500 md:block">
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-slate-500 md:hidden" data-selected-description={currentOption.value}>
        {currentOption.description}
      </p>
    </fieldset>
  );
}

type DisplaySettingsSectionProps = {
  hamsterSelectorMode: HamsterSelectorMode;
  recordTimelineDefaultScope: RecordScope;
  cleaningMobileDefaultDateFilter: CleaningMobileDefaultDateFilter;
};

export function DisplaySettingsSection({
  hamsterSelectorMode: initialHamsterSelectorMode,
  recordTimelineDefaultScope: initialRecordTimelineDefaultScope,
  cleaningMobileDefaultDateFilter: initialCleaningMobileDefaultDateFilter
}: DisplaySettingsSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hamsterSelectorMode, setHamsterSelectorMode] = useState(initialHamsterSelectorMode);
  const [recordTimelineDefaultScope, setRecordTimelineDefaultScope] = useState(
    initialRecordTimelineDefaultScope
  );
  const [cleaningMobileDefaultDateFilter, setCleaningMobileDefaultDateFilter] = useState(
    initialCleaningMobileDefaultDateFilter
  );
  const contentId = useId();
  const summary = getDisplaySettingsSummary({
    hamsterSelectorMode,
    recordTimelineDefaultScope,
    cleaningMobileDefaultDateFilter
  });

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white md:overflow-visible md:rounded-none md:border-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss md:hidden"
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold text-ink">画面表示の設定</span>
          <span
            className="mt-0.5 block break-words text-xs leading-5 text-slate-500"
            aria-live="polite"
            data-display-settings-summary
          >
            {summary}
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      <div
        id={contentId}
        data-display-settings-content
        data-mobile-open={isOpen}
        className={`${isOpen ? "block" : "hidden"} space-y-5 border-t border-slate-200 p-3 md:block md:border-0 md:p-0`}
      >
        <ResponsiveRadioGroup
          legend="ハムスター選択方式"
          name="hamsterSelectorMode"
          value={hamsterSelectorMode}
          options={HAMSTER_SELECTOR_OPTIONS}
          onChange={setHamsterSelectorMode}
        />
        <ResponsiveRadioGroup
          legend="記録画面の初期表示"
          name="recordTimelineDefaultScope"
          value={recordTimelineDefaultScope}
          options={RECORD_SCOPE_OPTIONS}
          onChange={setRecordTimelineDefaultScope}
        />
        <ResponsiveRadioGroup
          legend="衛生管理画面（スマホ）の初期表示"
          name="cleaningMobileDefaultDateFilter"
          value={cleaningMobileDefaultDateFilter}
          options={CLEANING_DATE_FILTER_OPTIONS}
          onChange={setCleaningMobileDefaultDateFilter}
        />
      </div>
    </section>
  );
}
