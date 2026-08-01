import type { AppRole, HouseholdRole, UserAccessStatus } from "@prisma/client";

export type ManageableHouseholdRole = Exclude<HouseholdRole, "OWNER">;

export type HouseholdLeaveRequirement = "leave" | "transferOwnership" | "soleMember";

export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRole, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
  VIEWER: "閲覧者"
};

export function hasAuthenticatedUserId(user: { id?: string | null } | null | undefined): user is { id: string } {
  return typeof user?.id === "string" && user.id.length > 0;
}

export function belongsToCurrentHousehold(resourceHouseholdId: string | null | undefined, currentHouseholdId: string) {
  return typeof resourceHouseholdId === "string" && resourceHouseholdId === currentHouseholdId;
}

export function canViewHouseholdSharedData(role: HouseholdRole) {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER" || role === "VIEWER";
}

export function canEditHouseholdSharedData(role: HouseholdRole) {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}

export function canManageHouseholdInvitations(role: HouseholdRole) {
  return role === "OWNER" || role === "ADMIN";
}

export function canRemoveHouseholdMembers(role: HouseholdRole) {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageHouseholdMemberRoles(role: HouseholdRole) {
  return role === "OWNER";
}

export function canUpdateHouseholdName(role: HouseholdRole) {
  return role === "OWNER";
}

export function canManageCareDaySettings(role: HouseholdRole) {
  return role === "OWNER" || role === "ADMIN";
}

export function memberRemovalDenial({
  actorRole,
  actorUserId,
  targetUserId,
  targetRole,
  ownerCount
}: {
  actorRole: HouseholdRole;
  actorUserId: string;
  targetUserId: string;
  targetRole: HouseholdRole;
  ownerCount: number;
}) {
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") return "forbidden";
  if (actorUserId === targetUserId) return "cannotRemoveSelf";
  if (actorRole === "ADMIN" && targetRole !== "MEMBER" && targetRole !== "VIEWER") return "forbidden";
  if (targetRole === "OWNER" && ownerCount <= 1) return "cannotRemoveLastOwner";
  return null;
}

export function getHouseholdLeaveRequirement({
  role,
  ownerCount,
  memberCount
}: {
  role: HouseholdRole;
  ownerCount: number;
  memberCount: number;
}): HouseholdLeaveRequirement {
  if (memberCount <= 1) return "soleMember";
  if (role === "OWNER" && ownerCount <= 1) return "transferOwnership";
  return "leave";
}

export function ownershipTransferTargetDenial({
  actorUserId,
  targetUserId,
  targetHouseholdId,
  householdId
}: {
  actorUserId: string;
  targetUserId: string | null;
  targetHouseholdId: string | null;
  householdId: string;
}) {
  if (!targetUserId || actorUserId === targetUserId) return "invalidTransferTarget";
  if (targetHouseholdId !== householdId) return "transferTargetUnavailable";
  return null;
}

export function memberRoleUpdateDenial({
  actorRole,
  actorUserId,
  targetUserId,
  currentRole,
  newRole
}: {
  actorRole: HouseholdRole;
  actorUserId: string;
  targetUserId: string;
  currentRole: HouseholdRole;
  newRole: ManageableHouseholdRole;
}) {
  if (actorRole !== "OWNER") return "forbidden";
  if (actorUserId === targetUserId) return "cannotChangeOwnHouseholdRole";
  if (currentRole === "OWNER") return "cannotChangeOwnerRole";
  if (currentRole === newRole) return "unchanged";
  return null;
}

export function appRoleUpdateDenial({
  actorRole,
  actorUserId,
  targetUserId,
  currentRole,
  newRole,
  superAdminCount,
  targetAccessStatus = "ACTIVE"
}: {
  actorRole: AppRole;
  actorUserId: string;
  targetUserId: string;
  currentRole: AppRole;
  newRole: AppRole;
  superAdminCount: number;
  targetAccessStatus?: UserAccessStatus;
}) {
  if (actorRole !== "SUPER_ADMIN") return "forbidden";
  if (actorUserId === targetUserId && currentRole !== newRole) return "cannotChangeOwnRole";
  if (
    targetAccessStatus === "ACTIVE" &&
    currentRole === "SUPER_ADMIN" &&
    newRole !== "SUPER_ADMIN" &&
    superAdminCount <= 1
  ) {
    return "cannotRemoveLastSuperAdmin";
  }
  return null;
}
