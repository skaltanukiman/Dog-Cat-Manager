export const CURRENT_ONBOARDING_VERSION = 1;
export const TUTORIAL_SESSION_STORAGE_KEY = "dog_cat_manager_tutorial_v1";

export type TutorialMode = "initial" | "replay";

export type TutorialPhase =
  | "dashboard-register"
  | "pets-create"
  | "pets-created"
  | "dashboard-care"
  | "care-entry"
  | "replay-overview";

export type TutorialProgress = {
  mode: TutorialMode;
  phase: TutorialPhase;
  createdPetId?: string;
};

const TUTORIAL_MODES = new Set<TutorialMode>(["initial", "replay"]);
const TUTORIAL_PHASES = new Set<TutorialPhase>([
  "dashboard-register",
  "pets-create",
  "pets-created",
  "dashboard-care",
  "care-entry",
  "replay-overview"
]);

export function isOnboardingRequired(completedVersion: number) {
  return completedVersion < CURRENT_ONBOARDING_VERSION;
}

/**
 * 権限のない初回ユーザーには登録操作を要求せず、説明だけのフローを開始する。
 */
export function createInitialTutorialProgress(canCreatePets: boolean): TutorialProgress {
  return {
    mode: "initial",
    phase: canCreatePets ? "dashboard-register" : "replay-overview"
  };
}

export function createReplayTutorialProgress(): TutorialProgress {
  return { mode: "replay", phase: "replay-overview" };
}

/**
 * sessionStorageは利用者が編集できるため、既知のmode・phaseだけを復元する。
 * 永続的な完了判定にはこの値を使用しない。
 */
export function parseTutorialProgress(value: string | null): TutorialProgress | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<TutorialProgress>;
    if (!TUTORIAL_MODES.has(parsed.mode as TutorialMode)) return null;
    if (!TUTORIAL_PHASES.has(parsed.phase as TutorialPhase)) return null;
    if (parsed.createdPetId !== undefined && typeof parsed.createdPetId !== "string") return null;

    return {
      mode: parsed.mode as TutorialMode,
      phase: parsed.phase as TutorialPhase,
      ...(parsed.createdPetId ? { createdPetId: parsed.createdPetId } : {})
    };
  } catch {
    return null;
  }
}

/** Pet作成Actionの成功URLをPet一覧で確認できた場合だけ、登録完了phaseへ進める。 */
export function markTutorialPetCreated(progress: TutorialProgress, petId: string): TutorialProgress {
  if (progress.mode !== "initial" || progress.phase !== "pets-create" || !petId) return progress;
  return { ...progress, phase: "pets-created", createdPetId: petId };
}
