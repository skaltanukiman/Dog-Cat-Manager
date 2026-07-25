import { AutoSubmitInput } from "@/components/auto-submit-input";
import { CleaningMobileDayFilter, CleaningMobileForm } from "@/components/cleaning-mobile-form";
import { DemoUnavailable } from "@/components/demo-unavailable";
import { HamsterSelectorInput } from "@/components/hamster-selector-input";
import {
  currentMonthInputJst,
  getDaysInMonth,
  isFutureDateInput,
  normalizeYearMonth,
  todayInputJst
} from "@/lib/date";
import { getPublicDemoCleaningPageData } from "@/lib/public-demo-queries";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DemoCleaningPage({
  searchParams
}: {
  searchParams: Promise<{
    hamsterId?: string | string[];
    month?: string | string[];
    includeInactive?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const yearMonth = normalizeYearMonth(getParam(params.month));
  const includeInactive = getParam(params.includeInactive) === "1";
  const data = await getPublicDemoCleaningPageData(getParam(params.hamsterId), yearMonth, includeInactive);
  if (!data) return <DemoUnavailable />;

  const selectableHamsters = includeInactive
    ? data.hamsters
    : data.hamsters.filter((hamster) => hamster.isActive);
  const days = getDaysInMonth(yearMonth);
  const today = todayInputJst();
  const recordsVersion = JSON.stringify(
    days.map((day) => {
      const record = data.recordsByDate.get(day.date);
      return [
        day.date,
        record?.toiletCleaned ? "1" : "0",
        record?.bathCleaned ? "1" : "0",
        record?.flooringPartCleaned ? "1" : "0",
        record?.flooringAllCleaned ? "1" : "0",
        record?.houseCleaned ? "1" : "0",
        record?.memo ?? ""
      ];
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">衛生管理</h2>
        <p className="mt-1 text-sm text-slate-600">月ごとの掃除記録を表とカードで閲覧できます。</p>
      </div>
      <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        サンプル閲覧モードでは、掃除記録の登録・更新・削除や保存はできません。
      </p>

      <form
        method="get"
        action="/demo/cleaning"
        className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_180px_auto]"
      >
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          ハムスター
          <HamsterSelectorInput
            key={`${data.selectedHamster?.id ?? "none"}-${includeInactive ? "all" : "active"}`}
            mode="select"
            name="hamsterId"
            selectedId={data.selectedHamster?.id ?? ""}
            options={selectableHamsters}
            disabled={selectableHamsters.length === 0}
            showEmptyOption={false}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          年月
          <AutoSubmitInput type="month" name="month" defaultValue={yearMonth} max={currentMonthInputJst()} />
        </label>
        <CleaningMobileDayFilter key={`${data.selectedHamster?.id ?? "none"}-${yearMonth}`} days={days} />
        <label className="inline-flex h-10 items-center gap-2 self-end text-sm font-medium text-slate-700 lg:justify-end">
          <AutoSubmitInput type="checkbox" name="includeInactive" value="1" defaultChecked={includeInactive} />
          管理外も含む
        </label>
      </form>

      {!data.selectedHamster ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          条件に一致するハムスターはいません。
        </p>
      ) : (
        <div className="content-reveal space-y-4">
          <div className="hidden lg:block">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="date-cell">日付</th>
                    <th className="weekday-cell">曜日</th>
                    <th className="checkbox-cell">トイレ掃除</th>
                    <th className="checkbox-cell">砂場掃除</th>
                    <th className="checkbox-cell">床材一部交換</th>
                    <th className="checkbox-cell">床材全交換</th>
                    <th className="checkbox-cell">ハウス掃除</th>
                    <th className="memo-cell">メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => {
                    const record = data.recordsByDate.get(day.date);
                    const isFuture = isFutureDateInput(day.date);
                    const isToday = day.date === today;
                    return (
                      <tr
                        key={day.date}
                        className={isToday ? "bg-straw/20" : isFuture ? "bg-slate-50 text-slate-400" : undefined}
                      >
                        <td className={`date-cell ${isToday ? "font-semibold text-ink" : "font-semibold text-slate-700"}`}>
                          {day.day}
                        </td>
                        <td className="weekday-cell text-slate-500">{day.weekday}</td>
                        {[
                          ["トイレ掃除", record?.toiletCleaned],
                          ["砂場掃除", record?.bathCleaned],
                          ["床材一部交換", record?.flooringPartCleaned],
                          ["床材全交換", record?.flooringAllCleaned],
                          ["ハウス掃除", record?.houseCleaned]
                        ].map(([label, checked]) => (
                          <td key={String(label)} className="checkbox-cell">
                            <input
                              aria-label={`${day.date} ${label}`}
                              type="checkbox"
                              checked={Boolean(checked)}
                              disabled
                              readOnly
                            />
                          </td>
                        ))}
                        <td className="memo-cell">
                          <input value={record?.memo ?? ""} readOnly aria-label={`${day.date} メモ`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <CleaningMobileForm
            key={`${data.selectedHamster.id}-${yearMonth}`}
            days={days.map((day) => {
              const record = data.recordsByDate.get(day.date);
              return {
                ...day,
                isFuture: isFutureDateInput(day.date),
                isToday: day.date === today,
                record: record
                  ? {
                      toiletCleaned: record.toiletCleaned,
                      bathCleaned: record.bathCleaned,
                      flooringPartCleaned: record.flooringPartCleaned,
                      flooringAllCleaned: record.flooringAllCleaned,
                      houseCleaned: record.houseCleaned,
                      memo: record.memo
                    }
                  : null
              };
            })}
            hamsterId={data.selectedHamster.id}
            includeInactive={includeInactive}
            isLocked={!data.selectedHamster.isActive}
            readOnly
            recordsVersion={recordsVersion}
            yearMonth={yearMonth}
          />
        </div>
      )}
    </div>
  );
}
