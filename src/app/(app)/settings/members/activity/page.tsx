import type { HouseholdActivityCategory } from "@prisma/client";
import { ArrowLeft, History } from "lucide-react";
import Link from "next/link";

import { HouseholdActivityList } from "@/components/household-activity-list";
import { PaginationLayout } from "@/components/pagination";
import { parseActivityCategory, parseActivityPage } from "@/lib/household-activity";
import {
  getHouseholdActivityRetentionDays,
  HouseholdActivityRetentionConfigError
} from "@/lib/household-activity-cleanup";
import { getCurrentHouseholdActivityPage } from "@/lib/household-activity-queries";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ value: HouseholdActivityCategory | null; label: string }> = [
  { value: null, label: "すべて" },
  { value: "CARE_RECORD", label: "飼育記録" },
  { value: "MEMBER", label: "メンバー" },
  { value: "GROUP_SETTING", label: "グループ設定" }
];

function activityHref(category: HouseholdActivityCategory | null, page = 1) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  return `/settings/members/activity${params.size ? `?${params}` : ""}`;
}

function getHouseholdActivityRetentionDaysForDisplay() {
  try {
    return getHouseholdActivityRetentionDays();
  } catch (error) {
    if (error instanceof HouseholdActivityRetentionConfigError) return null;
    throw error;
  }
}

export default async function HouseholdActivityPage({
  searchParams
}: {
  searchParams: Promise<{ category?: string | string[]; page?: string | string[] }>;
}) {
  const query = await searchParams;
  const category = parseActivityCategory(query.category);
  const retentionDays = getHouseholdActivityRetentionDaysForDisplay();
  const data = await getCurrentHouseholdActivityPage({ category, page: parseActivityPage(query.page) });
  const buildActivityPageHref = (page: number) => activityHref(category, page);
  const renderPagination = (ariaLabel: string) => data.pagination.totalPages > 1 ? (
    <PaginationLayout
      ariaLabel={ariaLabel}
      pagination={data.pagination}
      visibleCount={data.activities.length}
      buildHref={buildActivityPageHref}
      scroll={false}
      preserveScroll
    />
  ) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/members" className="inline-flex items-center gap-1 text-sm font-semibold text-moss hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />共有へ戻る
        </Link>
        <div className="mt-3 flex items-start gap-3">
          <History className="mt-0.5 h-6 w-6 shrink-0 text-moss" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-ink">共有グループの操作履歴</h2>
            <p className="mt-1 break-words text-sm text-slate-600">{data.context.household.name} で行われた主要な操作を表示します。</p>
            <p className="mt-1 break-words text-sm text-slate-600">
              {retentionDays === null
                ? "操作履歴の保持期間は設定不明です。保持期間が正しく設定されるまで自動削除は実行されません。"
                : `操作履歴は${retentionDays}日間保持され、期限を過ぎた履歴は定期的に自動削除されます。`}
            </p>
          </div>
        </div>
      </div>

      <nav
        aria-label="操作履歴のカテゴリー"
        className="grid grid-cols-4 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-wrap sm:gap-2 sm:rounded-none sm:bg-transparent sm:p-0"
      >
        {FILTERS.map((filter) => {
          const selected = filter.value === category;
          return (
            <Link
              key={filter.label}
              href={activityHref(filter.value)}
              aria-current={selected ? "page" : undefined}
              className={`flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-0.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-1 sm:min-h-10 sm:rounded-md sm:border sm:px-4 sm:py-2 sm:text-sm sm:font-semibold ${
                selected
                  ? "bg-moss/10 text-moss ring-1 ring-inset ring-moss/20 sm:border-moss sm:bg-moss sm:text-white sm:ring-0"
                  : "text-slate-600 hover:bg-white/70 hover:text-ink sm:border-slate-200 sm:bg-white sm:text-slate-700 sm:hover:bg-slate-50"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {renderPagination("操作履歴上部のページ")}
      <HouseholdActivityList activities={data.activities} />
      {renderPagination("操作履歴下部のページ")}
    </div>
  );
}
