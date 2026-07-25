import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { WeightCsvImportForm } from "@/components/weight-csv-import-form";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

export default async function AppWeightCsvImportPage() {
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">アプリ版CSVで一括編集</h2>
          <p className="mt-1 text-sm text-slate-600">エクスポートした体重CSVの編集内容をまとめて反映します。</p>
        </div>
        <Link href="/weights/import" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          CSVの種類選択へ戻る
        </Link>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <h3 className="text-base font-bold text-ink">利用方法</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            体重CSVエクスポートで「連携用の必須列を出力する」をオンにし、date、hamster、weight_gを含めてダウンロードします。
          </li>
          <li>date、hamster、weight_gを編集します。新規行はrecord_idを空欄にします。</li>
          <li>編集したCSVをこの画面からインポートします。</li>
        </ol>
        <p className="mt-3 font-semibold text-amber-700">
          record_id、app_id、record_type、schema_versionは編集しないでください。エラーが1件でもある場合は全件を反映しません。
        </p>
      </section>

      {canEdit ? <WeightCsvImportForm mode="app" /> : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          閲覧者は体重CSVによる一括編集を実行できません。
        </p>
      )}
    </div>
  );
}
