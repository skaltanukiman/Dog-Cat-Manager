import { Download } from "lucide-react";

type PetWeightCsvExportPetOption = {
  id: string;
  name: string;
  species: "DOG" | "CAT";
  isActive: boolean;
};

export function PetWeightCsvExportForm({ pets }: { pets: PetWeightCsvExportPetOption[] }) {
  return (
    <form method="get" action="/weights/export/download" className="space-y-6">
      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="export-target-heading">
        <h3 id="export-target-heading" className="text-base font-bold text-ink">出力対象</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Pet
            <select name="petId" defaultValue="">
              <option value="">すべて</option>
              {pets.map((pet) => (
                <option key={pet.id} value={pet.id}>
                  {pet.name}（{pet.species}）{pet.isActive ? "" : "・管理終了"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            年月
            <input type="month" name="month" />
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-500">年月を指定しない場合は、全期間を出力します。</p>
      </section>

      <section className="rounded-md border border-slate-200 bg-slate-50 p-5 shadow-sm" aria-labelledby="export-format-heading">
        <h3 id="export-format-heading" className="text-base font-bold text-ink">出力形式</h3>
        <fieldset className="mt-4 grid gap-3">
          <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3">
            <input className="mt-0.5" type="radio" name="format" value="standard" defaultChecked />
            <span className="text-sm text-slate-700"><span className="block font-semibold">標準</span><span className="block text-xs text-slate-500">閲覧・表計算ソフト向け</span></span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3">
            <input className="mt-0.5" type="radio" name="format" value="detailed" />
            <span className="text-sm text-slate-700"><span className="block font-semibold">詳細</span><span className="block text-xs text-slate-500">ID・登録日時なども含むバックアップ向け</span></span>
          </label>
        </fieldset>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="csv-download-heading">
        <h3 id="csv-download-heading" className="text-base font-bold text-ink">CSVダウンロード</h3>
        <button type="submit" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark sm:w-auto">
          <Download className="h-4 w-4" aria-hidden />
          CSVをダウンロード
        </button>
      </section>
    </form>
  );
}
