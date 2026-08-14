import Link from "next/link";
import { ClipboardCheck, Droplets, Footprints, Plus, Scale, Settings, Utensils } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PetThumbnail } from "@/components/pet-thumbnail";
import { StatusMessage } from "@/components/status-message";
import { formatTimeJst } from "@/lib/date";
import { PET_LITTER_ACTION_LABELS, PET_WATER_ACTION_LABELS } from "@/lib/pet-care";
import { getDashboardData } from "@/lib/queries";

export const dynamic = "force-dynamic";

const SPECIES_LABELS = { DOG: "犬", CAT: "猫" } as const;
const SPECIES_BADGE_CLASS = {
  DOG: "border-species-dog/20 bg-species-dog-soft text-species-dog",
  CAT: "border-species-cat/20 bg-species-cat-soft text-species-cat"
} as const;
const DASHBOARD_VALUE_CLASS =
  "inline-flex min-h-8 min-w-32 max-w-full items-center justify-end whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm font-bold text-ink shadow-sm";
const DASHBOARD_EMPTY_VALUE_CLASS =
  "inline-flex min-h-8 min-w-32 max-w-full items-center justify-end whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm font-semibold text-slate-500 shadow-sm";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function careSummary(count: number, occurredAt: Date, suffix?: string) {
  return `${count}回｜${formatTimeJst(occurredAt)}${suffix ? `｜${suffix}` : ""}`;
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  const { pets, boardCount, totalPets } = await getDashboardData();
  const hiddenPetCount = Math.max(totalPets - pets.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">ダッシュボード</h2>
          <p className="mt-1 text-sm text-slate-600">
            登録済みの犬・猫のお世話状況を最大 {boardCount} 件表示します。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-dark hover:text-white"
          >
            <Settings className="h-4 w-4" aria-hidden />
            表示設定
          </Link>
          <Link
            href="/pets"
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Pet登録
          </Link>
        </div>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      {pets.length === 0 ? (
        <EmptyState title="Petがまだ登録されていません。" href="/pets" actionLabel="登録する" />
      ) : (
        <>
          {hiddenPetCount > 0 ? (
            <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
              {totalPets} 件中 {pets.length} 件を表示しています。表示対象は設定画面で変更できます。
            </p>
          ) : null}

          <section className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pets.map((pet) => {
              const latestWeight = pet.weightRecords[0];
              const recordsHref = pet.isActive
                ? `/records?petId=${encodeURIComponent(pet.id)}&scope=pet`
                : `/records?petId=${encodeURIComponent(pet.id)}&scope=pet&includeInactive=1`;

              return (
                <article
                  key={pet.id}
                  className="flex min-w-0 flex-col rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:p-5 xl:p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-lg font-bold text-ink">{pet.name}</h3>
                      <span
                        className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${SPECIES_BADGE_CLASS[pet.species]}`}
                      >
                        {SPECIES_LABELS[pet.species]}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${
                        pet.isActive ? "bg-highlight/40 text-slate-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {pet.isActive ? "管理中" : "管理終了"}
                    </span>
                  </div>

                  <div className="mt-4 flex min-h-24 justify-center md:min-h-28">
                    <PetThumbnail
                      petId={pet.id}
                      petName={pet.name}
                      profileImageFileName={pet.profileImageFileName}
                    />
                  </div>

                  <dl className="mt-5 grid flex-1 content-start gap-3">
                    <div className="flex flex-col items-stretch justify-between gap-2 rounded-md bg-slate-50 px-2 py-3 sm:flex-row sm:items-center">
                      <dt className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600">
                        <Scale className="h-4 w-4 text-brand-dark" aria-hidden />
                        最新体重
                      </dt>
                      <dd className="min-w-0 flex-1 text-right">
                        <span className={latestWeight ? DASHBOARD_VALUE_CLASS : DASHBOARD_EMPTY_VALUE_CLASS}>
                          {latestWeight ? `${latestWeight.weightKg.toString()}kg` : "未記録"}
                        </span>
                      </dd>
                    </div>
                    <div className="flex flex-col items-stretch justify-between gap-2 rounded-md bg-slate-50 px-2 py-3 sm:flex-row sm:items-center">
                      <dt className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600">
                        <Utensils className="h-4 w-4 text-accent" aria-hidden />
                        今日の食事
                      </dt>
                      <dd className="min-w-0 flex-1 text-right">
                        <span className={pet.todayFeeding ? DASHBOARD_VALUE_CLASS : DASHBOARD_EMPTY_VALUE_CLASS}>
                          {pet.todayFeeding
                            ? careSummary(pet.todayFeeding.count, pet.todayFeeding.latest.fedAt)
                            : "未記録"}
                        </span>
                      </dd>
                    </div>
                    <div className="flex flex-col items-stretch justify-between gap-2 rounded-md bg-slate-50 px-2 py-3 sm:flex-row sm:items-center">
                      <dt className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600">
                        <Droplets className="h-4 w-4 text-brand" aria-hidden />
                        今日の水
                      </dt>
                      <dd className="min-w-0 flex-1 text-right">
                        <span className={pet.todayWater ? DASHBOARD_VALUE_CLASS : DASHBOARD_EMPTY_VALUE_CLASS}>
                          {pet.todayWater
                            ? careSummary(
                                pet.todayWater.count,
                                pet.todayWater.latest.caredAt,
                                PET_WATER_ACTION_LABELS[pet.todayWater.latest.action]
                              )
                            : "未記録"}
                        </span>
                      </dd>
                    </div>
                    {pet.species === "DOG" ? (
                      <div className="flex flex-col items-stretch justify-between gap-2 rounded-md bg-slate-50 px-2 py-3 sm:flex-row sm:items-center">
                        <dt className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600">
                          <Footprints className="h-4 w-4 text-care-walk" aria-hidden />
                          今日の散歩
                        </dt>
                        <dd className="min-w-0 flex-1 text-right">
                          <span className={pet.todayWalk ? DASHBOARD_VALUE_CLASS : DASHBOARD_EMPTY_VALUE_CLASS}>
                            {pet.todayWalk
                              ? careSummary(
                                  pet.todayWalk.count,
                                  pet.todayWalk.latest.startedAt,
                                  pet.todayWalk.latest.durationMinutes == null
                                    ? undefined
                                    : `${pet.todayWalk.latest.durationMinutes}分`
                                )
                              : "未記録"}
                          </span>
                        </dd>
                      </div>
                    ) : (
                      <div className="flex flex-col items-stretch justify-between gap-2 rounded-md bg-slate-50 px-2 py-3 sm:flex-row sm:items-center">
                        <dt className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600">
                          <ClipboardCheck className="h-4 w-4 text-care-litter" aria-hidden />
                          今日のトイレ
                        </dt>
                        <dd className="min-w-0 flex-1 text-right">
                          <span className={pet.todayLitter ? DASHBOARD_VALUE_CLASS : DASHBOARD_EMPTY_VALUE_CLASS}>
                            {pet.todayLitter
                              ? careSummary(
                                  pet.todayLitter.count,
                                  pet.todayLitter.latest.occurredAt,
                                  PET_LITTER_ACTION_LABELS[pet.todayLitter.latest.action]
                                )
                              : "未記録"}
                          </span>
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                    {pet.isActive ? (
                      <Link
                        href={`/care?petId=${encodeURIComponent(pet.id)}`}
                        className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
                      >
                        お世話を記録
                      </Link>
                    ) : null}
                    <Link
                      href={recordsHref}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      記録を見る
                    </Link>
                  </div>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
