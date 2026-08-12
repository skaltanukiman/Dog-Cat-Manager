import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  appRoleUpdateDenial,
  belongsToCurrentHousehold,
  canEditHouseholdSharedData,
  canManageHouseholdInvitations,
  canManageHouseholdMemberRoles,
  canRemoveHouseholdMembers,
  canUpdateHouseholdName,
  canViewHouseholdSharedData,
  getHouseholdLeaveRequirement,
  hasAuthenticatedUserId,
  memberRemovalDenial,
  memberRoleUpdateDenial,
  ownershipTransferTargetDenial
} from "../src/lib/authorization";

const projectRoot = process.cwd();

function exportedActionSource(filePath: string, actionName: string) {
  const source = readFileSync(join(projectRoot, filePath), "utf8");
  const start = source.indexOf(`export async function ${actionName}`);
  assert.notEqual(start, -1, `${actionName} が見つかりません。`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("Server Actionは認証済みユーザーIDを必須とする", () => {
  assert.equal(hasAuthenticatedUserId(null), false);
  assert.equal(hasAuthenticatedUserId({}), false);
  assert.equal(hasAuthenticatedUserId({ id: "" }), false);
  assert.equal(hasAuthenticatedUserId({ id: "user-1" }), true);
});

test("デバイスお世話APIだけをAuth.jsの公開例外とし、Route内のBearer認証を必須にする", () => {
  const proxy = readFileSync(join(projectRoot, "src/proxy.ts"), "utf8");
  const route = readFileSync(join(projectRoot, "src/app/api/device/care/route.ts"), "utf8");

  assert.match(proxy, /PUBLIC_PATHS[\s\S]*"\/api\/device\/care"/);
  assert.doesNotMatch(proxy, /PUBLIC_PREFIXES[\s\S]*"\/api\/device"/);
  assert.match(route, /getDeviceCareConfiguration\(\)/);
  assert.match(route, /request\.headers\.get\("authorization"\)/);
  assert.match(route, /isValidDeviceCareAuthorization\(/);
  assert.match(route, /"WWW-Authenticate": "Bearer"/);
});

test("Household外のリソースを操作対象として認めない", () => {
  assert.equal(belongsToCurrentHousehold("household-1", "household-1"), true);
  assert.equal(belongsToCurrentHousehold("household-2", "household-1"), false);
  assert.equal(belongsToCurrentHousehold(null, "household-1"), false);
});

test("招待発行はOWNERとADMINだけに許可する", () => {
  assert.equal(canManageHouseholdInvitations("OWNER"), true);
  assert.equal(canManageHouseholdInvitations("ADMIN"), true);
  assert.equal(canManageHouseholdInvitations("MEMBER"), false);
  assert.equal(canManageHouseholdInvitations("VIEWER"), false);
});

test("VIEWERはHousehold共有データを閲覧できるが編集できない", () => {
  for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
    assert.equal(canViewHouseholdSharedData(role), true);
  }
  assert.equal(canEditHouseholdSharedData("OWNER"), true);
  assert.equal(canEditHouseholdSharedData("ADMIN"), true);
  assert.equal(canEditHouseholdSharedData("MEMBER"), true);
  assert.equal(canEditHouseholdSharedData("VIEWER"), false);
});

test("招待・メンバー解除・権限変更の管理権限をロール別に判定する", () => {
  assert.equal(canRemoveHouseholdMembers("OWNER"), true);
  assert.equal(canRemoveHouseholdMembers("ADMIN"), true);
  assert.equal(canRemoveHouseholdMembers("MEMBER"), false);
  assert.equal(canRemoveHouseholdMembers("VIEWER"), false);
  assert.equal(canManageHouseholdMemberRoles("OWNER"), true);
  assert.equal(canManageHouseholdMemberRoles("ADMIN"), false);
  assert.equal(canManageHouseholdMemberRoles("MEMBER"), false);
  assert.equal(canManageHouseholdMemberRoles("VIEWER"), false);
});

test("共有グループ名を変更できるのはOWNERだけである", () => {
  assert.equal(canUpdateHouseholdName("OWNER"), true);
  assert.equal(canUpdateHouseholdName("ADMIN"), false);
  assert.equal(canUpdateHouseholdName("MEMBER"), false);
  assert.equal(canUpdateHouseholdName("VIEWER"), false);
});

test("メンバー削除は自己削除・権限越え・最後のOWNER削除を拒否する", () => {
  const base = { actorUserId: "actor", targetUserId: "target", ownerCount: 2 } as const;
  assert.equal(memberRemovalDenial({ ...base, actorRole: "MEMBER", targetRole: "MEMBER" }), "forbidden");
  assert.equal(memberRemovalDenial({ ...base, actorRole: "VIEWER", targetRole: "VIEWER" }), "forbidden");
  assert.equal(memberRemovalDenial({ ...base, actorRole: "OWNER", targetUserId: "actor", targetRole: "MEMBER" }), "cannotRemoveSelf");
  assert.equal(memberRemovalDenial({ ...base, actorRole: "ADMIN", targetRole: "ADMIN" }), "forbidden");
  assert.equal(memberRemovalDenial({ ...base, actorRole: "ADMIN", targetRole: "OWNER" }), "forbidden");
  assert.equal(memberRemovalDenial({ ...base, actorRole: "ADMIN", targetRole: "VIEWER" }), null);
  assert.equal(memberRemovalDenial({ ...base, actorRole: "ADMIN", targetRole: "MEMBER" }), null);
  assert.equal(memberRemovalDenial({ ...base, actorRole: "OWNER", targetRole: "OWNER", ownerCount: 1 }), "cannotRemoveLastOwner");
  assert.equal(memberRemovalDenial({ ...base, actorRole: "OWNER", targetRole: "MEMBER" }), null);
  assert.equal(memberRemovalDenial({ ...base, actorRole: "OWNER", targetRole: "VIEWER" }), null);
  assert.equal(memberRemovalDenial({ ...base, actorRole: "OWNER", targetRole: "ADMIN" }), null);
});

test("MEMBER・ADMIN・VIEWERと複数OWNERは移譲なしで自己退出できる", () => {
  for (const role of ["MEMBER", "ADMIN", "VIEWER"] as const) {
    assert.equal(getHouseholdLeaveRequirement({ role, ownerCount: 1, memberCount: 2 }), "leave");
  }
  assert.equal(getHouseholdLeaveRequirement({ role: "OWNER", ownerCount: 2, memberCount: 3 }), "leave");
});

test("唯一のOWNERには移譲を求め、自分しかいないHouseholdは退出不可にする", () => {
  assert.equal(
    getHouseholdLeaveRequirement({ role: "OWNER", ownerCount: 1, memberCount: 2 }),
    "transferOwnership"
  );
  assert.equal(getHouseholdLeaveRequirement({ role: "OWNER", ownerCount: 1, memberCount: 1 }), "soleMember");
});

test("所有権移譲先は同じHouseholdに所属する自分以外のユーザーだけを認める", () => {
  const base = { actorUserId: "actor", householdId: "household-1" } as const;
  assert.equal(
    ownershipTransferTargetDenial({
      ...base,
      targetUserId: "actor",
      targetHouseholdId: "household-1"
    }),
    "invalidTransferTarget"
  );
  assert.equal(
    ownershipTransferTargetDenial({
      ...base,
      targetUserId: "outsider",
      targetHouseholdId: "household-2"
    }),
    "transferTargetUnavailable"
  );
  assert.equal(
    ownershipTransferTargetDenial({
      ...base,
      targetUserId: "member",
      targetHouseholdId: "household-1"
    }),
    null
  );
});

test("Household権限変更はOWNERだけに許可し、自己変更とOWNER変更を拒否する", () => {
  const base = { actorUserId: "actor", targetUserId: "target", currentRole: "MEMBER", newRole: "ADMIN" } as const;
  assert.equal(memberRoleUpdateDenial({ ...base, actorRole: "ADMIN" }), "forbidden");
  assert.equal(memberRoleUpdateDenial({ ...base, actorRole: "OWNER", targetUserId: "actor" }), "cannotChangeOwnHouseholdRole");
  assert.equal(memberRoleUpdateDenial({ ...base, actorRole: "OWNER", currentRole: "OWNER" }), "cannotChangeOwnerRole");
  assert.equal(memberRoleUpdateDenial({ ...base, actorRole: "OWNER" }), null);
  assert.equal(memberRoleUpdateDenial({ ...base, actorRole: "OWNER", currentRole: "VIEWER", newRole: "MEMBER" }), null);
  assert.equal(memberRoleUpdateDenial({ ...base, actorRole: "OWNER", currentRole: "ADMIN", newRole: "VIEWER" }), null);
  assert.equal(memberRoleUpdateDenial({ ...base, actorRole: "OWNER", currentRole: "MEMBER", newRole: "VIEWER" }), null);
});

test("共有データ更新Server Actionは直接呼び出されても共通更新ガードを必須とする", () => {
  const guardedActions = {
    "src/app/actions/hamsters.ts": [
      "createHamster",
      "updateHamster",
      "updateHamsterActiveStatus",
      "deleteHamster",
      "deleteHamsters"
    ],
    "src/app/actions/cleaning.ts": ["saveCleaningMonth"],
    "src/app/actions/feeding.ts": ["setTodayFeeding"],
    "src/app/actions/water-replacement.ts": ["setTodayWaterReplacement"],
    "src/app/actions/weights.ts": [
      "createWeightRecord",
      "updateWeightRecord",
      "deleteWeightRecord",
      "deleteWeightRecords",
      "importGasWeightRecordsCsv",
      "importAppWeightRecordsCsv"
    ],
    "src/app/actions/pet-weights.ts": [
      "createPetWeightRecord",
      "updatePetWeightRecord",
      "deletePetWeightRecord"
    ],
    "src/app/actions/records.ts": [
      "createHealthRecord",
      "createMedicalRecord",
      "createMemoryRecord",
      "updateHealthRecord",
      "updateMedicalRecord",
      "updateMemoryRecord",
      "deleteHamsterRecord"
    ]
  } as const;

  for (const [filePath, actionNames] of Object.entries(guardedActions)) {
    for (const actionName of actionNames) {
      assert.match(
        exportedActionSource(filePath, actionName),
        /getRequiredHouseholdMutationContext\(/,
        `${actionName} はVIEWER拒否の共通更新ガードを呼ぶ必要があります。`
      );
    }
  }
});

test("招待参加時の初期Household権限はMEMBERを維持する", () => {
  const source = exportedActionSource("src/app/actions/members.ts", "acceptHouseholdInvitation");
  assert.match(source, /create:\s*{[\s\S]*?role:\s*"MEMBER"/);
  assert.match(source, /revokedAt:\s*null/);
});

test("招待の作成・無効化ActionはOWNERまたはADMIN権限をサーバー側で確認する", () => {
  for (const actionName of ["createHouseholdInvitation", "revokeHouseholdInvitation"]) {
    const source = exportedActionSource("src/app/actions/members.ts", actionName);
    assert.match(source, /getRequiredHouseholdContext\(/);
    assert.match(source, /canManageHouseholdInvitations\(/);
  }
});

test("アプリ権限変更はSUPER_ADMINだけに許可し、自己降格と最後のSUPER_ADMIN降格を拒否する", () => {
  const base = {
    actorUserId: "actor",
    targetUserId: "target",
    currentRole: "ADMIN",
    newRole: "USER",
    superAdminCount: 2
  } as const;
  assert.equal(appRoleUpdateDenial({ ...base, actorRole: "ADMIN" }), "forbidden");
  assert.equal(appRoleUpdateDenial({ ...base, actorRole: "SUPER_ADMIN" }), null);
  assert.equal(
    appRoleUpdateDenial({
      ...base,
      actorRole: "SUPER_ADMIN",
      targetUserId: "actor",
      currentRole: "SUPER_ADMIN",
      newRole: "ADMIN"
    }),
    "cannotChangeOwnRole"
  );
  assert.equal(
    appRoleUpdateDenial({ ...base, actorRole: "SUPER_ADMIN", currentRole: "SUPER_ADMIN", newRole: "ADMIN", superAdminCount: 1 }),
    "cannotRemoveLastSuperAdmin"
  );
  assert.equal(
    appRoleUpdateDenial({
      ...base,
      actorRole: "SUPER_ADMIN",
      currentRole: "SUPER_ADMIN",
      newRole: "ADMIN",
      superAdminCount: 1,
      targetAccessStatus: "SUSPENDED"
    }),
    null
  );
});
