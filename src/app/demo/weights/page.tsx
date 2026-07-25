import { AutoSubmitInput } from "@/components/auto-submit-input";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { DemoUnavailable } from "@/components/demo-unavailable";
import { HamsterSelectorInput } from "@/components/hamster-selector-input";
import { PaginationLayout } from "@/components/pagination";
import { WeightChart } from "@/components/weight-chart";
import { WeightChartFilterForm } from "@/components/weight-chart-filter-form";
import { WeightHistoryList } from "@/components/weight-history-list";
import { toDateInputValue, todayInputJst } from "@/lib/date";
import { getPublicDemoWeightPageData } from "@/lib/public-demo-queries";
import { normalizeWeightChartRange } from "@/lib/weight-chart-filter";

export const dynamic = "force-dynamic";

type FilterMode = "all" | "month";
type WeightSortTarget = "registered" | "date" | "weight";
type SortDirection = "asc" | "desc";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeFilterMode(value: string | undefined): FilterMode {
  return value === "month" ? "month" : "all";
}

function normalizeSortTarget(value: string | undefined): WeightSortTarget {
  return value === "registered" || value === "weight" ? value : "date";
}

function normalizeSortDirection(value: string | undefined): SortDirection {
  return value === "asc" ? "asc" : "desc";
}

function normalizePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function isYearMonth(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
}

function formatYearMonth(yearMonth: string) {
  const [year, month] = yearMonth.split("-");
  return `${year}年${Number(month)}月`;
}

function buildDemoWeightsHref({
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
    if (month) params.set("month", month);
  }
  if (chartFrom) params.set("chartFrom", chartFrom);
  if (chartTo) params.set("chartTo", chartTo);
  if (sortTarget !== "date") params.set("sort", sortTarget);
  if (sortDirection !== "desc") params.set("direction", sortDirection);
  if (includeInactive) params.set("includeInactive", "1");
  if (page > 1) params.set("page", String(page));
  return `/demo/weights?${params.toString()}`;
}

export default async function DemoWeightsPage({
  searchParams
}: {
  searchParams: Promise<{
    hamsterId?: string | string[];
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
  const filterMode = normalizeFilterMode(getParam(params.filter));
  const requestedMonth = getParam(params.month);
  const chartRange = normalizeWeightChartRange(getParam(params.chartFrom), getParam(params.chartTo));
  const sortTarget = normalizeSortTarget(getParam(params.sort));
  const sortDirection = normalizeSortDirection(getParam(params.direction));
  const includeInactive = getParam(params.includeInactive) === "1";
  const data = await getPublicDemoWeightPageData({
    selectedHamsterId: getParam(params.hamsterId),
    filterMode,
    month: isYearMonth(requestedMonth) ? requestedMonth : undefined,
    chartFrom: chartRange.from,
    chartTo: chartRange.to,
    page: normalizePage(getParam(params.page)),
    sortTarget,
    sortDirection,
    includeInactive
  });
  if (!data) return <DemoUnavailable />;

  const selectableHamsters = includeInactive
    ? data.hamsters
    : data.hamsters.filter((hamster) => hamster.isActive);
  const monthOptions =
    data.selectedMonth && !data.monthOptions.includes(data.selectedMonth)
      ? [data.selectedMonth, ...data.monthOptions]
      : data.monthOptions;
  const chartData = data.chartRecords.map((record) => ({
    date: toDateInputValue(record.recordDate),
    weightG: record.weightG
  }));
  const today = todayInputJst();
  const hasWeightRecords = data.monthOptions.length > 0;
  const buildPageHref = (page: number) =>
    data.selectedHamster
      ? buildDemoWeightsHref({
          hamsterId: data.selectedHamster.id,
          filterMode,
          month: data.selectedMonth,
          chartFrom: chartRange.from,
          chartTo: chartRange.to,
          page,
          sortTarget,
          sortDirection,
          includeInactive
        })
      : "/demo/weights";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">体重管理</h2>
        <p className="mt-1 text-sm text-slate-600">体重の推移と履歴を期間・月・並び順で閲覧できます。</p>
      </div>
      <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        サンプル閲覧モードでは、体重の登録・編集・削除、CSV入出力はできません。
      </p>

      <form
        method="get"
        action="/demo/weights"
        className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_auto]"
      >
        <input type="hidden" name="filter" value={filterMode} />
        {data.selectedMonth ? <input type="hidden" name="month" value={data.selectedMonth} /> : null}
        {chartRange.from ? <input type="hidden" name="chartFrom" value={chartRange.from} /> : null}
        {chartRange.to ? <input type="hidden" name="chartTo" value={chartRange.to} /> : null}
        <input type="hidden" name="sort" value={sortTarget} />
        <input type="hidden" name="direction" value={sortDirection} />
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
        <label className="inline-flex h-10 items-center gap-2 self-end text-sm font-medium text-slate-700 md:justify-end">
          <AutoSubmitInput type="checkbox" name="includeInactive" value="1" defaultChecked={includeInactive} />
          管理外も含む
        </label>
      </form>

      {!data.selectedHamster ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          条件に一致するハムスターはいません。
        </p>
      ) : (
        <div className="content-reveal space-y-6">
          <section>
            <h3 className="mb-3 text-base font-bold text-ink">{data.selectedHamster.name} の体重推移</h3>
            <WeightChart
              data={chartData}
              emptyMessage={
                filterMode === "all" && (chartRange.from || chartRange.to)
                  ? "指定した期間の体重記録はありません。"
                  : undefined
              }
            />
          </section>

          {filterMode === "all" && hasWeightRecords ? (
            <section className="space-y-3">
              <h3 className="text-base font-bold text-ink">グラフの絞り込み</h3>
              <WeightChartFilterForm
                key={`${chartRange.from ?? ""}-${chartRange.to ?? ""}`}
                hamsterId={data.selectedHamster.id}
                sortTarget={sortTarget}
                sortDirection={sortDirection}
                includeInactive={includeInactive}
                defaultFrom={chartRange.from}
                defaultTo={chartRange.to}
                maxDate={today}
                action="/demo/weights"
              />
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-base font-bold text-ink">体重履歴</h3>
            {hasWeightRecords ? (
              <form
                method="get"
                action="/demo/weights"
                className={`grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm ${
                  filterMode === "month"
                    ? "sm:grid-cols-[160px_180px_160px_160px]"
                    : "sm:grid-cols-[160px_160px_160px]"
                }`}
              >
                <input type="hidden" name="hamsterId" value={data.selectedHamster.id} />
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
                    <AutoSubmitSelect name="month" defaultValue={data.selectedMonth}>
                      {monthOptions.map((yearMonth) => (
                        <option key={yearMonth} value={yearMonth}>
                          {formatYearMonth(yearMonth)}
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
                pagination={data.pagination}
                visibleCount={data.records.length}
                buildHref={buildPageHref}
                scroll={false}
                preserveScroll
              />
            ) : null}

            {!hasWeightRecords ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                体重記録がまだありません。
              </div>
            ) : data.records.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                選択した月の体重記録はありません。
              </div>
            ) : (
              <WeightHistoryList
                key={[
                  data.selectedHamster.id,
                  filterMode,
                  data.selectedMonth,
                  sortTarget,
                  sortDirection,
                  data.pagination.currentPage
                ].join(":")}
                records={data.records.map((record) => ({
                  id: record.id,
                  recordDate: toDateInputValue(record.recordDate),
                  weightG: record.weightG
                }))}
                selectedHamsterId={data.selectedHamster.id}
                filterMode={filterMode}
                selectedMonth={data.selectedMonth}
                sortTarget={sortTarget}
                sortDirection={sortDirection}
                currentPage={data.pagination.currentPage}
                includeInactive={includeInactive}
                chartFrom={chartRange.from}
                chartTo={chartRange.to}
                today={today}
                isLocked={!data.selectedHamster.isActive}
                readOnly
              />
            )}
            {hasWeightRecords && data.pagination.totalPages > 1 ? (
              <PaginationLayout
                ariaLabel="体重履歴のページ移動"
                pagination={data.pagination}
                visibleCount={data.records.length}
                buildHref={buildPageHref}
                scroll={false}
                preserveScroll
              />
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
