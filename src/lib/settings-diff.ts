import type { CleaningMobileDefaultDateFilter } from "@/lib/cleaning-settings";
import type { HamsterSelectorMode } from "@/lib/dashboard-settings";
import type { RecordScope } from "@/lib/records";

export type SettingsSnapshot = {
  name: string;
  dashboardBoardCount: number;
  hamsterSelectorMode: HamsterSelectorMode;
  recordTimelineDefaultScope: RecordScope;
  cleaningMobileDefaultDateFilter: CleaningMobileDefaultDateFilter;
  hamsterIds: readonly string[];
};

function hasSameOrder(currentIds: readonly string[], nextIds: readonly string[]) {
  return currentIds.length === nextIds.length && currentIds.every((id, index) => id === nextIds[index]);
}

export function getSettingsChanges(current: SettingsSnapshot, next: SettingsSnapshot) {
  return {
    profileChanged: current.name !== next.name,
    recordTimelineDefaultScopeChanged:
      current.recordTimelineDefaultScope !== next.recordTimelineDefaultScope,
    cleaningMobileDefaultDateFilterChanged:
      current.cleaningMobileDefaultDateFilter !== next.cleaningMobileDefaultDateFilter,
    dashboardChanged:
      current.dashboardBoardCount !== next.dashboardBoardCount ||
      current.hamsterSelectorMode !== next.hamsterSelectorMode ||
      !hasSameOrder(current.hamsterIds, next.hamsterIds)
  };
}
