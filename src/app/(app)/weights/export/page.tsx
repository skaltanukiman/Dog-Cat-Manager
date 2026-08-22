import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PetWeightCsvExportForm } from "@/components/pet-weight-csv-export-form";
import { getPetWeightExportPets } from "@/lib/pet-weight-queries";

export const dynamic = "force-dynamic";

export default async function PetWeightExportPage() {
  const pets = await getPetWeightExportPets();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">体重CSVエクスポート</h2>
          <p className="mt-1 text-sm text-slate-600">体重記録をCSVファイルとして保存できます。</p>
        </div>
        <Link href="/weights" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          体重管理へ戻る
        </Link>
      </div>

      <PetWeightCsvExportForm pets={pets} />
    </div>
  );
}
