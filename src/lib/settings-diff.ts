import type { PetRecordScope } from "@/lib/pet-records";

export type SettingsSnapshot = {
  name: string;
  dashboardBoardCount: number;
  recordTimelineDefaultScope: PetRecordScope;
  petIds: readonly string[];
};

function hasSameOrder(currentIds: readonly string[], nextIds: readonly string[]) {
  return currentIds.length === nextIds.length && currentIds.every((id, index) => id === nextIds[index]);
}

export function getSettingsChanges(current: SettingsSnapshot, next: SettingsSnapshot) {
  return {
    profileChanged: current.name !== next.name,
    recordTimelineDefaultScopeChanged:
      current.recordTimelineDefaultScope !== next.recordTimelineDefaultScope,
    dashboardChanged:
      current.dashboardBoardCount !== next.dashboardBoardCount ||
      !hasSameOrder(current.petIds, next.petIds)
  };
}
