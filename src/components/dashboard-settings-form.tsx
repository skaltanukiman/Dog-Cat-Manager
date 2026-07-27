"use client";

import { Save, Search } from "lucide-react";
import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";

import { saveSettings } from "@/app/actions/settings";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { ProfileSettingsFields } from "@/components/profile-settings-form";
import { SETTINGS_CARD_RESPONSIVE_PADDING } from "@/components/settings-layout";
import { SettingsScrollToSaveButton } from "@/components/settings-scroll-to-save-button";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import type { CleaningMobileDefaultDateFilter } from "@/lib/cleaning-settings";
import {
  MAX_DASHBOARD_BOARD_COUNT,
  MIN_DASHBOARD_BOARD_COUNT,
  type HamsterSelectorMode
} from "@/lib/dashboard-settings";
import type { RecordScope } from "@/lib/records";
import { normalizeSearchText } from "@/lib/search";

type HamsterOption = {
  id: string;
  name: string;
  memo: string | null;
  isActive: boolean;
};

type DashboardSettingsFormProps = {
  name?: string | null;
  email?: string | null;
  boardCount: number;
  hamsterSelectorMode: HamsterSelectorMode;
  recordTimelineDefaultScope: RecordScope;
  cleaningMobileDefaultDateFilter: CleaningMobileDefaultDateFilter;
  hamsters: HamsterOption[];
  selectedHamsterIds: string[];
};

type HamsterStatusFilter = "all" | "active" | "inactive" | "selected";

const HAMSTER_STATUS_FILTERS: { value: HamsterStatusFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "active", label: "管理中" },
  { value: "inactive", label: "管理外" },
  { value: "selected", label: "選択済み" }
];

function clampBoardCount(value: number) {
  return Math.min(MAX_DASHBOARD_BOARD_COUNT, Math.max(MIN_DASHBOARD_BOARD_COUNT, Math.trunc(value)));
}

export function DashboardSettingsForm({
  name,
  email,
  boardCount,
  hamsterSelectorMode,
  recordTimelineDefaultScope,
  cleaningMobileDefaultDateFilter,
  hamsters,
  selectedHamsterIds
}: DashboardSettingsFormProps) {
  const [limit, setLimit] = useState(boardCount);
  const [selectedIds, setSelectedIds] = useState(selectedHamsterIds);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<HamsterStatusFilter>("all");
  const hamsterIds = useMemo(() => hamsters.map((hamster) => hamster.id), [hamsters]);
  const needsSelection = hamsters.length > limit;
  // 登録数が表示数以下なら個別選択は不要なので、全ハムスターを送信対象として扱う。
  const effectiveSelectedIds = needsSelection ? selectedIds : hamsterIds;
  const selectedIdSet = useMemo(() => new Set(effectiveSelectedIds), [effectiveSelectedIds]);
  const filteredHamsters = useMemo(() => {
    const normalizedSearchTerm = normalizeSearchText(searchTerm);

    return hamsters.filter((hamster) => {
      const matchesSearch = normalizeSearchText(hamster.name).includes(normalizedSearchTerm);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && hamster.isActive) ||
        (statusFilter === "inactive" && !hamster.isActive) ||
        (statusFilter === "selected" && selectedIdSet.has(hamster.id));

      return matchesSearch && matchesStatus;
    });
  }, [hamsters, searchTerm, selectedIdSet, statusFilter]);
  const targetCount = Math.min(limit, hamsters.length);
  const canSave = effectiveSelectedIds.length === targetCount;

  function handleLimitChange(event: ChangeEvent<HTMLInputElement>) {
    const nextLimit = clampBoardCount(event.currentTarget.valueAsNumber || MIN_DASHBOARD_BOARD_COUNT);
    const nextNeedsSelection = hamsters.length > nextLimit;
    const nextSelectedIds = selectedIds.filter((id) => hamsterIds.includes(id));

    // 表示数を減らした場合は、保存可能な件数に収まるよう現在の選択を先頭から残す。
    setLimit(nextLimit);
    setSelectedIds(
      nextNeedsSelection
        ? (nextSelectedIds.length > 0 ? nextSelectedIds : hamsterIds).slice(0, nextLimit)
        : hamsterIds
    );
  }

  function handleToggle(hamsterId: string) {
    if (!needsSelection) {
      return;
    }

    setSelectedIds((current) => {
      if (current.includes(hamsterId)) {
        return current.filter((id) => id !== hamsterId);
      }

      if (current.length >= limit) {
        return current;
      }

      return [...current, hamsterId];
    });
  }

  return (
    <UnsavedChangesGuard>
      <SettingsScrollToSaveButton />

      <form action={saveSettings} data-dirty-watch className="space-y-6">
      <ProfileSettingsFields name={name} email={email} />

      <div
        className={`space-y-5 rounded-md border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_RESPONSIVE_PADDING}`}
      >
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          表示ボード数
          <input
            type="number"
            name="dashboardBoardCount"
            min={MIN_DASHBOARD_BOARD_COUNT}
            max={MAX_DASHBOARD_BOARD_COUNT}
            value={limit}
            onChange={handleLimitChange}
            required
          />
          <span className="text-xs font-normal text-slate-500">
            設定できる範囲: {MIN_DASHBOARD_BOARD_COUNT}〜{MAX_DASHBOARD_BOARD_COUNT} 件
          </span>
        </label>
        <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          現在の表示対象: {effectiveSelectedIds.length} / {targetCount} 件
          <span className="block pt-1">表示ボード数の上限は {MAX_DASHBOARD_BOARD_COUNT} 件です。</span>
          {needsSelection ? (
            <span className="block pt-1">表示するハムスターを {targetCount} 件選択します。</span>
          ) : (
            <span className="block pt-1">登録数が表示数以下のため、全ハムスターを表示します。</span>
          )}
          {!canSave ? <span className="block pt-1 text-red-600">表示対象を {targetCount} 件選択してください。</span> : null}
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-bold text-ink">ハムスター選択方式</h3>
        <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <input
              type="radio"
              name="hamsterSelectorMode"
              value="combobox"
              defaultChecked={hamsterSelectorMode === "combobox"}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold text-ink">コンボボックス式</span>
              <span className="mt-1 block text-xs text-slate-500">文字入力で候補を絞り込みながら選択します。</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <input
              type="radio"
              name="hamsterSelectorMode"
              value="select"
              defaultChecked={hamsterSelectorMode === "select"}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold text-ink">プルダウン式</span>
              <span className="mt-1 block text-xs text-slate-500">一覧から選択する形式で表示します。</span>
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-bold text-ink">記録画面の初期表示</h3>
        <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <input
              type="radio"
              name="recordTimelineDefaultScope"
              value="hamster"
              defaultChecked={recordTimelineDefaultScope === "hamster"}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold text-ink">選択中のハムスター</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                記録画面を開いたとき、選択した1匹の記録を表示します。
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <input
              type="radio"
              name="recordTimelineDefaultScope"
              value="household"
              defaultChecked={recordTimelineDefaultScope === "household"}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold text-ink">グループ全体</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                記録画面を開いたとき、現在の共有グループに所属する全ハムスターの記録を表示します。
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-bold text-ink">衛生管理画面（スマホ）の初期表示</h3>
        <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <input
              type="radio"
              name="cleaningMobileDefaultDateFilter"
              value="today"
              defaultChecked={cleaningMobileDefaultDateFilter === "today"}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold text-ink">当日のみ</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                衛生管理画面をスマートフォンで開いたとき、今日の入力欄だけを表示します。
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <input
              type="radio"
              name="cleaningMobileDefaultDateFilter"
              value="all"
              defaultChecked={cleaningMobileDefaultDateFilter === "all"}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold text-ink">すべての日付</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                衛生管理画面をスマートフォンで開いたとき、その月の入力欄をすべて表示します。
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* disabled の checkbox は送信されないため、保存対象IDは hidden input に正規化して渡す。 */}
      {effectiveSelectedIds.map((id) => (
        <input key={id} type="hidden" name="hamsterIds" value={id} data-dirty-control />
      ))}

      <section className="space-y-3">
        <h3 className="text-base font-bold text-ink">ダッシュボードに表示するハムスター</h3>
        {hamsters.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            ハムスターがまだ登録されていません。
          </div>
        ) : (
          <>
            <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                検索ワード
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.currentTarget.value)}
                    className="pl-9"
                    placeholder="ハムスター名で検索"
                  />
                </span>
              </label>
              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-slate-700">状態</span>
                <div
                  className="grid grid-cols-4 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-wrap sm:gap-2 sm:rounded-none sm:bg-transparent sm:p-0"
                  aria-label="ハムスターの状態で絞り込む"
                >
                  {HAMSTER_STATUS_FILTERS.map((filter) => {
                    const isSelected = statusFilter === filter.value;

                    return (
                      <button
                        key={filter.value}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setStatusFilter(filter.value)}
                        className={`flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-1 sm:min-h-0 sm:rounded-md sm:border sm:px-3 sm:py-1.5 sm:text-sm sm:font-semibold ${
                          isSelected
                            ? "bg-moss/10 text-moss ring-1 ring-inset ring-moss/20 sm:border-moss sm:bg-moss sm:text-white sm:ring-0"
                            : "text-slate-600 hover:bg-white/70 hover:text-ink sm:border-slate-300 sm:bg-white sm:text-slate-700 sm:hover:border-slate-400 sm:hover:bg-slate-100"
                        }`}
                      >
                        {filter.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              {hamsters.length} 件中 {filteredHamsters.length} 件が条件に一致しています。
            </p>

            {filteredHamsters.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                {statusFilter === "selected"
                  ? "選択中のハムスターはいません。"
                  : "条件に一致するハムスターはいません。"}
              </div>
            ) : (
              <div className="max-h-[50vh] divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200 sm:max-h-96 lg:max-h-[28rem]">
                {filteredHamsters.map((hamster) => {
                  const checked = selectedIdSet.has(hamster.id);
                  // 上限に達した後は未選択の行だけを無効化し、選択済みの解除はできるようにする。
                  const disabled = !checked && needsSelection && effectiveSelectedIds.length >= limit;

                  return (
                    <label
                      key={hamster.id}
                      className={`flex items-start gap-3 px-4 py-3 text-sm ${
                        disabled ? "cursor-not-allowed bg-slate-50 text-slate-400" : "cursor-pointer text-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!needsSelection || disabled}
                        onChange={() => handleToggle(hamster.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                          {hamster.name}
                          {hamster.isActive ? null : (
                            <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                              管理外
                            </span>
                          )}
                        </span>
                        {hamster.memo ? <span className="mt-1 block truncate text-slate-500">{hamster.memo}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <div id="dashboard-settings-save" className="flex justify-end scroll-mt-24">
        <DirtySubmitButton
          disabled={!canSave}
          className="inline-flex items-center gap-2 rounded-md bg-moss px-5 py-2.5 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Save className="h-4 w-4" aria-hidden />
          保存
        </DirtySubmitButton>
      </div>
      </div>
      </form>
    </UnsavedChangesGuard>
  );
}
