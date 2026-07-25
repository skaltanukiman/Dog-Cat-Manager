import { Plus } from "lucide-react";

import { createHamster } from "@/app/actions/hamsters";
import { HamsterImageField } from "@/components/hamster-image-field";
import { HamsterList } from "@/components/hamster-list";
import { StatusMessage } from "@/components/status-message";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { toDateInputValue, todayInputJst } from "@/lib/date";
import { getHamsterManagementData } from "@/lib/queries";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HamstersPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  const status = getParam(params.status);
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);
  const hamsters = await getHamsterManagementData();
  const hamsterListItems = hamsters.map((hamster) => ({
    id: hamster.id,
    name: hamster.name,
    memo: hamster.memo,
    birthDate: hamster.birthDate ? toDateInputValue(hamster.birthDate) : "",
    adoptionDate: hamster.adoptionDate ? toDateInputValue(hamster.adoptionDate) : "",
    isActive: hamster.isActive,
    profileImageFileName: hamster.profileImageFileName,
    cleaningRecordCount: hamster._count.cleaningRecords,
    weightRecordCount: hamster._count.weightRecords
  }));
  // 誕生日とお迎え日は過去から今日までの日付だけを扱うため、入力欄側でも未来日を選ばせない。
  const today = todayInputJst();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">ハムスター管理</h2>
        <p className="mt-1 text-sm text-slate-600">ハムスターの情報を管理します。</p>
      </div>

      <StatusMessage status={status} errorId={getParam(params.errorId)} />

      {canEdit ? <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-bold text-ink">新規登録</h3>
        <form
          action={createHamster}
          data-dirty-watch
          className="mt-4 grid gap-4 lg:grid-cols-[minmax(150px,200px)_160px_160px_1fr_auto]"
        >
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            名前
            <input name="name" required maxLength={15} placeholder="例: きなこ" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            誕生日
            <input type="date" name="birthDate" max={today} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            お迎え日
            <input type="date" name="adoptionDate" max={today} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            メモ
            <input name="memo" maxLength={2000} placeholder="性格、注意点など" />
          </label>
          <div className="min-w-0 lg:col-span-5 lg:row-start-2">
            <HamsterImageField />
          </div>
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center gap-2 self-end rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-moss/90 lg:col-start-5 lg:row-start-1 lg:w-auto"
          >
            <Plus className="h-4 w-4" aria-hidden />
            登録
          </button>
        </form>
      </section> : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          閲覧者はハムスターの登録・編集・削除、画像変更、管理状態の変更を実行できません。
        </p>
      )}

      <section className="space-y-3">
        <h3 className="text-base font-bold text-ink">一覧</h3>
        {hamsters.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            登録済みハムスターはありません。
          </div>
        ) : (
          <HamsterList
            hamsters={hamsterListItems}
            today={today}
            initialSortTarget="registered"
            initialSortDirection={status === "created" ? "desc" : "asc"}
            readOnly={!canEdit}
          />
        )}
      </section>
    </div>
  );
}
