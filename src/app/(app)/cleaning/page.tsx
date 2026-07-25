import { Save } from "lucide-react";

import { saveCleaningMonth } from "@/app/actions/cleaning";
import { AutoSubmitInput } from "@/components/auto-submit-input";
import { CleaningMobileDayFilter, CleaningMobileForm } from "@/components/cleaning-mobile-form";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { EmptyState } from "@/components/empty-state";
import { HamsterSelectorInput } from "@/components/hamster-selector-input";
import { StatusMessage } from "@/components/status-message";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { currentMonthInputJst, getDaysInMonth, isFutureDateInput, normalizeYearMonth, todayInputJst } from "@/lib/date";
import { getCleaningPageData } from "@/lib/queries";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CleaningPage({
  searchParams
}: {
  searchParams: Promise<{
    hamsterId?: string | string[];
    month?: string | string[];
    status?: string | string[];
    errorId?: string | string[];
    includeInactive?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);
  const yearMonth = normalizeYearMonth(getParam(params.month));
  const includeInactive = getParam(params.includeInactive) === "1";
  const { hamsters, selectedHamster, recordsByDate, hamsterSelectorMode } = await getCleaningPageData(
    getParam(params.hamsterId),
    yearMonth,
    includeInactive
  );
  const selectableHamsters = includeInactive ? hamsters : hamsters.filter((hamster) => hamster.isActive);
  const hasSelectableHamsters = selectableHamsters.length > 0;
  const days = getDaysInMonth(yearMonth);
  const currentMonth = currentMonthInputJst();
  const today = todayInputJst();
  const isLocked = selectedHamster ? !selectedHamster.isActive : false;
  const cleaningRecordsVersion = JSON.stringify(
    days.map((day) => {
      const record = recordsByDate.get(day.date);

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
        <p className="mt-1 text-sm text-slate-600">月ごとの掃除記録を表形式で入力します。</p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      {hamsters.length === 0 ? (
        canEdit ? <EmptyState title="先にハムスターを登録してください。" href="/hamsters" actionLabel="登録する" /> : (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            閲覧できるハムスターはまだ登録されていません。
          </p>
        )
      ) : (
        <>
          <form
            method="get"
            className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_180px_auto]"
          >
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              ハムスター
              <HamsterSelectorInput
                key={`${selectedHamster?.id ?? "none"}-${includeInactive ? "all" : "active"}`}
                mode={hamsterSelectorMode}
                name="hamsterId"
                selectedId={selectedHamster?.id ?? ""}
                options={selectableHamsters}
                disabled={!hasSelectableHamsters}
                emptyMessage="条件に一致するハムスターはいません"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              年月
              <AutoSubmitInput type="month" name="month" defaultValue={yearMonth} max={currentMonth} />
            </label>
            <CleaningMobileDayFilter key={`${selectedHamster?.id ?? "none"}-${yearMonth}`} days={days} />
            <label className="inline-flex h-10 items-center gap-2 self-end text-sm font-medium text-slate-700 lg:justify-end">
              <AutoSubmitInput type="checkbox" name="includeInactive" value="1" defaultChecked={includeInactive} />
              管理外も含む
            </label>
          </form>

          {!selectedHamster ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {hasSelectableHamsters
                ? "ハムスター名を入力するか候補から選択すると、掃除記録の入力表を表示します。"
                : "管理中のハムスターがいません。管理外も含む場合はチェックを入れてください。"}
            </p>
          ) : (
            <UnsavedChangesGuard>
              <div className="content-reveal space-y-4">
                {!canEdit ? (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    閲覧者は掃除記録を閲覧できますが、登録・更新・削除は実行できません。
                  </p>
                ) : isLocked ? (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    このハムスターは管理外のため、掃除記録の編集・保存はできません。
                  </p>
                ) : null}

                {/* レスポンシブ表示で同名入力を重複送信しないよう、PC用とスマホ用は別フォームにする。 */}
                <form
                  key={`cleaning-table-${selectedHamster.id}-${yearMonth}-${cleaningRecordsVersion}`}
                  action={canEdit ? saveCleaningMonth : undefined}
                  data-dirty-watch={canEdit ? true : undefined}
                  className="hidden space-y-4 lg:block"
                >
                  <input type="hidden" name="hamsterId" value={selectedHamster.id} />
                  <input type="hidden" name="yearMonth" value={yearMonth} />
                  {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}

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
                          const record = recordsByDate.get(day.date);
                          // 未来日は入力欄を無効化し、サーバー側の未来日拒否と画面表示を揃える。
                          const isFuture = isFutureDateInput(day.date);
                          const isUnavailable = isFuture || isLocked;
                          const isToday = day.date === today;

                          return (
                            <tr
                              key={day.date}
                              className={isToday ? "bg-straw/20" : isUnavailable ? "bg-slate-50 text-slate-400" : undefined}
                            >
                              <td className={`date-cell ${isToday ? "font-semibold text-ink" : "font-semibold text-slate-700"}`}>
                                {day.day}
                              </td>
                              <td className="weekday-cell text-slate-500">{day.weekday}</td>
                              <td className="checkbox-cell">
                                <input
                                  aria-label={`${day.date} トイレ掃除`}
                                  type="checkbox"
                                  name={`toilet_${day.date}`}
                                  defaultChecked={record?.toiletCleaned ?? false}
                                  disabled={isUnavailable}
                                  aria-disabled={!canEdit || undefined}
                                  tabIndex={canEdit ? undefined : -1}
                                  className={canEdit ? undefined : "pointer-events-none"}
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input
                                  aria-label={`${day.date} 砂場掃除`}
                                  type="checkbox"
                                  name={`bath_${day.date}`}
                                  defaultChecked={record?.bathCleaned ?? false}
                                  disabled={isUnavailable}
                                  aria-disabled={!canEdit || undefined}
                                  tabIndex={canEdit ? undefined : -1}
                                  className={canEdit ? undefined : "pointer-events-none"}
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input
                                  aria-label={`${day.date} 床材一部交換`}
                                  type="checkbox"
                                  name={`flooring_part_${day.date}`}
                                  defaultChecked={record?.flooringPartCleaned ?? false}
                                  disabled={isUnavailable}
                                  aria-disabled={!canEdit || undefined}
                                  tabIndex={canEdit ? undefined : -1}
                                  className={canEdit ? undefined : "pointer-events-none"}
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input
                                  aria-label={`${day.date} 床材全交換`}
                                  type="checkbox"
                                  name={`flooring_all_${day.date}`}
                                  defaultChecked={record?.flooringAllCleaned ?? false}
                                  disabled={isUnavailable}
                                  aria-disabled={!canEdit || undefined}
                                  tabIndex={canEdit ? undefined : -1}
                                  className={canEdit ? undefined : "pointer-events-none"}
                                />
                              </td>
                              <td className="checkbox-cell">
                                <input
                                  aria-label={`${day.date} ハウス掃除`}
                                  type="checkbox"
                                  name={`house_${day.date}`}
                                  defaultChecked={record?.houseCleaned ?? false}
                                  disabled={isUnavailable}
                                  aria-disabled={!canEdit || undefined}
                                  tabIndex={canEdit ? undefined : -1}
                                  className={canEdit ? undefined : "pointer-events-none"}
                                />
                              </td>
                              <td className="memo-cell">
                                <input
                                  name={`memo_${day.date}`}
                                  defaultValue={record?.memo ?? ""}
                                  placeholder={!canEdit ? "閲覧者は入力できません" : isLocked ? "管理外のため入力できません" : isFuture ? "未来日は入力できません" : "メモ"}
                                  disabled={isUnavailable}
                                  readOnly={!canEdit}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end">
                    {canEdit ? <DirtySubmitButton
                      disabled={isLocked}
                      className="inline-flex items-center gap-2 rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Save className="h-4 w-4" aria-hidden />
                      保存
                    </DirtySubmitButton> : null}
                  </div>
                </form>

                <CleaningMobileForm
                  key={`${selectedHamster.id}-${yearMonth}`}
                  days={days.map((day) => {
                    const record = recordsByDate.get(day.date);

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
                  hamsterId={selectedHamster.id}
                  includeInactive={includeInactive}
                  isLocked={isLocked}
                  readOnly={!canEdit}
                  recordsVersion={cleaningRecordsVersion}
                  yearMonth={yearMonth}
                />
              </div>
            </UnsavedChangesGuard>
          )}
        </>
      )}
    </div>
  );
}
