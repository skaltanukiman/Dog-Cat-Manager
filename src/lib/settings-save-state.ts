export type SettingsSaveStatus =
  | "saved"
  | "notificationSaved"
  | "unchanged"
  | "invalid"
  | "profileNameTooLong"
  | "dashboardLimitExceeded"
  | "dashboardSelectionRequired"
  | "forbidden"
  | "systemError";

export type SettingsSaveState = {
  submissionId: number;
  status: SettingsSaveStatus | null;
  errorId?: string;
  savedName?: string;
  savedCareNotificationSettings?: CareNotificationSettings;
  savedDashboardSettings?: {
    dashboardBoardCount: number;
    hamsterSelectorMode: "combobox" | "select";
    recordTimelineDefaultScope: "hamster" | "household";
    cleaningMobileDefaultDateFilter: "today" | "all";
    hamsterIds: string[];
  };
};

export const INITIAL_SETTINGS_SAVE_STATE: SettingsSaveState = {
  submissionId: 0,
  status: null
};

export function createSettingsSaveState(
  previousState: SettingsSaveState,
  status: SettingsSaveStatus,
  options: Pick<
    SettingsSaveState,
    "errorId" | "savedName" | "savedCareNotificationSettings" | "savedDashboardSettings"
  > = {}
): SettingsSaveState {
  return {
    submissionId: previousState.submissionId + 1,
    status,
    ...options
  };
}

export function isCommittedSettingsSave(state: SettingsSaveState) {
  return state.status === "saved" || state.status === "notificationSaved" || state.status === "unchanged";
}
import type { CareNotificationSettings } from "@/lib/care-notifications";
