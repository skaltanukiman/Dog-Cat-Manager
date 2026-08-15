import Link from "next/link";
import { ClipboardCheck, Droplets, Footprints, Utensils } from "lucide-react";
import type { ReactNode } from "react";

import {
  createPetFeedingRecord,
  deletePetFeedingRecord,
  updatePetFeedingRecord
} from "@/app/actions/pet-feeding";
import { createPetLitterRecord, deletePetLitterRecord, updatePetLitterRecord } from "@/app/actions/pet-litter";
import { createPetWalkRecord, deletePetWalkRecord, updatePetWalkRecord } from "@/app/actions/pet-walk";
import { createPetWaterRecord, deletePetWaterRecord, updatePetWaterRecord } from "@/app/actions/pet-water";
import { AutoSubmitInput } from "@/components/auto-submit-input";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { CareDisclosure } from "@/components/care-disclosure";
import { EmptyState } from "@/components/empty-state";
import { PetSpeciesBadge } from "@/components/pet-species-badge";
import { PetThumbnail } from "@/components/pet-thumbnail";
import { StatusMessage } from "@/components/status-message";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { formatTimeJst } from "@/lib/date";
import {
  careDateStartDateTimeLocal,
  formatJstDateTimeLocal,
  PET_CARE_MEMO_MAX_LENGTH,
  PET_LITTER_ACTION_LABELS,
  PET_WATER_ACTION_LABELS
} from "@/lib/pet-care";
import { getPetCarePageData } from "@/lib/pet-care-queries";

export const dynamic = "force-dynamic";

const SPECIES_LABELS = { DOG: "犬", CAT: "猫" } as const;
const CARE_SECTIONS = ["feeding", "water", "walk", "litter"] as const;
type CareSection = (typeof CARE_SECTIONS)[number];

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function creatorName(value: string | null | undefined) {
  return value?.trim() || "記録者不明";
}

function getCareSection(value: string | undefined): CareSection | null {
  return CARE_SECTIONS.find((section) => section === value) ?? null;
}

function careSummary(count: number, details: string[]) {
  return count === 0 ? "記録なし" : [`${count}件`, ...details].join(" ｜ ");
}

function MutationHiddenFields({
  petId,
  careDate,
  includeInactive
}: {
  petId: string;
  careDate: string;
  includeInactive: boolean;
}) {
  return (
    <>
      <input type="hidden" name="petId" value={petId} />
      <input type="hidden" name="careDate" value={careDate} />
      {includeInactive ? <input type="hidden" name="includeInactive" value="1" /> : null}
    </>
  );
}

function CareHistoryHeading({ count }: { count: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <h4 className="shrink-0 text-sm font-semibold text-slate-700">記録履歴</h4>
      <span className="shrink-0 text-xs text-slate-500">{count}件</span>
      <span className="h-px min-w-0 flex-1 bg-slate-200" aria-hidden />
    </div>
  );
}

function CareDisclosureHeader({
  title,
  summary,
  icon
}: {
  title: string;
  summary: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      {icon}
      <div className="min-w-0">
        <span className="block text-lg font-bold text-ink">{title}</span>
        <span className="block text-sm text-slate-600">{summary}</span>
      </div>
    </div>
  );
}

export default async function CarePage({
  searchParams
}: {
  searchParams: Promise<{
    petId?: string | string[];
    date?: string | string[];
    status?: string | string[];
    errorId?: string | string[];
    includeInactive?: string | string[];
    careSection?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const includeInactive = getParam(params.includeInactive) === "1";
  const expandedCareSection = getCareSection(getParam(params.careSection));
  const now = new Date();
  const {
    context,
    pets,
    totalPets,
    selectedPet,
    selectedCareDate,
    currentCareDate,
    feedingRecords,
    waterRecords,
    walkRecords,
    litterRecords
  } = await getPetCarePageData({
    selectedPetId: getParam(params.petId),
    requestedCareDate: getParam(params.date),
    includeInactive,
    now
  });
  const canEdit = canEditHouseholdSharedData(context.membership.role);
  const canMutateSelectedPet = canEdit && Boolean(selectedPet?.isActive);
  const maxDateTime = formatJstDateTimeLocal(now);
  const defaultDateTime =
    selectedCareDate === currentCareDate
      ? maxDateTime
      : careDateStartDateTimeLocal(selectedCareDate, context.household.careDayStartMinutes);
  const todayQuery = new URLSearchParams();
  if (selectedPet) todayQuery.set("petId", selectedPet.id);
  if (includeInactive) todayQuery.set("includeInactive", "1");
  const todayHref = todayQuery.size > 0 ? `/care?${todayQuery.toString()}` : "/care";
  const latestFeedingRecord = feedingRecords[feedingRecords.length - 1];
  const latestWaterRecord = waterRecords[waterRecords.length - 1];
  const latestWalkRecord = walkRecords[walkRecords.length - 1];
  const latestLitterRecord = litterRecords[litterRecords.length - 1];
  const feedingSummary = careSummary(
    feedingRecords.length,
    latestFeedingRecord ? [`最終 ${formatTimeJst(latestFeedingRecord.fedAt)}`] : []
  );
  const waterSummary = careSummary(
    waterRecords.length,
    latestWaterRecord
      ? [`最終 ${formatTimeJst(latestWaterRecord.caredAt)}`, PET_WATER_ACTION_LABELS[latestWaterRecord.action]]
      : []
  );
  const walkSummary = careSummary(
    walkRecords.length,
    latestWalkRecord
      ? [
          `最終 ${formatTimeJst(latestWalkRecord.startedAt)}`,
          ...(latestWalkRecord.durationMinutes === null ? [] : [`${latestWalkRecord.durationMinutes}分`])
        ]
      : []
  );
  const litterSummary = careSummary(
    litterRecords.length,
    latestLitterRecord
      ? [`最終 ${formatTimeJst(latestLitterRecord.occurredAt)}`, PET_LITTER_ACTION_LABELS[latestLitterRecord.action]]
      : []
  );

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-bold text-ink">お世話管理</h2>
        <p className="mt-1 text-sm text-slate-600">犬・猫の食事や水のお世話を記録します。</p>
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
          <form method="get" className="grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2">
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
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              お世話日
              <AutoSubmitInput type="date" name="date" defaultValue={selectedCareDate} max={currentCareDate} />
            </label>
            <label className="inline-flex h-10 items-center gap-2 text-sm font-medium text-slate-700">
              <AutoSubmitInput type="checkbox" name="includeInactive" value="1" defaultChecked={includeInactive} />
              管理終了したPetも含む
            </label>
            <div className="flex items-center md:justify-end">
              <Link href={todayHref} className="text-sm font-semibold text-brand hover:underline">
                今日に戻る
              </Link>
            </div>
          </form>

          {!selectedPet ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {pets.length > 0
                ? "犬・猫を選択すると、食事と水のお世話履歴を表示します。"
                : "管理中の犬・猫がいません。履歴を見る場合は「管理終了したPetも含む」を選択してください。"}
            </p>
          ) : (
            <div className="space-y-6">
              <section className="flex items-center gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <PetThumbnail
                  petId={selectedPet.id}
                  petName={selectedPet.name}
                  profileImageFileName={selectedPet.profileImageFileName}
                />
                <div>
                  <h3 className="text-lg font-bold text-ink">{selectedPet.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <PetSpeciesBadge species={selectedPet.species} />
                    <span>お世話日 {selectedCareDate.replaceAll("-", "/")}</span>
                  </div>
                </div>
              </section>

              {!canEdit ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  閲覧者はお世話履歴を閲覧できますが、登録・編集・削除は実行できません。
                </p>
              ) : !selectedPet.isActive ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  この犬・猫は管理終了済みのため、お世話履歴の閲覧のみ可能です。
                </p>
              ) : null}

              <div className="space-y-4">
              <CareDisclosure
                key={`feeding-${selectedPet.id}-${getParam(params.date) ?? ""}-${expandedCareSection ?? ""}`}
                defaultOpen={expandedCareSection === "feeding"}
                header={<CareDisclosureHeader title="食事" summary={feedingSummary} icon={<Utensils className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />} />}
                headerClassName="border-accent bg-accent/5"
              >
                <div className="space-y-6 px-3 py-4 sm:px-4">
                <p className="text-sm text-slate-600">同じお世話日に複数回記録できます。</p>
                {canMutateSelectedPet ? (
                  <form action={createPetFeedingRecord} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                    <h4 className="border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-sm font-semibold text-slate-700">記録の追加</h4>
                    <div className="grid gap-4 p-5 md:grid-cols-2">
                    <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      日時
                      <input type="datetime-local" name="fedAt" defaultValue={defaultDateTime} max={maxDateTime} required />
                    </label>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      メモ
                      <input type="text" name="memo" maxLength={PET_CARE_MEMO_MAX_LENGTH} placeholder="朝ごはん" />
                    </label>
                    <button type="submit" className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark md:col-span-2">
                      登録
                    </button>
                    </div>
                  </form>
                ) : null}
                <div className="space-y-3">
                  <CareHistoryHeading count={feedingRecords.length} />
                {feedingRecords.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">食事記録はありません。</p>
                ) : (
                  <div className="space-y-3">
                    {feedingRecords.map((record) => (
                      <article key={record.id} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-lg font-bold text-ink">{formatTimeJst(record.fedAt)}</p>
                          <p className="text-xs text-slate-500">記録: {creatorName(record.createdBy?.name)}</p>
                        </div>
                        {!canMutateSelectedPet ? (
                          record.memo ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">メモ: {record.memo}</p> : null
                        ) : (
                          <div className="mt-4 grid gap-3">
                            <form action={updatePetFeedingRecord} className="grid gap-3 md:grid-cols-2">
                              <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                              <input type="hidden" name="id" value={record.id} />
                              <label className="grid gap-1 text-sm font-medium text-slate-700">
                                日時
                                <input type="datetime-local" name="fedAt" defaultValue={formatJstDateTimeLocal(record.fedAt)} max={maxDateTime} required />
                              </label>
                              <label className="grid gap-1 text-sm font-medium text-slate-700">
                                メモ
                                <input type="text" name="memo" defaultValue={record.memo ?? ""} maxLength={PET_CARE_MEMO_MAX_LENGTH} />
                              </label>
                              <button type="submit" className="rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5 md:col-span-2">更新</button>
                            </form>
                            <form action={deletePetFeedingRecord}>
                              <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                              <input type="hidden" name="id" value={record.id} />
                              <button type="submit" className="text-sm font-semibold text-red-600 hover:underline">この食事記録を削除</button>
                            </form>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                </div>
                </div>
              </CareDisclosure>

              <CareDisclosure
                key={`water-${selectedPet.id}-${getParam(params.date) ?? ""}-${expandedCareSection ?? ""}`}
                defaultOpen={expandedCareSection === "water"}
                header={<CareDisclosureHeader title="水" summary={waterSummary} icon={<Droplets className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />} />}
                headerClassName="border-brand bg-brand/5"
              >
                <div className="space-y-6 px-3 py-4 sm:px-4">
                <p className="text-sm text-slate-600">交換と補充をイベントとして記録します。</p>
                {canMutateSelectedPet ? (
                  <form action={createPetWaterRecord} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                    <h4 className="border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-sm font-semibold text-slate-700">記録の追加</h4>
                    <div className="grid gap-4 p-5 md:grid-cols-3">
                    <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      日時
                      <input type="datetime-local" name="caredAt" defaultValue={defaultDateTime} max={maxDateTime} required />
                    </label>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      内容
                      <select name="action" defaultValue="REPLACED" required>
                        <option value="REPLACED">水を交換</option>
                        <option value="REFILLED">水を補充</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      メモ
                      <input type="text" name="memo" maxLength={PET_CARE_MEMO_MAX_LENGTH} placeholder="容器も洗浄" />
                    </label>
                    <button type="submit" className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark md:col-span-3">登録</button>
                    </div>
                  </form>
                ) : null}
                <div className="space-y-3">
                  <CareHistoryHeading count={waterRecords.length} />
                {waterRecords.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">水の記録はありません。</p>
                ) : (
                  <div className="space-y-3">
                    {waterRecords.map((record) => (
                      <article key={record.id} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-lg font-bold text-ink">{formatTimeJst(record.caredAt)}・{PET_WATER_ACTION_LABELS[record.action]}</p>
                          <p className="text-xs text-slate-500">記録: {creatorName(record.createdBy?.name)}</p>
                        </div>
                        {!canMutateSelectedPet ? (
                          record.memo ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">メモ: {record.memo}</p> : null
                        ) : (
                          <div className="mt-4 grid gap-3">
                            <form action={updatePetWaterRecord} className="grid gap-3 md:grid-cols-3">
                              <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                              <input type="hidden" name="id" value={record.id} />
                              <label className="grid gap-1 text-sm font-medium text-slate-700">
                                日時
                                <input type="datetime-local" name="caredAt" defaultValue={formatJstDateTimeLocal(record.caredAt)} max={maxDateTime} required />
                              </label>
                              <label className="grid gap-1 text-sm font-medium text-slate-700">
                                内容
                                <select name="action" defaultValue={record.action} required>
                                  <option value="REPLACED">水を交換</option>
                                  <option value="REFILLED">水を補充</option>
                                </select>
                              </label>
                              <label className="grid gap-1 text-sm font-medium text-slate-700">
                                メモ
                                <input type="text" name="memo" defaultValue={record.memo ?? ""} maxLength={PET_CARE_MEMO_MAX_LENGTH} />
                              </label>
                              <button type="submit" className="rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5 md:col-span-3">更新</button>
                            </form>
                            <form action={deletePetWaterRecord}>
                              <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                              <input type="hidden" name="id" value={record.id} />
                              <button type="submit" className="text-sm font-semibold text-red-600 hover:underline">この水の記録を削除</button>
                            </form>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                </div>
                </div>
              </CareDisclosure>

              {selectedPet.species === "DOG" ? (
                <CareDisclosure
                  key={`walk-${selectedPet.id}-${getParam(params.date) ?? ""}-${expandedCareSection ?? ""}`}
                  defaultOpen={expandedCareSection === "walk"}
                  header={<CareDisclosureHeader title="散歩" summary={walkSummary} icon={<Footprints className="mt-0.5 h-5 w-5 shrink-0 text-care-walk" aria-hidden />} />}
                  headerClassName="border-care-walk bg-care-walk/5"
                >
                  <div className="space-y-6 px-3 py-4 sm:px-4">
                  <p className="text-sm text-slate-600">開始日時と任意の散歩時間を記録します。</p>
                  {canMutateSelectedPet ? (
                    <form action={createPetWalkRecord} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                      <h4 className="border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-sm font-semibold text-slate-700">記録の追加</h4>
                      <div className="grid gap-4 p-5 md:grid-cols-3">
                      <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        開始日時
                        <input type="datetime-local" name="startedAt" defaultValue={defaultDateTime} max={maxDateTime} required />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        散歩時間（分・任意）
                        <input type="number" name="durationMinutes" min="1" max="1440" step="1" placeholder="30" />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        メモ
                        <input type="text" name="memo" maxLength={PET_CARE_MEMO_MAX_LENGTH} placeholder="公園まで" />
                      </label>
                      <button type="submit" className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark md:col-span-3">登録</button>
                      </div>
                    </form>
                  ) : null}
                  <div className="space-y-3">
                    <CareHistoryHeading count={walkRecords.length} />
                  {walkRecords.length === 0 ? (
                    <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">散歩記録はありません。</p>
                  ) : (
                    <div className="space-y-3">
                      {walkRecords.map((record) => (
                        <article key={record.id} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-lg font-bold text-ink">
                              {formatTimeJst(record.startedAt)}{record.durationMinutes !== null ? `・${record.durationMinutes}分` : ""}
                            </p>
                            <p className="text-xs text-slate-500">記録: {creatorName(record.createdBy?.name)}</p>
                          </div>
                          {!canMutateSelectedPet ? (
                            record.memo ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">メモ: {record.memo}</p> : null
                          ) : (
                            <div className="mt-4 grid gap-3">
                              <form action={updatePetWalkRecord} className="grid gap-3 md:grid-cols-3">
                                <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                                <input type="hidden" name="id" value={record.id} />
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                  開始日時
                                  <input type="datetime-local" name="startedAt" defaultValue={formatJstDateTimeLocal(record.startedAt)} max={maxDateTime} required />
                                </label>
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                  散歩時間（分・任意）
                                  <input type="number" name="durationMinutes" defaultValue={record.durationMinutes ?? ""} min="1" max="1440" step="1" />
                                </label>
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                  メモ
                                  <input type="text" name="memo" defaultValue={record.memo ?? ""} maxLength={PET_CARE_MEMO_MAX_LENGTH} />
                                </label>
                                <button type="submit" className="rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5 md:col-span-3">更新</button>
                              </form>
                              <form action={deletePetWalkRecord}>
                                <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                                <input type="hidden" name="id" value={record.id} />
                                <button type="submit" className="text-sm font-semibold text-red-600 hover:underline">この散歩記録を削除</button>
                              </form>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                  </div>
                  </div>
                </CareDisclosure>
              ) : null}

              {selectedPet.species === "CAT" ? (
                <CareDisclosure
                  key={`litter-${selectedPet.id}-${getParam(params.date) ?? ""}-${expandedCareSection ?? ""}`}
                  defaultOpen={expandedCareSection === "litter"}
                  header={<CareDisclosureHeader title="猫トイレ" summary={litterSummary} icon={<ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-care-litter" aria-hidden />} />}
                  headerClassName="border-care-litter bg-care-litter/5"
                >
                  <div className="space-y-6 px-3 py-4 sm:px-4">
                  <p className="text-sm text-slate-600">排泄の確認またはトイレ掃除を記録します。</p>
                  {canMutateSelectedPet ? (
                    <form action={createPetLitterRecord} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                      <h4 className="border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-sm font-semibold text-slate-700">記録の追加</h4>
                      <div className="grid gap-4 p-5 md:grid-cols-3">
                      <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        日時
                        <input type="datetime-local" name="occurredAt" defaultValue={defaultDateTime} max={maxDateTime} required />
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        内容
                        <select name="action" defaultValue="URINATION" required>
                          <option value="URINATION">おしっこ</option>
                          <option value="DEFECATION">うんち</option>
                          <option value="BOTH">おしっこ・うんち</option>
                          <option value="CLEANED">トイレ掃除</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        メモ
                        <input type="text" name="memo" maxLength={PET_CARE_MEMO_MAX_LENGTH} placeholder="普通" />
                      </label>
                      <button type="submit" className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark md:col-span-3">登録</button>
                      </div>
                    </form>
                  ) : null}
                  <div className="space-y-3">
                    <CareHistoryHeading count={litterRecords.length} />
                  {litterRecords.length === 0 ? (
                    <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">猫トイレ記録はありません。</p>
                  ) : (
                    <div className="space-y-3">
                      {litterRecords.map((record) => (
                        <article key={record.id} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-lg font-bold text-ink">{formatTimeJst(record.occurredAt)}・{PET_LITTER_ACTION_LABELS[record.action]}</p>
                            <p className="text-xs text-slate-500">記録: {creatorName(record.createdBy?.name)}</p>
                          </div>
                          {!canMutateSelectedPet ? (
                            record.memo ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">メモ: {record.memo}</p> : null
                          ) : (
                            <div className="mt-4 grid gap-3">
                              <form action={updatePetLitterRecord} className="grid gap-3 md:grid-cols-3">
                                <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                                <input type="hidden" name="id" value={record.id} />
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                  日時
                                  <input type="datetime-local" name="occurredAt" defaultValue={formatJstDateTimeLocal(record.occurredAt)} max={maxDateTime} required />
                                </label>
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                  内容
                                  <select name="action" defaultValue={record.action} required>
                                    <option value="URINATION">おしっこ</option>
                                    <option value="DEFECATION">うんち</option>
                                    <option value="BOTH">おしっこ・うんち</option>
                                    <option value="CLEANED">トイレ掃除</option>
                                  </select>
                                </label>
                                <label className="grid gap-1 text-sm font-medium text-slate-700">
                                  メモ
                                  <input type="text" name="memo" defaultValue={record.memo ?? ""} maxLength={PET_CARE_MEMO_MAX_LENGTH} />
                                </label>
                                <button type="submit" className="rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5 md:col-span-3">更新</button>
                              </form>
                              <form action={deletePetLitterRecord}>
                                <MutationHiddenFields petId={selectedPet.id} careDate={selectedCareDate} includeInactive={includeInactive} />
                                <input type="hidden" name="id" value={record.id} />
                                <button type="submit" className="text-sm font-semibold text-red-600 hover:underline">この猫トイレ記録を削除</button>
                              </form>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                  </div>
                  </div>
                </CareDisclosure>
              ) : null}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
