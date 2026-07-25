"use client";

import {
  CheckSquare,
  Save,
  Search,
  Square,
  Trash2
} from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import { deleteHamsters, updateHamster } from "@/app/actions/hamsters";
import { ClientPagination } from "@/components/client-pagination";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { HamsterActiveStatusForm } from "@/components/hamster-active-status-form";
import { HamsterImageField } from "@/components/hamster-image-field";
import { SelectionActionBar } from "@/components/selection-action-bar";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import { normalizeSearchText } from "@/lib/search";

type HamsterListItem = {
  id: string;
  name: string;
  memo: string | null;
  birthDate: string;
  adoptionDate: string;
  isActive: boolean;
  profileImageFileName: string | null;
  staticImagePath?: string | null;
  cleaningRecordCount: number;
  weightRecordCount: number;
};

type SortTarget = "registered" | "name";
type SortDirection = "asc" | "desc";

type HamsterListProps = {
  hamsters: HamsterListItem[];
  today: string;
  initialSortTarget?: SortTarget;
  initialSortDirection?: SortDirection;
  readOnly?: boolean;
};

const HAMSTER_LIST_PAGE_SIZE = 20;

export function HamsterList({
  hamsters,
  today,
  initialSortTarget = "registered",
  initialSortDirection = "asc",
  readOnly = false
}: HamsterListProps) {
  const [sortTarget, setSortTarget] = useState<SortTarget>(initialSortTarget);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSortDirection);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<string[]>([]);

  const filteredHamsters = useMemo(() => {
    const normalizedSearchTerm = normalizeSearchText(searchTerm);
    const searchedHamsters =
      normalizedSearchTerm.length > 0
        ? hamsters.filter((hamster) => normalizeSearchText(hamster.name).includes(normalizedSearchTerm))
        : hamsters;

    // 検索で絞り込んだ結果に対し、表示対象と並び順の組み合わせで表示順だけを変える。
    if (sortTarget === "registered") {
      return sortDirection === "asc" ? searchedHamsters : [...searchedHamsters].reverse();
    }

    return [...searchedHamsters].sort((a, b) => {
      const result = a.name.localeCompare(b.name, "ja");
      return sortDirection === "asc" ? result : -result;
    });
  }, [hamsters, searchTerm, sortDirection, sortTarget]);

  const totalPages = Math.max(Math.ceil(filteredHamsters.length / HAMSTER_LIST_PAGE_SIZE), 1);
  const currentPage = Math.min(currentPageNumber, totalPages);
  const pagedHamsters = filteredHamsters.slice(
    (currentPage - 1) * HAMSTER_LIST_PAGE_SIZE,
    currentPage * HAMSTER_LIST_PAGE_SIZE
  );
  const selectedDeleteIdSet = new Set(selectedDeleteIds);

  function resetDeleteSelection() {
    setSelectedDeleteIds([]);
  }

  function handlePageChange(page: number) {
    setCurrentPageNumber(page);
    resetDeleteSelection();
  }

  function handleDeleteTargetToggle(hamsterId: string) {
    setSelectedDeleteIds((current) =>
      current.includes(hamsterId) ? current.filter((id) => id !== hamsterId) : [...current, hamsterId]
    );
  }

  function handleSelectAllVisibleHamsters() {
    setSelectedDeleteIds(pagedHamsters.map((hamster) => hamster.id));
  }

  function handleBulkDeleteSubmit(event: FormEvent<HTMLFormElement>) {
    if (selectedDeleteIds.length === 0) {
      event.preventDefault();
      return;
    }

    if (!window.confirm(`${selectedDeleteIds.length}件のハムスターを削除します。本当に削除してもよろしいですか？`)) {
      event.preventDefault();
    }
  }

  return (
    <UnsavedChangesGuard>
      <div className="space-y-3">
      <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[160px_160px_1fr]">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          表示
          <select
            value={sortTarget}
            onChange={(event) => {
              setSortTarget(event.currentTarget.value as SortTarget);
              setCurrentPageNumber(1);
              resetDeleteSelection();
            }}
          >
            <option value="registered">登録順</option>
            <option value="name">名前</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          並び順
          <select
            value={sortDirection}
            onChange={(event) => {
              setSortDirection(event.currentTarget.value as SortDirection);
              setCurrentPageNumber(1);
              resetDeleteSelection();
            }}
          >
            <option value="asc">昇順</option>
            <option value="desc">降順</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          検索ワード
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.currentTarget.value);
                setCurrentPageNumber(1);
                resetDeleteSelection();
              }}
              className="pl-9"
              placeholder="ハムスター名で検索"
            />
          </span>
        </label>
      </div>

      {filteredHamsters.length > 0 ? (
        <ClientPagination
          ariaLabel="ハムスター一覧のページ移動"
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={filteredHamsters.length}
          pageSize={HAMSTER_LIST_PAGE_SIZE}
          visibleCount={pagedHamsters.length}
          onPageChange={handlePageChange}
        />
      ) : null}

      {!readOnly ? <SelectionActionBar selectedCount={selectedDeleteIds.length}>
        <button
          type="button"
          onClick={handleSelectAllVisibleHamsters}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <CheckSquare className="h-4 w-4" aria-hidden />
          全選択
        </button>
        <button
          type="button"
          onClick={resetDeleteSelection}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Square className="h-4 w-4" aria-hidden />
          全解除
        </button>
        <form action={deleteHamsters} onSubmit={handleBulkDeleteSubmit}>
          {selectedDeleteIds.map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            削除
          </button>
        </form>
      </SelectionActionBar> : null}

      {filteredHamsters.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          条件に一致するハムスターはいません。
        </div>
      ) : (
        <div className="grid gap-3">
          {pagedHamsters.map((hamster) => {
            const isLocked = !hamster.isActive;

            return (
              <article key={hamster.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {!readOnly ? <label className="inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedDeleteIdSet.has(hamster.id)}
                      onChange={() => handleDeleteTargetToggle(hamster.id)}
                      className="h-4 w-4 rounded border-slate-300 text-moss"
                    />
                    <span className="sr-only">{hamster.name}を選択</span>
                  </label> : null}
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${
                      hamster.isActive ? "bg-straw/40 text-slate-700" : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {hamster.isActive ? "管理中" : "管理外"}
                  </span>
                  {!readOnly ? <div className="hidden lg:block">
                    <HamsterActiveStatusForm hamsterId={hamster.id} isActive={hamster.isActive} compact />
                  </div> : null}
                  {isLocked ? <span className="text-xs text-slate-500">記録とプロフィール編集をロック中</span> : null}
                </div>
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <form
                    action={readOnly ? undefined : updateHamster}
                    data-dirty-watch={readOnly ? undefined : true}
                    className="grid gap-3 lg:grid-cols-[minmax(140px,180px)_160px_160px_1fr_auto]"
                  >
                    <input type="hidden" name="id" value={hamster.id} />
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      名前
                      <input name="name" required maxLength={15} defaultValue={hamster.name} disabled={isLocked} readOnly={readOnly} />
                    </label>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      誕生日
                      <input type="date" name="birthDate" max={today} defaultValue={hamster.birthDate} disabled={isLocked} readOnly={readOnly} />
                    </label>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      お迎え日
                      <input type="date" name="adoptionDate" max={today} defaultValue={hamster.adoptionDate} disabled={isLocked} readOnly={readOnly} />
                    </label>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      メモ
                      <input name="memo" maxLength={2000} defaultValue={hamster.memo ?? ""} disabled={isLocked} readOnly={readOnly} />
                    </label>
                    <div className="min-w-0 lg:col-span-5 lg:row-start-2">
                      <HamsterImageField
                        hamsterId={hamster.id}
                        hamsterName={hamster.name}
                        currentFileName={hamster.profileImageFileName}
                        staticImagePath={readOnly ? hamster.staticImagePath : null}
                        mode={readOnly ? "preview" : "interactive"}
                        disabled={isLocked}
                      />
                    </div>
                    {readOnly ? (
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        title="サンプル閲覧モードでは保存できません"
                        className="inline-flex h-10 w-full items-center justify-center gap-2 self-end rounded-md border border-slate-300 bg-slate-100 px-4 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-100 lg:col-start-5 lg:row-start-1 lg:w-auto"
                      >
                        <Save className="h-4 w-4" aria-hidden />
                        保存
                      </button>
                    ) : (
                      <DirtySubmitButton
                        disabled={isLocked}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 self-end rounded-md border border-moss px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 lg:col-start-5 lg:row-start-1 lg:w-auto"
                      >
                        <Save className="h-4 w-4" aria-hidden />
                        保存
                      </DirtySubmitButton>
                    )}
                  </form>
                  {!readOnly ? <div className="flex w-full flex-wrap items-end gap-2 lg:hidden">
                    <HamsterActiveStatusForm hamsterId={hamster.id} isActive={hamster.isActive} />
                  </div> : null}
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  掃除記録 {hamster.cleaningRecordCount}件 / 体重記録 {hamster.weightRecordCount}件
                </p>
              </article>
            );
          })}
        </div>
      )}
      {filteredHamsters.length > 0 && totalPages > 1 ? (
        <ClientPagination
          ariaLabel="ハムスター一覧のページ移動"
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={filteredHamsters.length}
          pageSize={HAMSTER_LIST_PAGE_SIZE}
          visibleCount={pagedHamsters.length}
          onPageChange={handlePageChange}
        />
      ) : null}
      </div>
    </UnsavedChangesGuard>
  );
}
