export const DEFAULT_DASHBOARD_BOARD_COUNT = 6;
export const MIN_DASHBOARD_BOARD_COUNT = 1;
export const MAX_DASHBOARD_BOARD_COUNT = 30;

export type DashboardDropPosition = "before" | "after";
export type DashboardPetRemovalPosition = {
  index: number;
  previousId: string | null;
  nextId: string | null;
};
export type DashboardPetSelectionError = "duplicate" | "unknown" | "tooMany" | "tooFew";

export function normalizeDashboardBoardCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DASHBOARD_BOARD_COUNT;
  }

  // DBに範囲外の値が残っていても、画面側では許可範囲内の表示数に丸める。
  return Math.min(MAX_DASHBOARD_BOARD_COUNT, Math.max(MIN_DASHBOARD_BOARD_COUNT, Math.trunc(value)));
}

function uniqueValidDashboardPetIds(petIds: readonly string[], selectedIds: readonly string[]) {
  const validIdSet = new Set(petIds);
  const selectedIdSet = new Set<string>();

  for (const id of selectedIds) {
    if (validIdSet.has(id)) {
      selectedIdSet.add(id);
    }
  }

  return [...selectedIdSet];
}

// 保存済み順序を優先し、削除済みIDを除外して未設定のPetを登録順で末尾へ補う。
export function normalizeDashboardPetIds(
  petIds: readonly string[],
  boardCount: number,
  selectedIds: readonly string[]
) {
  const selectedPetIds = uniqueValidDashboardPetIds(petIds, selectedIds);
  const selectedIdSet = new Set(selectedPetIds);
  const fallbackPetIds = petIds.filter((id) => !selectedIdSet.has(id));
  const targetCount = Math.min(Math.max(Math.trunc(boardCount), 0), petIds.length);

  return [...selectedPetIds, ...fallbackPetIds].slice(0, targetCount);
}

export function resizeDashboardPetIds(
  petIds: readonly string[],
  selectedIds: readonly string[],
  boardCount: number
) {
  const selectedPetIds = uniqueValidDashboardPetIds(petIds, selectedIds);
  const targetCount = Math.min(Math.max(Math.trunc(boardCount), 0), petIds.length);

  if (petIds.length <= boardCount || selectedPetIds.length === 0) {
    return normalizeDashboardPetIds(petIds, boardCount, selectedPetIds);
  }

  return selectedPetIds.slice(0, targetCount);
}

export function toggleDashboardPetId(
  selectedIds: readonly string[],
  petId: string,
  limit: number,
  restorePosition?: DashboardPetRemovalPosition | null
) {
  if (selectedIds.includes(petId)) {
    return selectedIds.filter((id) => id !== petId);
  }

  if (selectedIds.length >= limit) {
    return [...selectedIds];
  }

  if (!restorePosition) {
    return [...selectedIds, petId];
  }

  const previousIndex = restorePosition.previousId
    ? selectedIds.indexOf(restorePosition.previousId)
    : -1;
  if (previousIndex >= 0) {
    const nextIds = [...selectedIds];
    nextIds.splice(previousIndex + 1, 0, petId);
    return nextIds;
  }

  const nextIndex = restorePosition.nextId ? selectedIds.indexOf(restorePosition.nextId) : -1;
  if (nextIndex >= 0) {
    const nextIds = [...selectedIds];
    nextIds.splice(nextIndex, 0, petId);
    return nextIds;
  }

  const insertIndex = Math.min(Math.max(Math.trunc(restorePosition.index), 0), selectedIds.length);
  const nextIds = [...selectedIds];
  nextIds.splice(insertIndex, 0, petId);
  return nextIds;
}

export function getDashboardPetRemovalPosition(
  selectedIds: readonly string[],
  petId: string
): DashboardPetRemovalPosition | null {
  const index = selectedIds.indexOf(petId);
  if (index < 0) {
    return null;
  }

  return {
    index,
    previousId: selectedIds[index - 1] ?? null,
    nextId: selectedIds[index + 1] ?? null
  };
}

export function moveDashboardPetId(
  selectedIds: readonly string[],
  petId: string,
  targetPetId: string,
  position: DashboardDropPosition
) {
  const currentIndex = selectedIds.indexOf(petId);
  const originalTargetIndex = selectedIds.indexOf(targetPetId);

  if (currentIndex < 0 || originalTargetIndex < 0 || currentIndex === originalTargetIndex) {
    return [...selectedIds];
  }

  const nextIds = [...selectedIds];
  nextIds.splice(currentIndex, 1);
  const targetIndex = nextIds.indexOf(targetPetId);
  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  nextIds.splice(insertIndex, 0, petId);
  return nextIds;
}

export function getDashboardDropPosition(
  clientY: number,
  targetRect: { top: number; height: number }
): DashboardDropPosition {
  return clientY < targetRect.top + targetRect.height / 2 ? "before" : "after";
}

export function getDashboardPetSelectionError(
  validPetIds: readonly string[],
  boardCount: number,
  selectedIds: readonly string[]
): DashboardPetSelectionError | null {
  if (new Set(selectedIds).size !== selectedIds.length) {
    return "duplicate";
  }

  const validIdSet = new Set(validPetIds);
  if (selectedIds.some((id) => !validIdSet.has(id))) {
    return "unknown";
  }

  const requiredSelectionCount = Math.min(boardCount, validPetIds.length);
  if (selectedIds.length > requiredSelectionCount) {
    return "tooMany";
  }
  if (selectedIds.length < requiredSelectionCount) {
    return "tooFew";
  }

  return null;
}

export function pickDashboardPets<T extends { id: string }>(
  pets: readonly T[],
  boardCount: number,
  selectedIds: readonly string[]
) {
  const petById = new Map(pets.map((pet) => [pet.id, pet]));
  return normalizeDashboardPetIds(
    pets.map((pet) => pet.id),
    boardCount,
    selectedIds
  ).map((id) => petById.get(id) as T);
}
