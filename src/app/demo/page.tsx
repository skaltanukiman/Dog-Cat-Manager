import { ClipboardCheck, Scale } from "lucide-react";

import { CleaningDateToggle } from "@/components/cleaning-date-toggle";
import { DashboardMemo } from "@/components/dashboard-memo";
import { DemoUnavailable } from "@/components/demo-unavailable";
import { HamsterThumbnail } from "@/components/hamster-thumbnail";
import { daysSinceDate, formatDateJp } from "@/lib/date";
import { getPublicDemoDashboardData } from "@/lib/public-demo-queries";

export const dynamic = "force-dynamic";

const VALUE_CLASS =
  "inline-flex h-8 min-w-28 items-center justify-end rounded-md border border-slate-200 bg-white px-2.5 text-right text-sm font-bold text-ink shadow-sm";
const EMPTY_VALUE_CLASS =
  "inline-flex h-8 min-w-28 items-center justify-end rounded-md border border-slate-200 bg-white px-2.5 text-right text-sm font-semibold text-slate-500 shadow-sm";

export default async function DemoDashboardPage() {
  const data = await getPublicDemoDashboardData();
  if (!data) return <DemoUnavailable />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">ダッシュボード</h2>
        <p className="mt-1 text-sm text-slate-600">
          {data.household.name}の最新状態を表示しています。
        </p>
      </div>

      <section className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.hamsters.map((hamster) => {
          const latestWeight = hamster.weightRecords[0];
          const cleaningItems = [
            { label: "トイレ掃除", record: hamster.latestToiletCleaning },
            { label: "砂場掃除", record: hamster.latestBathCleaning },
            { label: "床材全交換", record: hamster.latestFlooringAllCleaning },
            { label: "ハウス掃除", record: hamster.latestHouseCleaning }
          ];

          return (
            <article key={hamster.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3 md:min-h-[3.75rem]">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-lg font-bold text-ink">{hamster.name}</h3>
                  {hamster.memo ? <DashboardMemo hamsterName={hamster.name} memo={hamster.memo} /> : null}
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${
                    hamster.isActive ? "bg-straw/40 text-slate-700" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {hamster.isActive ? "管理中" : "管理外"}
                </span>
              </div>
              <div className="mt-4 flex min-h-24 justify-center md:min-h-28">
                <HamsterThumbnail
                  hamsterId={hamster.id}
                  hamsterName={hamster.name}
                  profileImageFileName={null}
                  staticImagePath={hamster.staticImagePath}
                />
              </div>
              <dl className="mt-5 grid gap-3">
                <div className="flex items-center justify-between gap-4 rounded-md bg-slate-50 px-3 py-3">
                  <dt className="flex items-center gap-2 text-sm font-medium text-slate-600">
                    <Scale className="h-4 w-4 text-persimmon" aria-hidden />
                    最新体重
                  </dt>
                  <dd>
                    <span className={latestWeight ? VALUE_CLASS : EMPTY_VALUE_CLASS}>
                      {latestWeight ? `${latestWeight.weightG.toFixed(1)}g` : "未記録"}
                    </span>
                  </dd>
                </div>
                {cleaningItems.map((item) => {
                  const elapsedDays = item.record ? daysSinceDate(item.record.recordDate) : null;
                  return (
                    <div key={item.label} className="flex items-center justify-between gap-4 rounded-md bg-slate-50 px-3 py-3">
                      <dt className="flex items-center gap-2 text-sm font-medium text-slate-600">
                        <ClipboardCheck className="h-4 w-4 text-moss" aria-hidden />
                        {item.label}
                      </dt>
                      <dd>
                        {item.record ? (
                          <CleaningDateToggle
                            dateLabel={formatDateJp(item.record.recordDate)}
                            elapsedLabel={`${elapsedDays}日経過`}
                            taskLabel={item.label}
                          />
                        ) : (
                          <span className={EMPTY_VALUE_CLASS}>未記録</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </article>
          );
        })}
      </section>
    </div>
  );
}
