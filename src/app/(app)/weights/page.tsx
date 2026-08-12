import { Plus } from "lucide-react";

import { createPetWeightRecord } from "@/app/actions/pet-weights";
import { AutoSubmitInput } from "@/components/auto-submit-input";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { EmptyState } from "@/components/empty-state";
import { PaginationLayout } from "@/components/pagination";
import { PetWeightChart } from "@/components/pet-weight-chart";
import { PetWeightHistoryList } from "@/components/pet-weight-history-list";
import { StatusMessage } from "@/components/status-message";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { toDateInputValue, todayInputJst } from "@/lib/date";
import { MAX_PET_WEIGHT_KG, PET_WEIGHT_MEMO_MAX_LENGTH } from "@/lib/pet-weight-rules";
import { getPetWeightPageData } from "@/lib/pet-weight-queries";

export const dynamic = "force-dynamic";

const SPECIES_LABELS = { DOG: "犬", CAT: "猫" } as const;

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export default async function WeightsPage({
  searchParams
}: {
  searchParams: Promise<{
    petId?: string | string[];
    status?: string | string[];
    errorId?: string | string[];
    page?: string | string[];
    includeInactive?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);
  const includeInactive = getParam(params.includeInactive) === "1";
  const { pets, totalPets, selectedPet, records, chartRecords, pagination } = await getPetWeightPageData({
    selectedPetId: getParam(params.petId),
    includeInactive,
    page: normalizePage(getParam(params.page))
  });
  const today = todayInputJst();
  const canMutateSelectedPet = canEdit && Boolean(selectedPet?.isActive);
  const historyRecords = records.map((record) => ({
    id: record.id,
    recordDate: toDateInputValue(record.recordDate),
    weightKg: Number(record.weightKg),
    memo: record.memo
  }));
  const chartData = chartRecords.map((record) => ({
    date: toDateInputValue(record.recordDate),
    weightKg: Number(record.weightKg)
  }));
  const buildPageHref = (page: number) => {
    if (!selectedPet) return "/weights";
    const query = new URLSearchParams({ petId: selectedPet.id });
    if (includeInactive) query.set("includeInactive", "1");
    if (page > 1) query.set("page", String(page));
    return `/weights?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-bold text-ink">体重管理</h2>
        <p className="mt-1 text-sm text-slate-600">犬・猫の日付ごとの体重を記録し、推移を確認します。</p>
      </header>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      {totalPets === 0 ? (
        canEdit ? (
          <EmptyState title="先に犬・猫を登録してください。" href="/pets" actionLabel="犬・猫を登録する" />
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            閲覧できる犬・猫はまだ登録されていません。
          </p>
        )
      ) : (
        <>
          <form method="get" className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_auto]">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              犬・猫
              <AutoSubmitSelect name="petId" defaultValue={selectedPet?.id ?? ""} disabled={pets.length === 0}>
                <option value="">選択してください</option>
                {pets.map((pet) => (
                  <option key={pet.id} value={pet.id}>
                    {pet.name}（{SPECIES_LABELS[pet.species]}）{pet.isActive ? "" : "・管理終了"}
                  </option>
                ))}
              </AutoSubmitSelect>
            </label>
            <label className="inline-flex h-10 items-center gap-2 self-end text-sm font-medium text-slate-700 md:justify-end">
              <AutoSubmitInput type="checkbox" name="includeInactive" value="1" defaultChecked={includeInactive} />
              管理終了したPetも含む
            </label>
          </form>

          {!selectedPet ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {pets.length > 0
                ? "犬・猫を選択すると、体重履歴とグラフを表示します。"
                : "管理中の犬・猫がいません。過去履歴を見る場合は「管理終了したPetも含む」を選択してください。"}
            </p>
          ) : (
            <div className="space-y-6">
              {!canEdit ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  閲覧者は体重履歴とグラフを閲覧できますが、登録・編集・削除は実行できません。
                </p>
              ) : !selectedPet.isActive ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  このPetは管理終了のため、過去履歴は閲覧できますが登録・編集・削除はできません。
                </p>
              ) : null}

              <section className={canMutateSelectedPet ? "grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]" : "grid gap-4"}>
                {canMutateSelectedPet ? (
                  <form action={createPetWeightRecord} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                    <input type="hidden" name="petId" value={selectedPet.id} />
                    {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
                    <h3 className="text-base font-bold text-ink">体重登録</h3>
                    <div className="mt-4 grid gap-4">
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        測定日
                        <input type="date" name="recordDate" defaultValue={today} max={today} required />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        体重(kg)
                        <input type="number" name="weightKg" min="0.01" max={MAX_PET_WEIGHT_KG} step="0.01" placeholder="5.25" required />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        メモ
                        <textarea name="memo" maxLength={PET_WEIGHT_MEMO_MAX_LENGTH} rows={3} placeholder="夕食前" />
                      </label>
                      <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-md bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-moss/90">
                        <Plus className="h-4 w-4" aria-hidden />
                        登録
                      </button>
                    </div>
                  </form>
                ) : null}
                <section>
                  <h3 className="mb-3 text-base font-bold text-ink">
                    {selectedPet.name}（{SPECIES_LABELS[selectedPet.species]}）の体重推移
                  </h3>
                  <PetWeightChart data={chartData} />
                  {pagination.totalCount > chartData.length ? (
                    <p className="mt-2 text-xs text-slate-500">グラフは直近{chartData.length}件を表示しています。</p>
                  ) : null}
                </section>
              </section>

              <section className="space-y-3">
                <h3 className="text-base font-bold text-ink">体重履歴</h3>
                {pagination.totalCount > 0 ? (
                  <PaginationLayout
                    ariaLabel="Pet体重履歴のページ移動"
                    pagination={pagination}
                    visibleCount={historyRecords.length}
                    buildHref={buildPageHref}
                    scroll={false}
                    preserveScroll
                  />
                ) : null}
                {historyRecords.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                    体重記録がまだありません。
                  </div>
                ) : (
                  <PetWeightHistoryList
                    records={historyRecords}
                    selectedPetId={selectedPet.id}
                    today={today}
                    currentPage={pagination.currentPage}
                    includeInactive={includeInactive}
                    readOnly={!canMutateSelectedPet}
                  />
                )}
                {pagination.totalCount > 0 ? (
                  <PaginationLayout
                    ariaLabel="Pet体重履歴のページ移動"
                    pagination={pagination}
                    visibleCount={historyRecords.length}
                    buildHref={buildPageHref}
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
