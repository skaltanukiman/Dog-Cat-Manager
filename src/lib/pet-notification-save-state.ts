import type { PetNotificationRuleInput } from "@/lib/pet-notification-settings";

export type PetNotificationSaveStatus =
  | "petNotificationSaved"
  | "unchanged"
  | "invalid"
  | "forbidden"
  | "petNotificationSpeciesMismatch"
  | "petNotificationScheduleInvalid"
  | "petNotificationDuplicate"
  | "petNotificationLimitExceeded"
  | "systemError";

export type PetNotificationSaveState = {
  submissionId: number;
  status: PetNotificationSaveStatus | null;
  errorId?: string;
  savedRules?: PetNotificationRuleInput[];
};

export const INITIAL_PET_NOTIFICATION_SAVE_STATE: PetNotificationSaveState = {
  submissionId: 0,
  status: null
};

export function createPetNotificationSaveState(
  previous: PetNotificationSaveState,
  status: PetNotificationSaveStatus,
  options: Pick<PetNotificationSaveState, "errorId" | "savedRules"> = {}
) {
  return { submissionId: previous.submissionId + 1, status, ...options };
}

export function isCommittedPetNotificationSave(state: PetNotificationSaveState) {
  return state.status === "petNotificationSaved" || state.status === "unchanged";
}
