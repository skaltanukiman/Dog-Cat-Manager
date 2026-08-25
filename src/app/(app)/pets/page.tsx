import { Archive, RotateCcw, Save } from "lucide-react";

import { updatePet, updatePetActiveStatus } from "@/app/actions/pets";
import { BreedCombobox } from "@/components/breed-combobox";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { PetCreateForm } from "@/components/pet-create-form";
import { PetDeleteControl } from "@/components/pet-delete-control";
import { PetDeleteSuccessProvider } from "@/components/pet-delete-success-provider";
import { PetImageField } from "@/components/pet-image-field";
import { PetNotificationRulesForm } from "@/components/pet-notification-rules-form";
import { PetSpeciesBadge } from "@/components/pet-species-badge";
import { StatusMessage } from "@/components/status-message";
import { TutorialPetCreatedBridge } from "@/components/tutorial-pet-created-bridge";
import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { toDateInputValue, todayInputJst } from "@/lib/date";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
  searchParams: Promise<{
    status?: string | string[];
    errorId?: string | string[];
    createdPetId?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const context = await getRequiredHouseholdContext();
  const canEdit = canEditHouseholdSharedData(context.membership.role);
  const [pets, breeds] = await Promise.all([
    prisma.pet.findMany({
      where: { householdId: context.household.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        breedMaster: { select: { nameJa: true } },
        notificationRules: {
          where: { userId: context.user.id, householdId: context.household.id },
          orderBy: [{ kind: "asc" }, { deadlineMinutes: "asc" }, { id: "asc" }],
          select: {
            kind: true,
            label: true,
            deadlineMinutes: true,
            notifyBeforeMinutes: true,
            enabled: true
          }
        }
      }
    }),
    prisma.breed.findMany({
      where: { isActive: true },
      orderBy: [{ species: "asc" }, { isPopular: "desc" }, { sortOrder: "asc" }, { nameJa: "asc" }],
      select: {
        id: true,
        species: true,
        nameJa: true,
        nameKana: true,
        nameEn: true,
        isPopular: true,
        sortOrder: true
      }
    })
  ]);
  const createdPet =
    getParam(params.status) === "created"
      ? pets.find((pet) => pet.id === getParam(params.createdPetId))
      : undefined;
  // 誕生日とお迎え日は暦日として扱い、未来日をブラウザとServer Actionの両方で拒否する。
  const today = todayInputJst();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">犬・猫管理</h2>
        <p className="mt-1 text-sm text-slate-600">犬と猫の基本プロフィールを管理します。</p>
      </div>

      <PetDeleteSuccessProvider>
        <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />
        {createdPet ? <TutorialPetCreatedBridge petId={createdPet.id} /> : null}

        {canEdit ? (
          <section
            data-tutorial="pet-create-form"
            className="rounded-md border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h3 className="text-base font-bold text-ink">新規登録</h3>
            <PetCreateForm breeds={breeds} today={today} />
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
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${pet.isActive ? "bg-highlight/40 text-slate-700" : "bg-slate-200 text-slate-600"}`}>
                      {pet.isActive ? "管理中" : "管理終了"}
                    </span>
                    <PetSpeciesBadge species={pet.species} />
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
                  className="grid items-start gap-3 md:grid-cols-2 lg:grid-cols-4"
                >
                  <input type="hidden" name="id" value={pet.id} />
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    名前
                    <input className="h-10" name="name" required maxLength={15} defaultValue={pet.name} readOnly={!canEdit} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    種類
                    <span className="flex h-10 w-full items-center rounded-md border border-slate-200 bg-slate-50 px-3">
                      <PetSpeciesBadge species={pet.species} />
                    </span>
                    <span className="text-xs font-normal text-slate-500">種類は登録後変更できません</span>
                  </label>
                  <BreedCombobox
                    breeds={breeds}
                    species={pet.species}
                    initialBreedId={pet.breedId}
                    initialBreedName={pet.breedMaster?.nameJa}
                    initialCustomBreedName={pet.customBreedName}
                    disabled={!canEdit}
                  />
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    <span>
                      性別
                      <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
                    </span>
                    <select className="h-10" name="sex" defaultValue={pet.sex} disabled={!canEdit}>
                      {Object.entries(SEX_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    <span>
                      誕生日
                      <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
                    </span>
                    <input className="h-10" type="date" name="birthDate" max={today} defaultValue={pet.birthDate ? toDateInputValue(pet.birthDate) : ""} readOnly={!canEdit} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    <span>
                      お迎え日
                      <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
                    </span>
                    <input className="h-10" type="date" name="adoptionDate" max={today} defaultValue={pet.adoptionDate ? toDateInputValue(pet.adoptionDate) : ""} readOnly={!canEdit} />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2 lg:col-span-2">
                    <span>
                      メモ
                      <span className="ml-1 text-xs font-normal text-slate-500">（任意）</span>
                    </span>
                    <input className="h-10" name="memo" maxLength={2000} defaultValue={pet.memo ?? ""} readOnly={!canEdit} />
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
                    <DirtySubmitButton className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-brand px-4 text-sm font-semibold text-brand hover:bg-brand-dark hover:text-white md:col-span-2 lg:col-span-4 lg:justify-self-end">
                      <Save className="h-4 w-4" aria-hidden />
                      保存
                    </DirtySubmitButton>
                  ) : null}
                </form>
                <PetNotificationRulesForm
                  petId={pet.id}
                  petName={pet.name}
                  species={pet.species}
                  isActive={pet.isActive}
                  careDayStartMinutes={context.household.careDayStartMinutes}
                  initialRules={pet.notificationRules}
                />
                {canEdit && !pet.isActive ? <PetDeleteControl petId={pet.id} petName={pet.name} /> : null}
              </article>
            ))}
          </div>
        )}
        </section>
      </PetDeleteSuccessProvider>
    </div>
  );
}
