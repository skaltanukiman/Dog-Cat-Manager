import Link from "next/link";

import { AutoSubmitFilterForm, FilterClearButton } from "@/components/auto-submit-filter-form";
import { EmptyState } from "@/components/empty-state";
import { PaginationLayout } from "@/components/pagination";
import { PetRecordCreateForms } from "@/components/pet-record-create-forms";
import { PetRecordTimeline } from "@/components/pet-record-timeline";
import { RecordTypeFilterScroller } from "@/components/record-type-filter-scroller";
import { PetSpeciesBadge } from "@/components/pet-species-badge";
import { PetThumbnail } from "@/components/pet-thumbnail";
import { RecordKeywordInput } from "@/components/record-keyword-input";
import { StatusMessage } from "@/components/status-message";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { todayInputJst } from "@/lib/date";
import { getPetRecordsPageData } from "@/lib/pet-record-queries";
import {
  normalizePetRecordDateFilter,
  normalizePetRecordKeyword,
  normalizePetRecordPage,
  normalizePetRecordTypeFilter,
  petRecordsUrl,
  type PetRecordTypeFilter
} from "@/lib/pet-records";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const speciesLabel = { DOG: "犬", CAT: "猫" } as const;
const typeTabs: Array<{ value: PetRecordTypeFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "health", label: "健康・体調" },
  { value: "medical", label: "通院" },
  { value: "medication", label: "投薬" },
  { value: "vaccination", label: "ワクチン" },
  { value: "memory", label: "思い出" }
];

export default async function RecordsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const today = todayInputJst();
  const rawFrom = getParam(params.from);
  const rawTo = getParam(params.to);
  const normalizedFrom = normalizePetRecordDateFilter(rawFrom);
  const normalizedTo = normalizePetRecordDateFilter(rawTo);
  const from = normalizedFrom && normalizedFrom <= today ? normalizedFrom : "";
  const to = normalizedTo && normalizedTo <= today ? normalizedTo : "";
  const includeInactive = getParam(params.includeInactive) === "1";
  const recordType = normalizePetRecordTypeFilter(getParam(params.type));
  const favoriteOnly =
    getParam(params.favorite) === "1" && (recordType === "all" || recordType === "memory");
  const hasScopeParam = params.scope !== undefined;
  const filters = {
    petId: getParam(params.petId) ?? "",
    hasScopeParam,
    scopeParam: getParam(params.scope),
    type: recordType,
    from,
    to,
    keyword: normalizePetRecordKeyword(getParam(params.keyword)),
    favoriteOnly,
    page: normalizePetRecordPage(getParam(params.page))
  };
  const data = await getPetRecordsPageData({
    selectedPetId: filters.petId,
    includeInactive,
    hasScopeParam: filters.hasScopeParam,
    scopeParam: filters.scopeParam,
    recordType: filters.type,
    from: filters.from,
    to: filters.to,
    keyword: filters.keyword,
    favoriteOnly: filters.favoriteOnly,
    page: filters.page
  });
  const selectedPetId = data.selectedPet?.id ?? "";
  const scope = data.scope;
  const currentFilters = {
    scope,
    includeScope: true,
    petId: selectedPetId,
    includeInactive,
    type: filters.type,
    from: filters.from,
    to: filters.to,
    keyword: filters.keyword,
    favoriteOnly: filters.favoriteOnly,
    page: data.pagination.currentPage
  };
  const canEdit = canEditHouseholdSharedData(data.context.membership.role);
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const futureDateFilter = Boolean(
    (normalizedFrom && normalizedFrom > today) || (normalizedTo && normalizedTo > today)
  );
  const buildRecordsPageHref = (page: number) => petRecordsUrl({ ...currentFilters, page });

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-brand">健康と大切な時間をひとつの年表に</p>
        <h1 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">記録</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">犬・猫の健康、通院、投薬、ワクチン、思い出を記録します。</p>
      </header>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      {data.totalPets === 0 ? (
        canEdit ? (
          <EmptyState title="先に犬・猫を登録してください。" href="/pets" actionLabel="犬・猫を登録する" />
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">閲覧できる犬・猫はまだ登録されていません。</p>
        )
      ) : (
        <>
          <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid gap-2 border-b border-slate-200 pb-4">
              <p className="text-sm font-semibold text-slate-700">タイムラインの表示範囲</p>
              <nav className="grid grid-cols-2 gap-2 sm:inline-grid sm:w-fit sm:gap-0.5 sm:rounded-lg sm:bg-slate-100 sm:p-1 sm:ring-1 sm:ring-inset sm:ring-slate-200" aria-label="タイムラインの表示範囲">
                {([
                  { scope: "pet", label: "選択中のPet" },
                  { scope: "household", label: "共有グループ全体" }
                ] as const).map((option) => (
                  <Link key={option.scope} href={petRecordsUrl({ ...currentFilters, scope: option.scope, page: 1 })} scroll={false} aria-current={scope === option.scope ? "page" : undefined} className={`rounded-full border px-2 py-2 text-center text-xs font-semibold sm:rounded-md sm:border-0 sm:px-3 sm:text-sm ${scope === option.scope ? "border-brand bg-brand text-white sm:shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-brand hover:text-brand sm:bg-transparent"}`}>
                    {option.label}
                  </Link>
                ))}
              </nav>
              {scope === "household" ? <p className="text-xs leading-5 text-slate-500">共有グループ内の全Petの記録を表示します。選択中のPetは新規記録の対象として維持されます。</p> : null}
            </div>

            <AutoSubmitFilterForm action="/records" className="grid gap-4">
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="type" value={filters.type} />
              <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  {scope === "household" ? "記録を追加するPet" : "対象Pet"}
                  <select name="petId" defaultValue={selectedPetId} disabled={data.pets.length === 0}>
                    {data.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}（{speciesLabel[pet.species]}）{pet.isActive ? "" : "・管理終了"}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">開始日<input type="date" name="from" defaultValue={filters.from} max={today} /></label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">終了日<input type="date" name="to" defaultValue={filters.to} max={today} /></label>
              </div>
              <label className="inline-flex h-10 items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" name="includeInactive" value="1" defaultChecked={includeInactive} />管理終了したPetも含む</label>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <label className="grid gap-1 text-sm font-medium text-slate-700">キーワード<RecordKeywordInput name="keyword" defaultValue={filters.keyword} tagSuggestions={data.tagSuggestions} /><span className="text-xs font-normal text-slate-500">キーワード同士・タグ同士はOR、キーワードと#タグはANDで検索します。</span></label>
                <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 md:mt-6 md:self-start"><input type="checkbox" name="favorite" value="1" defaultChecked={filters.favoriteOnly} disabled={filters.type !== "all" && filters.type !== "memory"} />お気に入りの思い出のみ</label>
              </div>
              {invalidRange ? <p role="alert" className="text-sm text-red-600">開始日は終了日以前の日付を指定してください。</p> : null}
              {futureDateFilter ? <p role="alert" className="text-sm text-red-600">未来日は絞り込みに指定できません。</p> : null}
              <div><FilterClearButton fieldNames={["from", "to", "keyword", "favorite"]} className="text-sm font-semibold text-brand hover:underline">絞り込みをクリア</FilterClearButton></div>
            </AutoSubmitFilterForm>
          </section>

          {!data.selectedPet ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">管理中のPetがいません。履歴を見る場合は「管理終了したPetも含む」を選択してください。</p>
          ) : (
            <>
              <section className="flex items-center gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <PetThumbnail petId={data.selectedPet.id} petName={data.selectedPet.name} profileImageFileName={data.selectedPet.profileImageFileName} />
                <div>
                  <h2 className="text-lg font-bold text-ink">{data.selectedPet.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <PetSpeciesBadge species={data.selectedPet.species} />
                    {!data.selectedPet.isActive ? <span>管理終了</span> : null}
                  </div>
                </div>
              </section>

              {!canEdit ? (
                <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">閲覧者は記録の検索・閲覧のみ利用できます。</p>
              ) : !data.selectedPet.isActive ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">このPetは管理終了済みのため、記録の閲覧のみ可能です。</p>
              ) : (
                <PetRecordCreateForms key={data.selectedPet.id} petId={data.selectedPet.id} pets={data.pets} today={today} savedMemoryTags={data.savedMemoryTags} />
              )}

              <section className="grid gap-4">
                <div className="grid gap-3">
                  <h2 className="text-xl font-bold text-ink">{scope === "household" ? "共有グループ全体のタイムライン" : "共通タイムライン"}</h2>
                  <nav className="min-w-0 max-w-full" aria-label="記録種類の切り替え">
                    <RecordTypeFilterScroller>
                      {typeTabs.map((tab) => <Link key={tab.value} href={petRecordsUrl({ ...currentFilters, type: tab.value, favoriteOnly: (tab.value === "all" || tab.value === "memory") && currentFilters.favoriteOnly, page: 1 })} scroll={false} aria-current={filters.type === tab.value ? "page" : undefined} className={`rounded-full border px-3 py-2 text-sm font-semibold ${filters.type === tab.value ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-700 hover:border-brand hover:text-brand"}`}>{tab.label}</Link>)}
                    </RecordTypeFilterScroller>
                  </nav>
                </div>
                <PaginationLayout ariaLabel="記録一覧のページ移動" pagination={data.pagination} visibleCount={data.records.length} buildHref={buildRecordsPageHref} scroll={false} preserveScroll />
                <PetRecordTimeline
                  records={data.records}
                  pets={data.pets}
                  scope={scope}
                  returnPetId={selectedPetId}
                  includeInactive={includeInactive}
                  returnFilters={{
                    type: filters.type,
                    from: filters.from,
                    to: filters.to,
                    keyword: filters.keyword,
                    favoriteOnly: filters.favoriteOnly,
                    page: data.pagination.currentPage
                  }}
                  canEdit={canEdit}
                  today={today}
                />
                <PaginationLayout ariaLabel="記録一覧のページ移動" pagination={data.pagination} visibleCount={data.records.length} buildHref={buildRecordsPageHref} scroll={false} preserveScroll />
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
