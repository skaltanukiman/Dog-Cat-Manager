"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";

import type { CleaningMobileDefaultDateFilter } from "@/lib/cleaning-settings";
import type { HamsterSelectorMode } from "@/lib/dashboard-settings";
import type { RecordScope } from "@/lib/records";

type DisplaySettingOption<T extends string> = {
  value: T;
  label: string;
  summaryLabel: string;
  mobileLabelParts: readonly string[];
  description: string;
};

const HAMSTER_SELECTOR_OPTIONS: readonly DisplaySettingOption<HamsterSelectorMode>[] = [
  {
    value: "combobox",
    label: "コンボボックス式",
    summaryLabel: "検索選択",
    mobileLabelParts: ["コンボ", "ボックス式"],
    description: "文字入力で候補を絞り込みながら選択します。"
  },
  {
    value: "select",
    label: "プルダウン式",
    summaryLabel: "プルダウン",
    mobileLabelParts: ["プルダウン式"],
    description: "一覧から選択する形式で表示します。"
  }
];

const RECORD_SCOPE_OPTIONS: readonly DisplaySettingOption<RecordScope>[] = [
  {
    value: "hamster",
    label: "選択中のハムスター",
    summaryLabel: "1匹表示",
    mobileLabelParts: ["選択中の", "ハムスター"],
    description: "記録画面を開いたとき、選択した1匹の記録を表示します。"
  },
  {
    value: "household",
    label: "グループ全体",
    summaryLabel: "グループ表示",
    mobileLabelParts: ["グループ全体"],
    description: "記録画面を開いたとき、現在の共有グループに所属する全ハムスターの記録を表示します。"
  }
];

const CLEANING_DATE_FILTER_OPTIONS: readonly DisplaySettingOption<CleaningMobileDefaultDateFilter>[] = [
  {
    value: "today",
    label: "当日のみ",
    summaryLabel: "当日のみ",
    mobileLabelParts: ["当日のみ"],
    description: "衛生管理画面をスマートフォンで開いたとき、今日の入力欄だけを表示します。"
  },
  {
    value: "all",
    label: "すべての日付",
    summaryLabel: "月全体",
    mobileLabelParts: ["すべての日付"],
    description: "衛生管理画面をスマートフォンで開いたとき、その月の入力欄をすべて表示します。"
  }
];

function selectedOption<T extends string>(options: readonly DisplaySettingOption<T>[], value: T) {
  return options.find((option) => option.value === value) ?? options[0];
}

export function getDisplaySettingsSummaryLabels({
  hamsterSelectorMode,
  recordTimelineDefaultScope,
  cleaningMobileDefaultDateFilter
}: {
  hamsterSelectorMode: HamsterSelectorMode;
  recordTimelineDefaultScope: RecordScope;
  cleaningMobileDefaultDateFilter: CleaningMobileDefaultDateFilter;
}) {
  return [
    selectedOption(HAMSTER_SELECTOR_OPTIONS, hamsterSelectorMode).summaryLabel,
    selectedOption(RECORD_SCOPE_OPTIONS, recordTimelineDefaultScope).summaryLabel,
    selectedOption(CLEANING_DATE_FILTER_OPTIONS, cleaningMobileDefaultDateFilter).summaryLabel
  ];
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
  const summaryLabels = getDisplaySettingsSummaryLabels({
    hamsterSelectorMode,
    recordTimelineDefaultScope,
    cleaningMobileDefaultDateFilter
  });

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-moss/20 bg-white shadow-sm md:overflow-visible md:rounded-none md:border-0 md:shadow-none">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        data-display-settings-toggle
        onClick={() => setIsOpen((current) => !current)}
        className="min-h-11 w-full bg-moss/5 p-3 text-left transition-colors hover:bg-moss/10 active:bg-moss/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss motion-reduce:transition-none md:hidden"
      >
        <span className="flex min-w-0 items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-moss/10 text-moss"
            data-display-settings-icon
          >
            <SlidersHorizontal className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-ink">画面の表示設定</span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-600">
              各画面の初期表示や選択方法を変更します。
            </span>
          </span>
        </span>

        <span
          className="mt-3 flex min-w-0 flex-wrap gap-1.5"
          data-display-settings-summary
        >
          {summaryLabels.map((label) => (
            <span
              key={label}
              className="max-w-full rounded-md border border-moss/20 bg-white px-2 py-1 text-xs font-medium leading-4 text-slate-700"
              data-display-settings-summary-chip
            >
              {label}
            </span>
          ))}
        </span>

        <span className="mt-3 flex items-center justify-end gap-1 text-sm font-bold text-moss">
          <span data-display-settings-action>{isOpen ? "閉じる" : "設定を変更"}</span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </span>
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
