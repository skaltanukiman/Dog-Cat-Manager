import Link from "next/link";
import { ArrowLeft, DatabaseZap, FilePenLine } from "lucide-react";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

export default async function WeightCsvImportPage() {
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">体重CSVインポート</h2>
          <p className="mt-1 text-sm text-slate-600">利用するCSVの種類を選んでください。</p>
        </div>
        <Link
          href="/weights"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          体重管理へ戻る
        </Link>
      </div>

      {canEdit ? <div className="grid gap-4 md:grid-cols-2">
        <Link href="/weights/import/app" className="rounded-md border border-moss bg-white p-5 shadow-sm transition hover:bg-moss/5">
          <FilePenLine className="h-7 w-7 text-moss" aria-hidden />
          <h3 className="mt-3 text-base font-bold text-ink">アプリ版CSVで一括編集</h3>
          <p className="mt-2 text-sm text-slate-600">
            このアプリからエクスポートしたCSVを編集し、既存記録の更新と新規追加をまとめて行います。
          </p>
        </Link>
        <Link href="/weights/import/gas" className="rounded-md border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50">
          <DatabaseZap className="h-7 w-7 text-slate-600" aria-hidden />
          <h3 className="mt-3 text-base font-bold text-ink">GAS版（旧版）からデータ移行</h3>
          <p className="mt-2 text-sm text-slate-600">
            GAS版から出力したCSVを新規登録します。既存のハムスター・測定日は更新せずスキップします。
          </p>
        </Link>
      </div> : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          閲覧者は体重CSVのインポート・一括編集を実行できません。
        </p>
      )}
    </div>
  );
}
