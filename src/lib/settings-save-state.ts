export type SettingsSaveStatus =
  | "saved"
  | "careDaySaved"
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
  savedCareDayStartMinutes?: number;
  savedDashboardSettings?: {
    dashboardBoardCount: number;
    petIds: string[];
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
    | "errorId"
    | "savedName"
    | "savedCareDayStartMinutes"
    | "savedDashboardSettings"
  > = {}
): SettingsSaveState {
  return {
    submissionId: previousState.submissionId + 1,
    status,
    ...options
  };
}

export function isCommittedSettingsSave(state: SettingsSaveState) {
  return (
    state.status === "saved" ||
    state.status === "careDaySaved" ||
    state.status === "unchanged"
  );
}
