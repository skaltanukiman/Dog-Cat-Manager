import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { HouseholdRole } from "@prisma/client";

import {
  updateHouseholdNameMutation,
  type HouseholdNameExecutor
} from "../src/lib/household-name";
import {
  getDuplicateHouseholdNames,
  getHouseholdSwitcherOptionLabel
} from "../src/lib/household-switcher";
import { updateHouseholdNameSchema } from "../src/lib/schemas";

const projectRoot = process.cwd();

function source(filePath: string) {
  return readFileSync(join(projectRoot, filePath), "utf8");
}

function exportedActionSource(filePath: string, actionName: string) {
  const fileSource = source(filePath);
  const start = fileSource.indexOf(`export async function ${actionName}`);
  assert.notEqual(start, -1, `${actionName} が見つかりません。`);
  const next = fileSource.indexOf("\nexport async function ", start + 1);
  return fileSource.slice(start, next === -1 ? fileSource.length : next);
}

function createFakeExecutor(actorRole: HouseholdRole = "OWNER", forcedUpdateCount?: number) {
  const database = {
    households: new Map([
      ["household-1", "abcのハムスター管理"],
      ["household-2", "defのハムスター管理"]
    ]),
    memberships: new Map([
      ["household-1:user-1", actorRole],
      ["household-2:user-1", "OWNER" as HouseholdRole]
    ]),
    locks: [] as string[],
    updateCalls: 0,
    revision: 0
  };

  const execute: HouseholdNameExecutor = async (operation) =>
    operation({
      lockHousehold: async (householdId) => {
        database.locks.push(householdId);
      },
      findMembership: async (householdId, userId) => {
        const role = database.memberships.get(`${householdId}:${userId}`);
        const name = database.households.get(householdId);
        return role && name ? { role, household: { name } } : null;
      },
      updateName: async ({ householdId, actorUserId, currentName, nextName }) => {
        database.updateCalls += 1;
        if (forcedUpdateCount !== undefined) return forcedUpdateCount;
        if (
          database.households.get(householdId) !== currentName ||
          database.memberships.get(`${householdId}:${actorUserId}`) !== "OWNER"
        ) {
          return 0;
        }
        database.households.set(householdId, nextName);
        return 1;
      },
      commitChange: async ({ householdId, actorClientId, actorUserId }) => {
        database.revision += 1;
        return {
          householdId,
          source: "household",
          actorClientId,
          actorUserId,
          revision: String(database.revision)
        };
      }
    });

  return { database, execute };
}

function mutationInput(overrides: Partial<Parameters<typeof updateHouseholdNameMutation>[0]> = {}) {
  return {
    householdId: "household-1",
    actorUserId: "user-1",
    actorClientId: "client-1",
    expectedName: "abcのハムスター管理",
    nextName: "ゴールデンハムスター組",
    ...overrides
  };
}

test("共有グループ名schemaはtrim後1〜50文字だけを受け付ける", () => {
  assert.equal(updateHouseholdNameSchema.parse({ name: "  ゴールデン組  " }).name, "ゴールデン組");
  assert.equal(updateHouseholdNameSchema.safeParse({ name: "\n\t " }).success, false);
  assert.equal(updateHouseholdNameSchema.safeParse({ name: "あ".repeat(50) }).success, true);
  assert.equal(updateHouseholdNameSchema.safeParse({ name: "あ".repeat(51) }).success, false);
});

test("OWNERは現在の共有グループ1件だけを更新してrevisionを確定する", async () => {
  const { database, execute } = createFakeExecutor();
  const result = await updateHouseholdNameMutation(mutationInput(), execute);

  assert.equal(result.status, "updated");
  assert.equal(database.households.get("household-1"), "ゴールデンハムスター組");
  assert.equal(database.households.get("household-2"), "defのハムスター管理");
  assert.deepEqual(database.locks, ["household-1"]);
  assert.equal(database.updateCalls, 1);
  assert.equal(database.revision, 1);
  if (result.status === "updated") {
    assert.equal(result.actorHouseholdRole, "OWNER");
    assert.equal(result.change.source, "household");
    assert.equal(result.change.householdId, "household-1");
  }
});

test("ADMIN・MEMBER・VIEWERと非所属ユーザーは共有グループ名を変更できない", async () => {
  for (const role of ["ADMIN", "MEMBER", "VIEWER"] as const) {
    const { database, execute } = createFakeExecutor(role);
    assert.deepEqual(await updateHouseholdNameMutation(mutationInput(), execute), { status: "forbidden" });
    assert.equal(database.households.get("household-1"), "abcのハムスター管理");
    assert.equal(database.revision, 0);
  }

  const { database, execute } = createFakeExecutor();
  assert.deepEqual(
    await updateHouseholdNameMutation(mutationInput({ actorUserId: "outsider" }), execute),
    { status: "forbidden" }
  );
  assert.equal(database.revision, 0);
});

test("同名更新は変更なし、古い画面情報と条件付き更新競合は状態変更としてrevisionを増やさない", async () => {
  const unchanged = createFakeExecutor();
  assert.deepEqual(
    await updateHouseholdNameMutation(
      mutationInput({ nextName: "abcのハムスター管理" }),
      unchanged.execute
    ),
    { status: "unchanged" }
  );
  assert.equal(unchanged.database.updateCalls, 0);
  assert.equal(unchanged.database.revision, 0);

  const stale = createFakeExecutor();
  assert.deepEqual(
    await updateHouseholdNameMutation(mutationInput({ expectedName: "古い名前" }), stale.execute),
    { status: "stateChanged" }
  );
  assert.equal(stale.database.updateCalls, 0);
  assert.equal(stale.database.revision, 0);

  const conflict = createFakeExecutor("OWNER", 0);
  assert.deepEqual(await updateHouseholdNameMutation(mutationInput(), conflict.execute), {
    status: "stateChanged"
  });
  assert.equal(conflict.database.revision, 0);
});

test("プロフィール変更はUser.nameだけを更新し、全所属Householdへのprofile revision通知を維持する", () => {
  const action = exportedActionSource("src/app/actions/settings.ts", "saveSettings");
  assert.match(action, /tx\.user\.update\(\{ where: \{ id: context\.user\.id \}, data: \{ name: profileResult\.data\.name \} \}\)/);
  assert.doesNotMatch(action, /tx\.household\.updateMany|DEFAULT_HOUSEHOLD_NAME_SUFFIX|defaultHouseholdName/);
  assert.match(action, /tx\.householdMember\.findMany\([\s\S]*where: \{ userId: context\.user\.id \}/);
  assert.match(action, /profileChanged \? "profile" : "settings"/);
  assert.match(action, /publishHouseholdChangesSafely\(changes\)/);
});

test("初回HouseholdだけdefaultHouseholdNameで自動命名し、プロフィール保存では再利用しない", () => {
  const authContext = source("src/lib/auth-context.ts");
  const settingsAction = source("src/app/actions/settings.ts");
  assert.match(authContext, /export function defaultHouseholdName/);
  assert.match(authContext, /return `\$\{ownerName\}\$\{DEFAULT_HOUSEHOLD_NAME_SUFFIX\}`/);
  assert.match(authContext, /const household = await tx\.household\.create\([\s\S]*name: defaultHouseholdName\(user\)/);
  assert.doesNotMatch(settingsAction, /defaultHouseholdName|DEFAULT_HOUSEHOLD_NAME_SUFFIX/);
});

test("所有権移譲処理は共有グループ名を更新しない", () => {
  const leaveSource = source("src/lib/household-leave.ts");
  assert.match(leaveSource, /promoteToOwner/);
  assert.doesNotMatch(leaveSource, /household\.update|updateName|data:\s*\{\s*name/);
});

test("共有グループ名ActionはFormDataのhouseholdIdを信用せず、再認可・安全な通知・監査を行う", () => {
  const action = exportedActionSource("src/app/actions/members.ts", "updateCurrentHouseholdName");
  const mutation = source("src/lib/household-name.ts");
  assert.match(action, /getRequiredHouseholdContext\(\)/);
  assert.match(action, /canUpdateHouseholdName\(context\.membership\.role\)/);
  assert.match(action, /householdId: context\.household\.id/);
  assert.doesNotMatch(action, /formData\.get\("householdId"\)/);
  assert.match(action, /publishHouseholdChangeSafely\(result\.change\)/);
  assert.match(action, /HOUSEHOLD_AUDIT_EVENTS\.householdNameUpdated/);
  assert.match(action, /actorHouseholdRole: result\.actorHouseholdRole/);
  assert.match(action, /result: "success"/);
  assert.match(mutation, /pg_advisory_xact_lock\(hashtextextended\(\$\{householdId\}, 0\)\)/);
  assert.match(mutation, /role: "OWNER"/);
  assert.match(mutation, /name: currentName/);
});

test("同名がある切り替え候補だけ件数を補足し、選択値はhouseholdIdを維持する", () => {
  const households = [
    { id: "household-1", name: "ハムスター管理", role: "OWNER" as const, hamsterCount: 2, memberCount: 1 },
    { id: "household-2", name: "ハムスター管理", role: "MEMBER" as const, hamsterCount: 1, memberCount: 3 },
    { id: "household-3", name: "ゴールデン組", role: "OWNER" as const, hamsterCount: 1, memberCount: 1 }
  ];
  const duplicateNames = getDuplicateHouseholdNames(households);

  assert.deepEqual([...duplicateNames], ["ハムスター管理"]);
  assert.equal(
    getHouseholdSwitcherOptionLabel(households[0], duplicateNames.has(households[0].name)),
    "ハムスター管理（オーナー・ハムスター2匹・メンバー1人）"
  );
  assert.equal(
    getHouseholdSwitcherOptionLabel(households[1], duplicateNames.has(households[1].name)),
    "ハムスター管理（メンバー・ハムスター1匹・メンバー3人）"
  );
  assert.equal(
    getHouseholdSwitcherOptionLabel(households[2], duplicateNames.has(households[2].name)),
    "ゴールデン組（オーナー）"
  );

  const switcher = source("src/components/household-switcher.tsx");
  assert.match(switcher, /<option key=\{household\.id\} value=\{household\.id\}>/);
});

test("共有画面はOWNER向け編集フォームとOWNER以外向け理由付き読み取り専用表示を持つ", () => {
  const page = source("src/app/(app)/settings/members/page.tsx");
  assert.match(page, /共有グループ設定/);
  assert.match(page, /canUpdateHouseholdName\(context\.membership\.role\)/);
  assert.match(page, /action=\{updateCurrentHouseholdName\}/);
  assert.match(page, /name="name"[\s\S]*maxLength=\{50\}/);
  assert.match(page, /aria-describedby="household-name-help"/);
  assert.match(page, /50文字以内で入力してください。/);
  assert.match(page, /共有グループ名を保存/);
  assert.match(page, /readOnly/);
  assert.match(page, /共有グループ名を変更できるのはオーナーだけです。/);
  assert.match(page, /w-full[\s\S]*sm:w-auto/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);

  const statusMessage = source("src/components/status-message.tsx");
  assert.match(statusMessage, /共有グループ名を更新しました。/);
  assert.match(statusMessage, /共有グループ名に変更はありません。/);
  assert.match(statusMessage, /共有グループ名は50文字以内で入力してください。/);
  assert.match(statusMessage, /共有グループの状態が変更されています。最新の状態を確認して、もう一度操作してください。/);
});

test("Household.nameにグローバル一意制約やmigrationを追加しない", () => {
  const prismaSchema = source("prisma/schema.prisma");
  const householdModel = prismaSchema.match(/model Household \{[\s\S]*?\n\}/)?.[0] ?? "";
  const nameLine = householdModel.match(/^\s*name\s+String.*$/m)?.[0] ?? "";
  assert.match(nameLine, /name\s+String/);
  assert.doesNotMatch(nameLine, /@unique/);
  assert.doesNotMatch(householdModel, /@@unique\(\[name\]\)/);
});
