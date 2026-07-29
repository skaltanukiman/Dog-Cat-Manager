// 認証導入前の固定設定ID。既存データ移行スクリプトで旧設定を読み取るために残す。
export const LEGACY_APP_SETTING_ID = "default";
export const DEFAULT_DASHBOARD_BOARD_COUNT = 6;
export const MIN_DASHBOARD_BOARD_COUNT = 1;
export const MAX_DASHBOARD_BOARD_COUNT = 30;
export const HAMSTER_SELECTOR_MODES = ["combobox", "select"] as const;
export const DEFAULT_HAMSTER_SELECTOR_MODE: HamsterSelectorMode = "select";

export type HamsterSelectorMode = (typeof HAMSTER_SELECTOR_MODES)[number];
export type DashboardDropPosition = "before" | "after";

export function normalizeDashboardBoardCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DASHBOARD_BOARD_COUNT;
  }

  // DBに範囲外の値が残っていても、画面側では許可範囲内の表示数に丸める。
  return Math.min(MAX_DASHBOARD_BOARD_COUNT, Math.max(MIN_DASHBOARD_BOARD_COUNT, Math.trunc(value)));
}

export function normalizeHamsterSelectorMode(value: string | null | undefined): HamsterSelectorMode {
  return value === "combobox" || value === "select" ? value : DEFAULT_HAMSTER_SELECTOR_MODE;
}

function uniqueValidDashboardHamsterIds(hamsterIds: readonly string[], selectedIds: readonly string[]) {
  const validIdSet = new Set(hamsterIds);
  const selectedIdSet = new Set<string>();

  for (const id of selectedIds) {
    if (validIdSet.has(id)) {
      selectedIdSet.add(id);
    }
  }

  return [...selectedIdSet];
}

// 保存済み順序を優先し、削除済みIDを除外して未設定のハムスターを登録順で末尾へ補う。
export function normalizeDashboardHamsterIds(
  hamsterIds: readonly string[],
  boardCount: number,
  selectedIds: readonly string[]
) {
  const selectedHamsterIds = uniqueValidDashboardHamsterIds(hamsterIds, selectedIds);
  const selectedIdSet = new Set(selectedHamsterIds);
  const fallbackHamsterIds = hamsterIds.filter((id) => !selectedIdSet.has(id));
  const targetCount = Math.min(Math.max(Math.trunc(boardCount), 0), hamsterIds.length);

  return [...selectedHamsterIds, ...fallbackHamsterIds].slice(0, targetCount);
}

export function resizeDashboardHamsterIds(
  hamsterIds: readonly string[],
  selectedIds: readonly string[],
  boardCount: number
) {
  const selectedHamsterIds = uniqueValidDashboardHamsterIds(hamsterIds, selectedIds);
  const targetCount = Math.min(Math.max(Math.trunc(boardCount), 0), hamsterIds.length);

  if (hamsterIds.length <= boardCount || selectedHamsterIds.length === 0) {
    return normalizeDashboardHamsterIds(hamsterIds, boardCount, selectedHamsterIds);
  }

  return selectedHamsterIds.slice(0, targetCount);
}

export function toggleDashboardHamsterId(
  selectedIds: readonly string[],
  hamsterId: string,
  limit: number
) {
  if (selectedIds.includes(hamsterId)) {
    return selectedIds.filter((id) => id !== hamsterId);
  }

  return selectedIds.length < limit ? [...selectedIds, hamsterId] : [...selectedIds];
}

export function moveDashboardHamsterId(
  selectedIds: readonly string[],
  hamsterId: string,
  targetHamsterId: string,
  position: DashboardDropPosition
) {
  const currentIndex = selectedIds.indexOf(hamsterId);
  const originalTargetIndex = selectedIds.indexOf(targetHamsterId);

  if (currentIndex < 0 || originalTargetIndex < 0 || currentIndex === originalTargetIndex) {
    return [...selectedIds];
  }

  const nextIds = [...selectedIds];
  nextIds.splice(currentIndex, 1);
  const targetIndex = nextIds.indexOf(targetHamsterId);
  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  nextIds.splice(insertIndex, 0, hamsterId);
  return nextIds;
}

export function getDashboardDropPosition(
  clientY: number,
  targetRect: { top: number; height: number }
): DashboardDropPosition {
  return clientY < targetRect.top + targetRect.height / 2 ? "before" : "after";
}

export type DashboardHamsterSelectionError = "duplicate" | "unknown" | "tooMany" | "tooFew";

export function getDashboardHamsterSelectionError(
  validHamsterIds: readonly string[],
  boardCount: number,
  selectedIds: readonly string[]
): DashboardHamsterSelectionError | null {
  if (new Set(selectedIds).size !== selectedIds.length) {
    return "duplicate";
  }

  const validIdSet = new Set(validHamsterIds);
  if (selectedIds.some((id) => !validIdSet.has(id))) {
    return "unknown";
  }

  const requiredSelectionCount = Math.min(boardCount, validHamsterIds.length);
  if (selectedIds.length > requiredSelectionCount) {
    return "tooMany";
  }
  if (selectedIds.length < requiredSelectionCount) {
    return "tooFew";
  }

  return null;
}

export function pickDashboardHamsters<T extends { id: string }>(
  hamsters: T[],
  boardCount: number,
  selectedIds: string[]
) {
  const hamsterById = new Map(hamsters.map((hamster) => [hamster.id, hamster]));
  return normalizeDashboardHamsterIds(
    hamsters.map((hamster) => hamster.id),
    boardCount,
    selectedIds
  ).map((id) => hamsterById.get(id) as T);
}
