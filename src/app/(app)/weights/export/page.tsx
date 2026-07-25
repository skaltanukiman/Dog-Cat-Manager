import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { StatusMessage } from "@/components/status-message";
import { WeightCsvExportForm } from "@/components/weight-csv-export-form";
import { normalizeYearMonth } from "@/lib/date";
import { getHamsterOptions, getHamsterSelectorMode } from "@/lib/queries";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WeightExportPage({
  searchParams
}: {
  searchParams: Promise<{
    hamsterId?: string | string[];
    month?: string | string[];
    status?: string | string[];
    errorId?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const hamsters = await getHamsterOptions();
  const hamsterSelectorMode = await getHamsterSelectorMode();
  const selectedHamsterId = getParam(query.hamsterId) ?? "";
  const month = getParam(query.month) ?? "";
  const normalizedMonth = month ? normalizeYearMonth(month) : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">体重CSVエクスポート</h2>
          <p className="mt-1 text-sm text-slate-600">
            体重記録をCSVでダウンロードし、アプリ版CSVの一括編集や閲覧に利用できます。
          </p>
        </div>
        <Link
          href="/weights"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          体重管理へ戻る
        </Link>
      </div>

      <StatusMessage status={getParam(query.status)} errorId={getParam(query.errorId)} />

      <WeightCsvExportForm
        hamsters={hamsters.map(({ id, name, isActive }) => ({ id, name, isActive }))}
        hamsterSelectorMode={hamsterSelectorMode}
        selectedHamsterId={selectedHamsterId}
        selectedMonth={normalizedMonth}
      />
    </div>
  );
}
