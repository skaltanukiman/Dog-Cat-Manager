"use client";

import { useEffect, useState } from "react";

import { saveCleaningMonth } from "@/app/actions/cleaning";
import { MobileDirtySaveArea } from "@/components/mobile-dirty-save-area";

type CleaningMobileDayRecord = {
  toiletCleaned: boolean;
  bathCleaned: boolean;
  flooringPartCleaned: boolean;
  flooringAllCleaned: boolean;
  houseCleaned: boolean;
  memo: string | null;
};

type CleaningMobileDay = {
  date: string;
  day: number;
  weekday: string;
  isFuture: boolean;
  isToday: boolean;
  record: CleaningMobileDayRecord | null;
};

type CleaningMobileDayOption = {
  date: string;
  day: number;
  weekday: string;
};

type CleaningMobileFormProps = {
  days: CleaningMobileDay[];
  hamsterId: string;
  includeInactive: boolean;
  isLocked: boolean;
  initialSelectedDate?: string;
  readOnly?: boolean;
  recordsVersion: string;
  yearMonth: string;
};

const CLEANING_MOBILE_DAY_FILTER_EVENT = "cleaning-mobile-day-filter-change";

export function CleaningMobileDayFilter({
  days,
  initialSelectedDate = "all"
}: {
  days: CleaningMobileDayOption[];
  initialSelectedDate?: string;
}) {
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);

  function handleDateChange(value: string) {
    // 日付ナビと編集formは別コンポーネントなので、同じ選択日を維持するため画面内イベントで同期する。
    setSelectedDate(value);
    window.dispatchEvent(new CustomEvent(CLEANING_MOBILE_DAY_FILTER_EVENT, { detail: value }));
  }

  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700 lg:hidden">
      日付
      <select
        value={selectedDate}
        data-cleaning-selected-date={selectedDate}
        onChange={(event) => handleDateChange(event.currentTarget.value)}
      >
        <option value="all">すべての日付</option>
        {days.map((day) => (
          <option key={day.date} value={day.date}>
            {day.day}日（{day.weekday}）
          </option>
        ))}
      </select>
    </label>
  );
}

export function CleaningMobileForm({
  days,
  hamsterId,
  includeInactive,
  isLocked,
  initialSelectedDate = "all",
  readOnly = false,
  recordsVersion,
  yearMonth
}: CleaningMobileFormProps) {
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);

  useEffect(() => {
    function handleDayFilterChange(event: Event) {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        setSelectedDate(event.detail);
      }
    }

    window.addEventListener(CLEANING_MOBILE_DAY_FILTER_EVENT, handleDayFilterChange);

    return () => {
      window.removeEventListener(CLEANING_MOBILE_DAY_FILTER_EVENT, handleDayFilterChange);
    };
  }, []);

  return (
    <div className="space-y-4 lg:hidden" data-cleaning-selected-date={selectedDate}>
      <form
        key={`cleaning-mobile-${hamsterId}-${yearMonth}-${recordsVersion}`}
        id="cleaning-mobile-form"
        action={readOnly ? undefined : saveCleaningMonth}
        data-dirty-watch={readOnly ? undefined : true}
        className="space-y-4"
      >
        <input type="hidden" name="hamsterId" value={hamsterId} />
        <input type="hidden" name="yearMonth" value={yearMonth} />
        {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}

        <MobileDirtySaveArea disabled={isLocked || readOnly} formId="cleaning-mobile-form">
          <div className="grid gap-3">
            {days.map((day) => {
              const isUnavailable = day.isFuture || isLocked;
              const isVisible = selectedDate === "all" || selectedDate === day.date;

              return (
                <section
                  key={day.date}
                  data-cleaning-date={day.date}
                  data-cleaning-visible={isVisible}
                  className={`${isVisible ? "" : "hidden"} rounded-md border p-4 shadow-sm ${
                    day.isToday
                      ? "border-straw bg-straw/15"
                      : isUnavailable
                        ? "border-slate-200 bg-slate-50 text-slate-400"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-bold text-ink">{day.day}日</p>
                      <p className="text-xs text-slate-500">{day.weekday}曜日</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {day.isToday ? <span className="rounded-md bg-straw/70 px-2 py-1 text-xs font-semibold text-ink">今日</span> : null}
                      {day.isFuture ? (
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">未来日</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 min-[380px]:grid-cols-2">
                    <label className={`inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 ${readOnly ? "pointer-events-none" : ""}`}>
                      <input
                        aria-label={`${day.date} トイレ掃除`}
                        type="checkbox"
                        name={`toilet_${day.date}`}
                        defaultChecked={day.record?.toiletCleaned ?? false}
                        disabled={isUnavailable}
                        aria-disabled={readOnly || undefined}
                        tabIndex={readOnly ? -1 : undefined}
                      />
                      トイレ掃除
                    </label>
                    <label className={`inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 ${readOnly ? "pointer-events-none" : ""}`}>
                      <input
                        aria-label={`${day.date} 砂場掃除`}
                        type="checkbox"
                        name={`bath_${day.date}`}
                        defaultChecked={day.record?.bathCleaned ?? false}
                        disabled={isUnavailable}
                        aria-disabled={readOnly || undefined}
                        tabIndex={readOnly ? -1 : undefined}
                      />
                      砂場掃除
                    </label>
                    <label className={`inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 ${readOnly ? "pointer-events-none" : ""}`}>
                      <input
                        aria-label={`${day.date} 床材一部交換`}
                        type="checkbox"
                        name={`flooring_part_${day.date}`}
                        defaultChecked={day.record?.flooringPartCleaned ?? false}
                        disabled={isUnavailable}
                        aria-disabled={readOnly || undefined}
                        tabIndex={readOnly ? -1 : undefined}
                      />
                      床材一部交換
                    </label>
                    <label className={`inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 ${readOnly ? "pointer-events-none" : ""}`}>
                      <input
                        aria-label={`${day.date} 床材全交換`}
                        type="checkbox"
                        name={`flooring_all_${day.date}`}
                        defaultChecked={day.record?.flooringAllCleaned ?? false}
                        disabled={isUnavailable}
                        aria-disabled={readOnly || undefined}
                        tabIndex={readOnly ? -1 : undefined}
                      />
                      床材全交換
                    </label>
                    <label className={`inline-flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 min-[380px]:col-span-2 ${readOnly ? "pointer-events-none" : ""}`}>
                      <input
                        aria-label={`${day.date} ハウス掃除`}
                        type="checkbox"
                        name={`house_${day.date}`}
                        defaultChecked={day.record?.houseCleaned ?? false}
                        disabled={isUnavailable}
                        aria-disabled={readOnly || undefined}
                        tabIndex={readOnly ? -1 : undefined}
                      />
                      ハウス掃除
                    </label>
                  </div>

                  <label className="mt-3 grid gap-1 text-sm font-medium text-slate-700">
                    メモ
                    <input
                      name={`memo_${day.date}`}
                      defaultValue={day.record?.memo ?? ""}
                      placeholder={readOnly ? "閲覧者は入力できません" : isLocked ? "管理外のため入力できません" : day.isFuture ? "未来日は入力できません" : "メモ"}
                      disabled={isUnavailable}
                      readOnly={readOnly}
                    />
                  </label>
                </section>
              );
            })}
          </div>
        </MobileDirtySaveArea>
      </form>
    </div>
  );
}
