import Link from "next/link";

import { AutoSubmitFilterForm, FilterClearButton } from "@/components/auto-submit-filter-form";
import { EmptyState } from "@/components/empty-state";
import { HamsterSelectorInput } from "@/components/hamster-selector-input";
import { PaginationLayout } from "@/components/pagination";
import { RecordCreateForms } from "@/components/record-create-forms";
import { RecordKeywordInput } from "@/components/record-keyword-input";
import { RecordTimeline } from "@/components/record-timeline";
import { StatusMessage } from "@/components/status-message";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { todayInputJst } from "@/lib/date";
import { getRecordsPageData } from "@/lib/record-queries";
import {
  normalizeRecordDateFilter,
  normalizeRecordKeyword,
  normalizeRecordPage,
  normalizeRecordTypeFilter,
  recordsUrl,
  type RecordTypeFilter
} from "@/lib/records";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type Filters = {
  hamsterId: string;
  type: RecordTypeFilter;
  from: string;
  to: string;
  keyword: string;
  favoriteOnly: boolean;
  page: number;
};

const typeTabs: Array<{ value: RecordTypeFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "health", label: "健康・体調" },
  { value: "medical", label: "通院" },
  { value: "memory", label: "思い出" }
];

export default async function RecordsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedHamsterId = getParam(params.hamsterId) ?? "";
  const hasScopeParam = Object.prototype.hasOwnProperty.call(params, "scope");
  const scopeParam = getParam(params.scope);
  const filters: Filters = {
    hamsterId: requestedHamsterId,
    type: normalizeRecordTypeFilter(getParam(params.type)),
    from: normalizeRecordDateFilter(getParam(params.from)),
    to: normalizeRecordDateFilter(getParam(params.to)),
    keyword: normalizeRecordKeyword(getParam(params.keyword)),
    favoriteOnly: getParam(params.favorite) === "1",
    page: normalizeRecordPage(getParam(params.page))
  };
  const data = await getRecordsPageData({
    selectedHamsterId: filters.hamsterId,
    hasScopeParam,
    scopeParam,
    recordType: filters.type,
    from: filters.from,
    to: filters.to,
    keyword: filters.keyword,
    favoriteOnly: filters.favoriteOnly,
    page: filters.page
  });
  const selectedHamsterId = data.selectedHamster?.id ?? "";
  const scope = data.scope;
  const currentFilters = { ...filters, scope, hamsterId: selectedHamsterId, page: data.pagination.currentPage };
  const canEdit = canEditHouseholdSharedData(data.context.membership.role);
  const today = todayInputJst();
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const buildRecordsPageHref = (page: number) => recordsUrl({ ...currentFilters, includeScope: true, page });

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-moss">健康と大切な時間をひとつの年表に</p>
        <h1 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">記録</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">体調・通院・思い出を種類別に登録し、ハムスターごとの共通タイムラインで振り返れます。</p>
      </header>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      {data.hamsters.length === 0 ? (
        <EmptyState title="ハムスターが登録されていません" href="/hamsters" actionLabel="ハムスターを登録" />
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
                    href={recordsUrl({ ...currentFilters, scope: option.scope, includeScope: true, page: 1 })}
                    scroll={false}
                    aria-current={scope === option.scope ? "page" : undefined}
                    className={`min-w-0 whitespace-nowrap rounded-full border px-1.5 py-2 text-center text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss sm:rounded-md sm:border-0 sm:px-3 sm:text-sm ${
                      scope === option.scope
                        ? "border-moss bg-moss text-white sm:shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-moss hover:text-moss sm:bg-transparent sm:text-slate-600 sm:hover:bg-white"
                    }`}
                  >
                    {option.label}
                  </Link>
                ))}
              </nav>
              {scope === "household" ? (
                <p className="text-xs leading-5 text-slate-500">タイムラインにはグループ内の全ハムスターの記録が表示されます。</p>
              ) : null}
            </div>
            <AutoSubmitFilterForm action="/records" ignoreFieldNames={["hamsterId"]} className="grid gap-4">
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="type" value={filters.type} />
              <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
                <label className="grid gap-1 text-sm font-medium text-slate-700">{scope === "household" ? "記録を追加するハムスター" : "対象ハムスター"}<HamsterSelectorInput mode={data.selectorMode} name="hamsterId" selectedId={selectedHamsterId} options={data.hamsters} showEmptyOption={false} /></label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">開始日<input type="date" name="from" defaultValue={filters.from} max={today} /></label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">終了日<input type="date" name="to" defaultValue={filters.to} max={today} /></label>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <label className="grid gap-1 text-sm font-medium text-slate-700">キーワード<RecordKeywordInput name="keyword" defaultValue={filters.keyword} tagSuggestions={data.tagSuggestions} /><span className="text-xs font-normal text-slate-500">キーワード同士・タグ同士はOR、キーワードと#タグはANDで検索します。</span></label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 md:mt-6 md:self-start"><input type="checkbox" name="favorite" value="1" defaultChecked={filters.favoriteOnly} />お気に入りの思い出のみ</label>
              </div>
              {invalidRange ? <p className="text-sm text-red-600">開始日は終了日以前の日付を指定してください。</p> : null}
              <div><FilterClearButton fieldNames={["from", "to", "keyword", "favorite"]} className="text-sm font-semibold text-moss hover:underline">絞り込みをクリア</FilterClearButton></div>
            </AutoSubmitFilterForm>
          </section>

          {canEdit && data.selectedHamster ? <RecordCreateForms hamsterId={selectedHamsterId} hamsterIsActive={data.selectedHamster.isActive} today={today} savedMemoryTags={data.savedMemoryTags} /> : !canEdit ? <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">閲覧者は記録の検索・閲覧のみ利用できます。</p> : null}

          <section className="grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-xl font-bold text-ink">{scope === "household" ? "グループ全体のタイムライン" : "共通タイムライン"}</h2>
              <nav className="flex flex-wrap gap-2" aria-label="記録種類の切り替え">{typeTabs.map((tab) => <Link key={tab.value} href={recordsUrl({ ...currentFilters, includeScope: true, type: tab.value, page: 1 })} scroll={false} aria-current={filters.type === tab.value ? "page" : undefined} className={`rounded-full border px-3 py-2 text-sm font-semibold ${filters.type === tab.value ? "border-moss bg-moss text-white" : "border-slate-200 bg-white text-slate-700 hover:border-moss hover:text-moss"}`}>{tab.label}</Link>)}</nav>
            </div>
            <PaginationLayout
              ariaLabel="記録一覧のページ移動"
              pagination={data.pagination}
              visibleCount={data.records.length}
              buildHref={buildRecordsPageHref}
              scroll={false}
              preserveScroll
            />
            <RecordTimeline records={data.records} scope={scope} returnHamsterId={selectedHamsterId} canEdit={canEdit} today={today} />
            <PaginationLayout
              ariaLabel="記録一覧のページ移動"
              pagination={data.pagination}
              visibleCount={data.records.length}
              buildHref={buildRecordsPageHref}
              scroll={false}
              preserveScroll
            />
          </section>
        </>
      )}
    </main>
  );
}
