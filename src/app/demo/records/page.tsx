import Link from "next/link";

import { AutoSubmitFilterForm, FilterClearButton } from "@/components/auto-submit-filter-form";
import { DemoUnavailable } from "@/components/demo-unavailable";
import { DemoRecordCreateFormsPreview } from "@/components/demo-record-create-forms-preview";
import { HamsterSelectorInput } from "@/components/hamster-selector-input";
import { PaginationLayout } from "@/components/pagination";
import { RecordKeywordInput } from "@/components/record-keyword-input";
import { RecordTimeline } from "@/components/record-timeline";
import { todayInputJst } from "@/lib/date";
import { getPublicDemoRecordsPageData } from "@/lib/public-demo-queries";
import {
  normalizeRecordDateFilter,
  normalizeRecordKeyword,
  normalizeRecordPage,
  normalizeRecordTypeFilter,
  recordsUrl,
  type RecordTypeFilter,
  type RecordsUrlOptions
} from "@/lib/records";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const typeTabs: Array<{ value: RecordTypeFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "health", label: "健康・体調" },
  { value: "medical", label: "通院" },
  { value: "memory", label: "思い出" }
];

function demoRecordsUrl(options: RecordsUrlOptions = {}) {
  return recordsUrl({ ...options, basePath: "/demo/records" });
}

export default async function DemoRecordsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedHamsterId = getParam(params.hamsterId) ?? "";
  const filters = {
    hamsterId: requestedHamsterId,
    type: normalizeRecordTypeFilter(getParam(params.type)),
    from: normalizeRecordDateFilter(getParam(params.from)),
    to: normalizeRecordDateFilter(getParam(params.to)),
    keyword: normalizeRecordKeyword(getParam(params.keyword)),
    favoriteOnly: getParam(params.favorite) === "1",
    page: normalizeRecordPage(getParam(params.page))
  };
  const data = await getPublicDemoRecordsPageData({
    selectedHamsterId: filters.hamsterId,
    hasScopeParam: Object.prototype.hasOwnProperty.call(params, "scope"),
    scopeParam: getParam(params.scope),
    recordType: filters.type,
    from: filters.from,
    to: filters.to,
    keyword: filters.keyword,
    favoriteOnly: filters.favoriteOnly,
    page: filters.page
  });
  if (!data) return <DemoUnavailable />;

  const selectedHamsterId = data.selectedHamster?.id ?? "";
  const currentFilters = {
    ...filters,
    scope: data.scope,
    hamsterId: selectedHamsterId,
    page: data.pagination.currentPage
  };
  const today = todayInputJst();
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const buildPageHref = (page: number) =>
    demoRecordsUrl({ ...currentFilters, includeScope: true, page });

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-sm font-semibold text-moss">健康と大切な時間をひとつの年表に</p>
        <h2 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">記録</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          健康・通院・思い出のサンプル記録を、種類や期間で絞り込んで閲覧できます。
        </p>
      </header>

      {data.hamsters.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          サンプル記録はまだありません。
        </p>
      ) : (
        <>
          <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid gap-2 border-b border-slate-200 pb-4">
              <p className="text-sm font-semibold text-slate-700">タイムラインの表示範囲</p>
              <nav
                className="grid grid-cols-2 gap-2 sm:inline-grid sm:w-fit sm:gap-0.5 sm:rounded-lg sm:bg-slate-100 sm:p-1 sm:ring-1 sm:ring-inset sm:ring-slate-200"
                aria-label="タイムラインの表示範囲"
              >
                {([
                  { scope: "hamster", label: "選択中のハムスター" },
                  { scope: "household", label: "グループ全体" }
                ] as const).map((option) => (
                  <Link
                    key={option.scope}
                    href={demoRecordsUrl({
                      ...currentFilters,
                      scope: option.scope,
                      includeScope: true,
                      page: 1
                    })}
                    scroll={false}
                    aria-current={data.scope === option.scope ? "page" : undefined}
                    className={`min-w-0 whitespace-nowrap rounded-full border px-1.5 py-2 text-center text-xs font-semibold sm:rounded-md sm:border-0 sm:px-3 sm:text-sm ${
                      data.scope === option.scope
                        ? "border-moss bg-moss text-white sm:shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-moss hover:text-moss sm:bg-transparent"
                    }`}
                  >
                    {option.label}
                  </Link>
                ))}
              </nav>
            </div>
            <AutoSubmitFilterForm
              action="/demo/records"
              ignoreFieldNames={["hamsterId"]}
              className="grid gap-4"
            >
              <input type="hidden" name="scope" value={data.scope} />
              <input type="hidden" name="type" value={filters.type} />
              <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  対象ハムスター
                  <HamsterSelectorInput
                    mode="select"
                    name="hamsterId"
                    selectedId={selectedHamsterId}
                    options={data.hamsters}
                    showEmptyOption={false}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  開始日
                  <input type="date" name="from" defaultValue={filters.from} max={today} />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  終了日
                  <input type="date" name="to" defaultValue={filters.to} max={today} />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  キーワード
                  <RecordKeywordInput
                    name="keyword"
                    defaultValue={filters.keyword}
                    tagSuggestions={data.tagSuggestions}
                  />
                </label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 md:mt-6">
                  <input type="checkbox" name="favorite" value="1" defaultChecked={filters.favoriteOnly} />
                  お気に入りの思い出のみ
                </label>
              </div>
              {invalidRange ? (
                <p className="text-sm text-red-600">開始日は終了日以前の日付を指定してください。</p>
              ) : null}
              <div>
                <FilterClearButton
                  fieldNames={["from", "to", "keyword", "favorite"]}
                  className="text-sm font-semibold text-moss hover:underline"
                >
                  絞り込みをクリア
                </FilterClearButton>
              </div>
            </AutoSubmitFilterForm>
          </section>

          <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
            サンプル閲覧モードではデータを変更できません。
          </p>

          <DemoRecordCreateFormsPreview today={today} />

          <section className="grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h3 className="text-xl font-bold text-ink">
                {data.scope === "household" ? "グループ全体のタイムライン" : "共通タイムライン"}
              </h3>
              <nav className="flex flex-wrap gap-2" aria-label="記録種類の切り替え">
                {typeTabs.map((tab) => (
                  <Link
                    key={tab.value}
                    href={demoRecordsUrl({
                      ...currentFilters,
                      includeScope: true,
                      type: tab.value,
                      page: 1
                    })}
                    scroll={false}
                    aria-current={filters.type === tab.value ? "page" : undefined}
                    className={`rounded-full border px-3 py-2 text-sm font-semibold ${
                      filters.type === tab.value
                        ? "border-moss bg-moss text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-moss hover:text-moss"
                    }`}
                  >
                    {tab.label}
                  </Link>
                ))}
              </nav>
            </div>
            <PaginationLayout
              ariaLabel="記録一覧のページ移動"
              pagination={data.pagination}
              visibleCount={data.records.length}
              buildHref={buildPageHref}
              scroll={false}
              preserveScroll
            />
            <RecordTimeline
              records={data.records}
              scope={data.scope}
              returnHamsterId={selectedHamsterId}
              canEdit={false}
              today={today}
              basePath="/demo/records"
            />
            <PaginationLayout
              ariaLabel="記録一覧のページ移動"
              pagination={data.pagination}
              visibleCount={data.records.length}
              buildHref={buildPageHref}
              scroll={false}
              preserveScroll
            />
          </section>
        </>
      )}
    </div>
  );
}
