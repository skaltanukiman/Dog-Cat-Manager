export const UI_FIXTURE_DATABASE_NAME = "dog_cat_manager_dev";
export const UI_FIXTURE_PREFIX = "UI_FIXTURE";
export const UI_FIXTURE_HOUSEHOLD_ID = `${UI_FIXTURE_PREFIX}_MAIN_HOUSEHOLD`;
export const UI_FIXTURE_HOUSEHOLD_NAME = "【UI確認用】Dog & Cat サンプル";

export const UI_FIXTURE_MEMBER_USER_IDS = [
  `${UI_FIXTURE_PREFIX}_MEMBER_OWNER`,
  `${UI_FIXTURE_PREFIX}_MEMBER_ADMIN`,
  `${UI_FIXTURE_PREFIX}_MEMBER_MEMBER`,
  `${UI_FIXTURE_PREFIX}_MEMBER_VIEWER`
] as const;

export const UI_FIXTURE_ADMIN_USER_IDS = Array.from(
  { length: 25 },
  (_, index) => `${UI_FIXTURE_PREFIX}_ADMIN_USER_${String(index + 1).padStart(2, "0")}`
);

export const UI_FIXTURE_ADMIN_HOUSEHOLD_IDS = Array.from(
  { length: 21 },
  (_, index) => `${UI_FIXTURE_PREFIX}_ADMIN_HOUSEHOLD_${String(index + 1).padStart(2, "0")}`
);

export const UI_FIXTURE_CONTACT_PUBLIC_IDS = Array.from(
  { length: 22 },
  (_, index) => `DCM-20260814-F${String(index + 1).padStart(9, "0")}`
);

export const UI_FIXTURE_PET_IMAGE_FILE_NAMES = [
  "00000000-0000-4000-8000-000000000101.webp",
  "00000000-0000-4000-8000-000000000102.webp",
  "00000000-0000-4000-8000-000000000103.webp",
  "00000000-0000-4000-8000-000000000104.webp"
] as const;

export const UI_FIXTURE_MEMORY_IMAGE_FILE_NAMES = [
  "00000000-0000-4000-8000-000000000201.webp",
  "00000000-0000-4000-8000-000000000202.webp",
  "00000000-0000-4000-8000-000000000203.webp",
  "00000000-0000-4000-8000-000000000204.webp"
] as const;

export type TargetUserCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  appRole: "USER" | "ADMIN" | "SUPER_ADMIN";
  accessStatus: "ACTIVE" | "SUSPENDED";
};

/** URLのpathnameから接続先DB名を取り出し、development DB以外を起動前に拒否する。 */
export function assertUiFixtureDatabaseUrl(databaseUrl: string) {
  let databaseName: string;
  try {
    const parsed = new URL(databaseUrl);
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("UI fixtureのDATABASE_URLを解釈できません。");
  }

  if (databaseName !== UI_FIXTURE_DATABASE_NAME) {
    throw new Error(
      `UI fixtureは${UI_FIXTURE_DATABASE_NAME}以外へ接続できません（指定DB: ${databaseName || "不明"}）。`
    );
  }
  return databaseName;
}

/** 自動選択は実Accountを持つ候補が1名のときだけ許可し、曖昧な対象を推測しない。 */
export function selectTargetUser(
  candidates: readonly TargetUserCandidate[],
  explicitUserId?: string
) {
  if (explicitUserId) {
    const selected = candidates.find((candidate) => candidate.id === explicitUserId);
    if (!selected) {
      throw new Error("UI_FIXTURE_TARGET_USER_IDに一致する実利用者Accountがありません。");
    }
    return selected;
  }

  if (candidates.length !== 1) {
    throw new Error(
      `対象ユーザーを一意に特定できません（候補: ${candidates.length}件）。UI_FIXTURE_TARGET_USER_IDを指定してください。`
    );
  }
  return candidates[0];
}

export function isOwnedFixtureHouseholdId(value: string) {
  return value === UI_FIXTURE_HOUSEHOLD_ID || UI_FIXTURE_ADMIN_HOUSEHOLD_IDS.includes(value);
}

export function isOwnedFixtureUserId(value: string) {
  return (
    UI_FIXTURE_MEMBER_USER_IDS.includes(value as (typeof UI_FIXTURE_MEMBER_USER_IDS)[number]) ||
    UI_FIXTURE_ADMIN_USER_IDS.includes(value)
  );
}

export function isOwnedFixtureContactPublicId(value: string) {
  return UI_FIXTURE_CONTACT_PUBLIC_IDS.includes(value);
}

export type SpeciesCareFixture = {
  petId: string;
  species: "DOG" | "CAT";
};

/** UI fixture自体が業務ルール違反のCareを含まないことを投入前に検証する。 */
export function assertSpeciesCareRules(
  walks: readonly SpeciesCareFixture[],
  litters: readonly SpeciesCareFixture[]
) {
  if (walks.some((record) => record.species !== "DOG")) {
    throw new Error("CATにWalk fixtureを作成しようとしています。");
  }
  if (litters.some((record) => record.species !== "CAT")) {
    throw new Error("DOGにLitter fixtureを作成しようとしています。");
  }
}

export function assertUniqueWeightDates(
  records: readonly { petId: string; recordDate: Date | string }[]
) {
  const keys = records.map(
    (record) =>
      `${record.petId}:${typeof record.recordDate === "string" ? record.recordDate.slice(0, 10) : record.recordDate.toISOString().slice(0, 10)}`
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("同一Pet・同一recordDateのWeight fixtureが重複しています。");
  }
}

export function assertCurrentDatabaseName(databaseName: string) {
  if (databaseName !== UI_FIXTURE_DATABASE_NAME) {
    throw new Error(
      `実接続先DBが${UI_FIXTURE_DATABASE_NAME}ではありません（実DB: ${databaseName}）。`
    );
  }
}
