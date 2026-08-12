import { Archive, Plus, RotateCcw, Save } from "lucide-react";

import { createPet, updatePet, updatePetActiveStatus } from "@/app/actions/pets";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { PetImageField } from "@/components/pet-image-field";
import { StatusMessage } from "@/components/status-message";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { toDateInputValue, todayInputJst } from "@/lib/date";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SPECIES_LABELS = {
  DOG: "犬",
  CAT: "猫"
} as const;

const SEX_LABELS = {
  MALE: "オス",
  FEMALE: "メス",
  UNKNOWN: "不明"
} as const;

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PetsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);
  const pets = await prisma.pet.findMany({
    where: { householdId: context.household.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  // 誕生日とお迎え日は暦日として扱い、未来日をブラウザとServer Actionの両方で拒否する。
  const today = todayInputJst();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">犬・猫管理</h2>
        <p className="mt-1 text-sm text-slate-600">犬と猫の基本プロフィールを管理します。</p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      {canEdit ? (
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold text-ink">新規登録</h3>
          <form action={createPet} data-dirty-watch className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              名前
              <input name="name" required maxLength={50} placeholder="例: こむぎ" />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              種類
              <select name="species" required defaultValue="">
                <option value="" disabled>選択してください</option>
                <option value="DOG">犬</option>
                <option value="CAT">猫</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              品種
              <input name="breed" maxLength={100} placeholder="例: 柴犬" />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              性別
              <select name="sex" defaultValue="UNKNOWN">
                <option value="MALE">オス</option>
                <option value="FEMALE">メス</option>
                <option value="UNKNOWN">不明</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              誕生日
              <input type="date" name="birthDate" max={today} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              お迎え日
              <input type="date" name="adoptionDate" max={today} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2 lg:col-span-2">
              メモ
              <input name="memo" maxLength={2000} placeholder="性格、注意点など" />
            </label>
            <div className="md:col-span-2 lg:col-span-4">
              <PetImageField petName="新しいPet" />
            </div>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-moss/90 md:col-span-2 lg:col-span-4 lg:justify-self-end"
            >
              <Plus className="h-4 w-4" aria-hidden />
              登録
            </button>
          </form>
        </section>
      ) : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          閲覧者はPetの登録・編集・管理状態の変更を実行できません。
        </p>
      )}

      <section className="space-y-3">
        <h3 className="text-base font-bold text-ink">一覧</h3>
        {pets.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            登録済みの犬・猫はいません。
          </div>
        ) : (
          <div className="grid gap-3">
            {pets.map((pet) => (
              <article key={pet.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${pet.isActive ? "bg-straw/40 text-slate-700" : "bg-slate-200 text-slate-600"}`}>
                      {pet.isActive ? "管理中" : "管理終了"}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">{SPECIES_LABELS[pet.species]}</span>
                  </div>
                  {canEdit ? (
                    <form action={updatePetActiveStatus}>
                      <input type="hidden" name="id" value={pet.id} />
                      <input type="hidden" name="isActive" value={String(!pet.isActive)} />
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {pet.isActive ? <Archive className="h-4 w-4" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                        {pet.isActive ? "管理終了にする" : "管理中に戻す"}
                      </button>
                    </form>
                  ) : null}
                </div>

                <form
                  action={canEdit ? updatePet : undefined}
                  data-dirty-watch={canEdit ? true : undefined}
                  className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"
                >
                  <input type="hidden" name="id" value={pet.id} />
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    名前
                    <input name="name" required maxLength={50} defaultValue={pet.name} readOnly={!canEdit} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    種類
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                      {SPECIES_LABELS[pet.species]}
                    </span>
                    <span className="text-xs font-normal text-slate-500">種類は登録後変更できません</span>
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    品種
                    <input name="breed" maxLength={100} defaultValue={pet.breed ?? ""} readOnly={!canEdit} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    性別
                    <select name="sex" defaultValue={pet.sex} disabled={!canEdit}>
                      {Object.entries(SEX_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    誕生日
                    <input type="date" name="birthDate" max={today} defaultValue={pet.birthDate ? toDateInputValue(pet.birthDate) : ""} readOnly={!canEdit} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    お迎え日
                    <input type="date" name="adoptionDate" max={today} defaultValue={pet.adoptionDate ? toDateInputValue(pet.adoptionDate) : ""} readOnly={!canEdit} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2 lg:col-span-2">
                    メモ
                    <input name="memo" maxLength={2000} defaultValue={pet.memo ?? ""} readOnly={!canEdit} />
                  </label>
                  <div className="md:col-span-2 lg:col-span-4">
                    <PetImageField
                      petId={pet.id}
                      petName={pet.name}
                      currentFileName={pet.profileImageFileName}
                      disabled={!canEdit}
                    />
                  </div>
                  {canEdit ? (
                    <DirtySubmitButton className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-moss px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white md:col-span-2 lg:col-span-4 lg:justify-self-end">
                      <Save className="h-4 w-4" aria-hidden />
                      保存
                    </DirtySubmitButton>
                  ) : null}
                </form>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
