import type { HouseholdActivityCategory } from "@prisma/client";
import { Clock3 } from "lucide-react";

import { formatDateTimeJst } from "@/lib/date";
import { formatHouseholdActivity, type HouseholdActivityListItem } from "@/lib/household-activity";

const CATEGORY_LABELS: Record<HouseholdActivityCategory, string> = {
  CARE_RECORD: "飼育記録",
  MEMBER: "メンバー",
  GROUP_SETTING: "グループ設定"
};

export function HouseholdActivityList({
  activities,
  emptyMessage = "まだ操作履歴はありません。"
}: {
  activities: HouseholdActivityListItem[];
  emptyMessage?: string;
}) {
  if (activities.length === 0) {
    return <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">{emptyMessage}</p>;
  }

  return (
    <ol className="space-y-3">
      {activities.map((activity) => {
        const formatted = formatHouseholdActivity(activity);
        return (
          <li key={activity.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold leading-6 text-ink">{formatted.summary}</p>
                {formatted.detail ? <p className="mt-1 break-words text-sm text-slate-600">{formatted.detail}</p> : null}
              </div>
              <span className="inline-flex w-24 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-highlight/40 px-2 py-1 text-center text-xs font-semibold text-slate-700">
                {CATEGORY_LABELS[activity.category]}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
              <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <time dateTime={activity.createdAt.toISOString()}>{formatDateTimeJst(activity.createdAt)}</time>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
