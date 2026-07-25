"use client";

import { RotateCcw } from "lucide-react";
import type { ChangeEvent } from "react";
import { useRef, useState } from "react";

import { isCompleteWeightChartRange } from "@/lib/weight-chart-filter";

type WeightChartFilterFormProps = {
  hamsterId: string;
  sortTarget: string;
  sortDirection: string;
  includeInactive: boolean;
  defaultFrom?: string;
  defaultTo?: string;
  maxDate: string;
  action?: string;
};

export function WeightChartFilterForm({
  hamsterId,
  sortTarget,
  sortDirection,
  includeInactive,
  defaultFrom = "",
  defaultTo = "",
  maxDate,
  action
}: WeightChartFilterFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function submitIfComplete(nextFrom: string, nextTo: string, event: ChangeEvent<HTMLInputElement>) {
    if (isCompleteWeightChartRange(nextFrom, nextTo)) {
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleFromChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFrom = event.currentTarget.value;
    setFrom(nextFrom);
    submitIfComplete(nextFrom, to, event);
  }

  function handleToChange(event: ChangeEvent<HTMLInputElement>) {
    const nextTo = event.currentTarget.value;
    setTo(nextTo);
    submitIfComplete(from, nextTo, event);
  }

  function handleClear() {
    setFrom("");
    setTo("");
    if (fromInputRef.current) fromInputRef.current.value = "";
    if (toInputRef.current) toInputRef.current.value = "";
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} method="get" action={action} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <input type="hidden" name="hamsterId" value={hamsterId} />
      <input type="hidden" name="filter" value="all" />
      <input type="hidden" name="sort" value={sortTarget} />
      <input type="hidden" name="direction" value={sortDirection} />
      {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-end">
        <span className="text-sm font-medium text-slate-700 sm:self-center">期間</span>
        <label className="w-full sm:min-w-[150px] sm:max-w-[200px] sm:flex-1">
          <span className="sr-only">開始日</span>
          <input
            ref={fromInputRef}
            type="date"
            name="chartFrom"
            value={from}
            max={to || maxDate}
            onChange={handleFromChange}
          />
        </label>
        <span className="text-center text-sm text-slate-500 sm:self-center sm:text-slate-600">～</span>
        <label className="w-full sm:min-w-[150px] sm:max-w-[200px] sm:flex-1">
          <span className="sr-only">終了日</span>
          <input
            ref={toInputRef}
            type="date"
            name="chartTo"
            value={to}
            min={from || undefined}
            max={maxDate}
            onChange={handleToChange}
          />
        </label>
        <span className="text-right text-sm text-slate-600 sm:self-center">まで</span>
        <button
          type="button"
          onClick={handleClear}
          disabled={!from && !to}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:w-auto"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          クリア
        </button>
      </div>
    </form>
  );
}
