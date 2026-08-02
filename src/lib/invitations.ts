import { createHash, randomBytes } from "crypto";

export const INVITATION_TTL_DAYS = 7;
export const INVITATION_CREATION_COOLDOWN_MS = 30 * 1000;
export const INVITATION_CREATION_WINDOW_MS = 60 * 60 * 1000;
export const INVITATION_CREATION_WINDOW_LIMIT = 5;
export const INVITATION_CREATION_RATE_SCOPE = "user" as const;
export const MAX_ACTIVE_HOUSEHOLD_INVITATIONS = 10;
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export type InvitationCreationLimitCode = "cooldown" | "hourlyLimit";
export type HouseholdInvitationStatus = "active" | "accepted" | "expired" | "revoked";

type InvitationLifecycle = {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

type InvitationWithHousehold = InvitationLifecycle & {
  household: {
    name: string;
  };
};

export type HouseholdInvitationPreview =
  | { status: "available"; householdName: string }
  | { status: "accepted" | "expired" | "revoked" | "invalid" | "error" };

type InvitationCreator = {
  createdBy: { name: string | null; email: string | null } | null;
};

export function createInvitationToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * 招待tokenをDB検索用の不可逆な値へ変換する。
 *
 * 生tokenは受諾URLの再構成に使えるため、永続化せずこのhashだけを保存する。
 */
export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * ユーザー単位の招待作成頻度を評価する。
 *
 * 直前作成からのcooldownを先に判定し、次に1時間枠の上限を判定する。
 * @returns 制限中は理由と再試行可能時刻、許可する場合は`null`
 */
export function evaluateInvitationCreationLimit({
  now,
  latestCreatedAt,
  createdWithinWindow,
  oldestCreatedWithinWindowAt
}: {
  now: Date;
  latestCreatedAt: Date | null;
  createdWithinWindow: number;
  oldestCreatedWithinWindowAt: Date | null;
}): { code: InvitationCreationLimitCode; retryAt: Date } | null {
  if (
    latestCreatedAt &&
    now.getTime() - latestCreatedAt.getTime() < INVITATION_CREATION_COOLDOWN_MS
  ) {
    return {
      code: "cooldown",
      retryAt: new Date(latestCreatedAt.getTime() + INVITATION_CREATION_COOLDOWN_MS)
    };
  }

  if (createdWithinWindow >= INVITATION_CREATION_WINDOW_LIMIT) {
    return {
      code: "hourlyLimit",
      retryAt: new Date(
        (oldestCreatedWithinWindowAt?.getTime() ?? now.getTime()) + INVITATION_CREATION_WINDOW_MS
      )
    };
  }

  return null;
}

/**
 * 招待の現在状態を、取消・受諾・期限切れの優先順で判定する。
 *
 * 競合で複数の日時が残る不整合時にも、取消を最優先して利用不可として扱う。
 */
export function getHouseholdInvitationStatus(
  invitation: InvitationLifecycle,
  now = new Date()
): HouseholdInvitationStatus {
  if (invitation.revokedAt) return "revoked";
  if (invitation.acceptedAt) return "accepted";
  if (invitation.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function getInvitationCreatorDisplayName(invitation: InvitationCreator) {
  return invitation.createdBy?.name || invitation.createdBy?.email || "不明（既存データ）";
}

export function invitationAcceptanceFailure(
  invitation: InvitationLifecycle,
  now = new Date()
): Exclude<HouseholdInvitationStatus, "active"> | null {
  const status = getHouseholdInvitationStatus(invitation, now);
  return status === "active" ? null : status;
}

export function buildHouseholdInvitationPreview(
  invitation: InvitationWithHousehold | null,
  now = new Date()
): HouseholdInvitationPreview {
  if (!invitation) return { status: "invalid" };

  const failure = invitationAcceptanceFailure(invitation, now);
  if (failure) return { status: failure };

  return {
    status: "available",
    householdName: invitation.household.name
  };
}

export function isValidInvitationToken(token: string) {
  return INVITATION_TOKEN_PATTERN.test(token);
}

/**
 * 招待URLを生成し、生tokenをURL fragmentへ格納する。
 *
 * fragmentはHTTPリクエストや通常のサーバーログへ送信されない。受諾画面側で
 * `getInvitationTokenFromHash`を使って取り出すこと。
 */
export function buildInvitationUrl(origin: string, token: string) {
  const url = new URL("/invitations/accept", origin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

/**
 * 招待URLのfragmentから検証済みtokenを取り出す。
 *
 * tokenがない、または許可したbase64url形式・長さでない場合は`null`を返す。
 */
export function getInvitationTokenFromHash(hash: string) {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && isValidInvitationToken(token) ? token : null;
}
