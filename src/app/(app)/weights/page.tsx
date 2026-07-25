import Link from "next/link";
import { Download, Plus, Upload } from "lucide-react";

import { createWeightRecord } from "@/app/actions/weights";
import { AutoSubmitInput } from "@/components/auto-submit-input";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { EmptyState } from "@/components/empty-state";
import { HamsterSelectorInput } from "@/components/hamster-selector-input";
import { PaginationLayout } from "@/components/pagination";
import { StatusMessage } from "@/components/status-message";
import { WeightChart } from "@/components/weight-chart";
import { WeightChartFilterForm } from "@/components/weight-chart-filter-form";
import { WeightDataManagementMenu } from "@/components/weight-data-management-menu";
import { WeightHistoryList } from "@/components/weight-history-list";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { toDateInputValue, todayInputJst } from "@/lib/date";
import { getWeightPageData } from "@/lib/queries";
import { normalizeWeightChartRange } from "@/lib/weight-chart-filter";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type FilterMode = "all" | "month";
type WeightSortTarget = "registered" | "date" | "weight";
type SortDirection = "asc" | "desc";

function normalizeFilterMode(value: string | undefined): FilterMode {
  return value === "month" ? "month" : "all";
}

function normalizeWeightSortTarget(value: string | undefined): WeightSortTarget {
  return value === "registered" || value === "weight" ? value : "date";
}

function normalizeSortDirection(value: string | undefined): SortDirection {
  return value === "asc" ? "asc" : "desc";
}

function normalizePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function isYearMonthInput(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function formatYearMonthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split("-");
  return `${year}年${Number(month)}月`;
}

function buildWeightsHref({
  hamsterId,
  filterMode,
  month,
  chartFrom,
  chartTo,
  page,
  sortTarget,
  sortDirection,
  includeInactive
}: {
  hamsterId: string;
  filterMode: FilterMode;
  month: string;
  chartFrom?: string;
  chartTo?: string;
  page: number;
  sortTarget: WeightSortTarget;
  sortDirection: SortDirection;
  includeInactive: boolean;
}) {
  const params = new URLSearchParams({ hamsterId });

  if (filterMode === "month") {
    params.set("filter", "month");
    if (month) {
      params.set("month", month);
    }
  }

  if (chartFrom) {
    params.set("chartFrom", chartFrom);
  }

  if (chartTo) {
    params.set("chartTo", chartTo);
  }

  if (sortTarget !== "date") {
    params.set("sort", sortTarget);
  }

  if (sortDirection !== "desc") {
    params.set("direction", sortDirection);
  }

  if (includeInactive) {
    params.set("includeInactive", "1");
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  return `/weights?${params.toString()}`;
}

export default async function WeightsPage({
  searchParams
}: {
  searchParams: Promise<{
    hamsterId?: string | string[];
    status?: string | string[];
    errorId?: string | string[];
    filter?: string | string[];
    month?: string | string[];
    chartFrom?: string | string[];
    chartTo?: string | string[];
    page?: string | string[];
    sort?: string | string[];
    direction?: string | string[];
    includeInactive?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);
  const filterMode = normalizeFilterMode(getParam(params.filter));
  const requestedMonth = getParam(params.month);
  const chartRange = normalizeWeightChartRange(getParam(params.chartFrom), getParam(params.chartTo));
  const requestedPage = normalizePage(getParam(params.page));
  const sortTarget = normalizeWeightSortTarget(getParam(params.sort));
  const sortDirection = normalizeSortDirection(getParam(params.direction));
  const includeInactive = getParam(params.includeInactive) === "1";
  const { hamsters, selectedHamster, hamsterSelectorMode, records, chartRecords, monthOptions, selectedMonth, pagination } =
    await getWeightPageData({
      selectedHamsterId: getParam(params.hamsterId),
      filterMode,
      month: isYearMonthInput(requestedMonth) ? requestedMonth : undefined,
      chartFrom: chartRange.from,
      chartTo: chartRange.to,
      page: requestedPage,
      sortTarget,
      sortDirection,
      includeInactive
    });
  const selectableHamsters = includeInactive ? hamsters : hamsters.filter((hamster) => hamster.isActive);
  const hasSelectableHamsters = selectableHamsters.length > 0;
  const monthSelectOptions =
    selectedMonth && !monthOptions.includes(selectedMonth) ? [selectedMonth, ...monthOptions] : monthOptions;

  const chartData = chartRecords.map((record) => ({
    date: toDateInputValue(record.recordDate),
    weightG: record.weightG
  }));
  const today = todayInputJst();
  const isLocked = selectedHamster ? !selectedHamster.isActive : false;
  const hasWeightRecords = monthOptions.length > 0;
  const buildWeightPageHref = (page: number) => {
    if (!selectedHamster) return "/weights";

    return buildWeightsHref({
      hamsterId: selectedHamster.id,
      filterMode,
      month: selectedMonth,
      chartFrom: chartRange.from,
      chartTo: chartRange.to,
      page,
      sortTarget,
      sortDirection,
      includeInactive
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 md:flex-none">
          <h2 className="text-xl font-bold text-ink">体重管理</h2>
          <p className="mt-1 text-sm text-slate-600">日付ごとの体重を登録し、推移を確認します。</p>
        </div>
        <WeightDataManagementMenu canEdit={canEdit} />
        <div className="hidden flex-wrap gap-2 sm:flex">
          <Link
            href="/weights/export"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-moss bg-white px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white"
          >
            <Download className="h-4 w-4" aria-hidden />
            CSVエクスポート
          </Link>
          {canEdit ? <Link
            href="/weights/import"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-moss bg-white px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white"
          >
            <Upload className="h-4 w-4" aria-hidden />
            CSVインポート
          </Link> : null}
        </div>
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
          <form method="get" className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_auto]">
            <input type="hidden" name="filter" value={filterMode} />
            {selectedMonth ? <input type="hidden" name="month" value={selectedMonth} /> : null}
            {chartRange.from ? <input type="hidden" name="chartFrom" value={chartRange.from} /> : null}
            {chartRange.to ? <input type="hidden" name="chartTo" value={chartRange.to} /> : null}
            <input type="hidden" name="sort" value={sortTarget} />
            <input type="hidden" name="direction" value={sortDirection} />
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
            <label className="inline-flex h-10 items-center gap-2 self-end text-sm font-medium text-slate-700 md:justify-end">
              <AutoSubmitInput type="checkbox" name="includeInactive" value="1" defaultChecked={includeInactive} />
              管理外も含む
            </label>
          </form>

          {!selectedHamster ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {hasSelectableHamsters
                ? canEdit
                  ? "ハムスター名を入力するか候補から選択すると、体重登録フォームと履歴を表示します。"
                  : "ハムスター名を入力するか候補から選択すると、体重履歴とグラフを表示します。"
                : "管理中のハムスターがいません。管理外も含む場合はチェックを入れてください。"}
            </p>
          ) : (
            <div className="content-reveal space-y-6">
              {!canEdit ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  閲覧者は体重記録・グラフを閲覧できますが、登録・編集・削除、CSVインポートは実行できません。
                </p>
              ) : isLocked ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  このハムスターは管理外のため、体重記録の登録・編集・削除はできません。
                </p>
              ) : null}

          <section className={canEdit ? "grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]" : "grid gap-4"}>
            {canEdit ? <form action={createWeightRecord} data-dirty-watch className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <input type="hidden" name="hamsterId" value={selectedHamster.id} />
              <input type="hidden" name="filter" value={filterMode} />
              {selectedMonth ? <input type="hidden" name="month" value={selectedMonth} /> : null}
              {chartRange.from ? <input type="hidden" name="chartFrom" value={chartRange.from} /> : null}
              {chartRange.to ? <input type="hidden" name="chartTo" value={chartRange.to} /> : null}
              <input type="hidden" name="sort" value={sortTarget} />
              <input type="hidden" name="direction" value={sortDirection} />
              {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
              <h3 className="text-base font-bold text-ink">体重登録</h3>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  日付
                  <input type="date" name="recordDate" defaultValue={today} max={today} required disabled={isLocked} />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  体重(g)
                  <input type="number" name="weightG" min="1" max="500" step="0.1" required placeholder="38.5" disabled={isLocked} />
                </label>
                <button
                  type="submit"
                  disabled={isLocked}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  登録
                </button>
              </div>
            </form> : null}

            <section>
              <h3 className="mb-3 text-base font-bold text-ink">{selectedHamster.name} の体重推移</h3>
              <WeightChart
                data={chartData}
                emptyMessage={
                  filterMode === "all" && (chartRange.from || chartRange.to)
                    ? "指定した期間の体重記録はありません。"
                    : undefined
                }
              />
            </section>
          </section>

          {filterMode === "all" && hasWeightRecords ? (
            <section className="space-y-3">
              <h3 className="text-base font-bold text-ink">グラフの絞り込み</h3>
              <WeightChartFilterForm
                key={`${chartRange.from ?? ""}-${chartRange.to ?? ""}`}
                hamsterId={selectedHamster.id}
                sortTarget={sortTarget}
                sortDirection={sortDirection}
                includeInactive={includeInactive}
                defaultFrom={chartRange.from}
                defaultTo={chartRange.to}
                maxDate={today}
              />
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-base font-bold text-ink">体重履歴</h3>
            {hasWeightRecords ? (
              <form
                method="get"
                className={`grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm ${
                  filterMode === "month"
                    ? "sm:grid-cols-[160px_180px_160px_160px]"
                    : "sm:grid-cols-[160px_160px_160px]"
                }`}
              >
                <input type="hidden" name="hamsterId" value={selectedHamster.id} />
                {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
                {chartRange.from ? <input type="hidden" name="chartFrom" value={chartRange.from} /> : null}
                {chartRange.to ? <input type="hidden" name="chartTo" value={chartRange.to} /> : null}
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  表示
                  <AutoSubmitSelect name="filter" defaultValue={filterMode}>
                    <option value="all">全件</option>
                    <option value="month">月ごと</option>
                  </AutoSubmitSelect>
                </label>
                {filterMode === "month" ? (
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    対象月
                    <AutoSubmitSelect name="month" defaultValue={selectedMonth} disabled={monthSelectOptions.length === 0}>
                      {monthSelectOptions.map((yearMonth) => (
                        <option key={yearMonth} value={yearMonth}>
                          {formatYearMonthLabel(yearMonth)}
                          {monthOptions.includes(yearMonth) ? "" : "（記録なし）"}
                        </option>
                      ))}
                    </AutoSubmitSelect>
                  </label>
                ) : null}
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  並び対象
                  <AutoSubmitSelect name="sort" defaultValue={sortTarget}>
                    <option value="registered">登録順</option>
                    <option value="date">日付</option>
                    <option value="weight">体重</option>
                  </AutoSubmitSelect>
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  並び順
                  <AutoSubmitSelect name="direction" defaultValue={sortDirection}>
                    <option value="asc">昇順</option>
                    <option value="desc">降順</option>
                  </AutoSubmitSelect>
                </label>
              </form>
            ) : null}
            {hasWeightRecords ? (
              <PaginationLayout
                ariaLabel="体重履歴のページ移動"
                pagination={pagination}
                visibleCount={records.length}
                buildHref={buildWeightPageHref}
                scroll={false}
                preserveScroll
              />
            ) : null}
            {!hasWeightRecords ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                体重記録がまだありません。
              </div>
            ) : records.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                選択した月の体重記録はありません。
              </div>
            ) : (
              <WeightHistoryList
                // ページや絞り込み条件が変わったとき、前の削除選択が残らないように再生成する。
                key={[
                  selectedHamster.id,
                  filterMode,
                  selectedMonth,
                  sortTarget,
                  sortDirection,
                  pagination.currentPage,
                  records
                    .map((record) => `${record.id}:${toDateInputValue(record.recordDate)}:${record.weightG}`)
                    .join(",")
                ].join(":")}
                records={records.map((record) => ({
                  id: record.id,
                  recordDate: toDateInputValue(record.recordDate),
                  weightG: record.weightG
                }))}
                selectedHamsterId={selectedHamster.id}
                filterMode={filterMode}
                selectedMonth={selectedMonth}
                sortTarget={sortTarget}
                sortDirection={sortDirection}
                currentPage={pagination.currentPage}
                includeInactive={includeInactive}
                chartFrom={chartRange.from}
                chartTo={chartRange.to}
                today={today}
                isLocked={isLocked}
                readOnly={!canEdit}
              />
            )}
            {hasWeightRecords && pagination.totalPages > 1 ? (
              <PaginationLayout
                ariaLabel="体重履歴のページ移動"
                pagination={pagination}
                visibleCount={records.length}
                buildHref={buildWeightPageHref}
                scroll={false}
                preserveScroll
              />
            ) : null}
          </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
