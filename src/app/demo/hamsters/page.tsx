import { DemoUnavailable } from "@/components/demo-unavailable";
import { HamsterList } from "@/components/hamster-list";
import { toDateInputValue, todayInputJst } from "@/lib/date";
import { getPublicDemoHamsterManagementData } from "@/lib/public-demo-queries";

export const dynamic = "force-dynamic";

export default async function DemoHamstersPage() {
  const data = await getPublicDemoHamsterManagementData();
  if (!data) return <DemoUnavailable />;

  const hamsters = data.hamsters.map((hamster) => ({
    id: hamster.id,
    name: hamster.name,
    memo: hamster.memo,
    birthDate: hamster.birthDate ? toDateInputValue(hamster.birthDate) : "",
    adoptionDate: hamster.adoptionDate ? toDateInputValue(hamster.adoptionDate) : "",
    isActive: hamster.isActive,
    profileImageFileName: null,
    staticImagePath: hamster.staticImagePath,
    cleaningRecordCount: hamster._count.cleaningRecords,
    weightRecordCount: hamster._count.weightRecords
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">ハムスター管理</h2>
        <p className="mt-1 text-sm text-slate-600">
          管理中・管理外のプロフィールと記録件数を閲覧できます。
        </p>
      </div>
      <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        サンプル閲覧モードでは、登録・編集・削除、画像変更、管理状態の変更はできません。
      </p>
      <section className="space-y-3">
        <h3 className="text-base font-bold text-ink">一覧</h3>
        <HamsterList hamsters={hamsters} today={todayInputJst()} readOnly />
      </section>
    </div>
  );
}
