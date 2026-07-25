import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { WeightCsvImportForm } from "@/components/weight-csv-import-form";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

export default async function GasWeightCsvImportPage() {
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">GAS版（旧版）からデータ移行</h2>
          <p className="mt-1 text-sm text-slate-600">GAS版から出力した体重管理CSVを取り込みます。</p>
        </div>
        <Link href="/weights/import" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          CSVの種類選択へ戻る
        </Link>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <h3 className="text-base font-bold text-ink">取り込み対象CSV</h3>
        <p className="mt-2">ヘッダー行あり、UTF-8、カンマ区切りのCSVに対応しています。</p>
        <p className="mt-1">
          必須列は <span className="font-semibold text-ink">date</span>、<span className="font-semibold text-ink">hamster</span>、
          <span className="font-semibold text-ink">weight</span> です。
        </p>
        <p className="mt-1 font-semibold text-amber-700">
          この機能は新規移行専用です。同じハムスター・同じ測定日の既存記録は更新せずスキップします。
        </p>
      </section>

      {canEdit ? <WeightCsvImportForm mode="gas" /> : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          閲覧者は体重CSVのインポートを実行できません。
        </p>
      )}
    </div>
  );
}
