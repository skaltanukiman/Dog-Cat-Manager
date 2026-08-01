// 認証導入前の固定設定ID。既存データ移行スクリプトで旧設定を読み取るために残す。
export const LEGACY_APP_SETTING_ID = "default";
export const DEFAULT_DASHBOARD_BOARD_COUNT = 6;
export const MIN_DASHBOARD_BOARD_COUNT = 1;
export const MAX_DASHBOARD_BOARD_COUNT = 30;
export const HAMSTER_SELECTOR_MODES = ["combobox", "select"] as const;
export const DEFAULT_HAMSTER_SELECTOR_MODE: HamsterSelectorMode = "select";

export type HamsterSelectorMode = (typeof HAMSTER_SELECTOR_MODES)[number];
export type DashboardDropPosition = "before" | "after";
export type DashboardHamsterRemovalPosition = {
  index: number;
  previousId: string | null;
  nextId: string | null;
};

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
  limit: number,
  restorePosition?: DashboardHamsterRemovalPosition | null
) {
  if (selectedIds.includes(hamsterId)) {
    return selectedIds.filter((id) => id !== hamsterId);
  }

  if (selectedIds.length >= limit) {
    return [...selectedIds];
  }

  if (!restorePosition) {
    return [...selectedIds, hamsterId];
  }

  const previousIndex = restorePosition.previousId
    ? selectedIds.indexOf(restorePosition.previousId)
    : -1;
  if (previousIndex >= 0) {
    const nextIds = [...selectedIds];
    nextIds.splice(previousIndex + 1, 0, hamsterId);
    return nextIds;
  }

  const nextIndex = restorePosition.nextId ? selectedIds.indexOf(restorePosition.nextId) : -1;
  if (nextIndex >= 0) {
    const nextIds = [...selectedIds];
    nextIds.splice(nextIndex, 0, hamsterId);
    return nextIds;
  }

  const insertIndex = Math.min(Math.max(Math.trunc(restorePosition.index), 0), selectedIds.length);
  const nextIds = [...selectedIds];
  nextIds.splice(insertIndex, 0, hamsterId);
  return nextIds;
}

export function getDashboardHamsterRemovalPosition(
  selectedIds: readonly string[],
  hamsterId: string
): DashboardHamsterRemovalPosition | null {
  const index = selectedIds.indexOf(hamsterId);
  if (index < 0) {
    return null;
  }

  return {
    index,
    previousId: selectedIds[index - 1] ?? null,
    nextId: selectedIds[index + 1] ?? null
  };
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
  hamsters: readonly T[],
  boardCount: number,
  selectedIds: readonly string[]
) {
  const hamsterById = new Map(hamsters.map((hamster) => [hamster.id, hamster]));
  return normalizeDashboardHamsterIds(
    hamsters.map((hamster) => hamster.id),
    boardCount,
    selectedIds
  ).map((id) => hamsterById.get(id) as T);
}

function compareRemainingHamsters(
  left: { id: string; isActive: boolean; createdAt: Date },
  right: { id: string; isActive: boolean; createdAt: Date }
) {
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }

  const createdAtDifference = left.createdAt.getTime() - right.createdAt.getTime();
  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function orderHamstersForSelector<
  T extends { id: string; isActive: boolean; createdAt: Date }
>(
  hamsters: readonly T[],
  boardCount: number | null | undefined,
  selectedIds: readonly string[],
  includeInactive: boolean
) {
  const dashboardHamsters = pickDashboardHamsters(
    hamsters,
    normalizeDashboardBoardCount(boardCount),
    selectedIds
  );
  const dashboardHamsterIds = new Set(dashboardHamsters.map((hamster) => hamster.id));
  const isSelectable = (hamster: T) => includeInactive || hamster.isActive;
  const remainingHamsters = hamsters
    .filter((hamster) => isSelectable(hamster) && !dashboardHamsterIds.has(hamster.id))
    .sort(compareRemainingHamsters);

  return [
    ...dashboardHamsters.filter(isSelectable),
    ...remainingHamsters
  ];
}
