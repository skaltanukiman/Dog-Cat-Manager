import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HouseholdRole } from "@prisma/client";

import {
  deleteSoleOwnerHousehold,
  type HouseholdDeleteExecutor,
  type HouseholdDeleteRepository
} from "../src/lib/household-delete";
import { deleteHouseholdImageDirectoriesSafely } from "../src/lib/household-delete-images";
import { deleteHamsterImageHouseholdDirectory } from "../src/lib/hamster-image";
import { deletePetImageHouseholdDirectory } from "../src/lib/pet-image";
import { deletePetRecordImageHouseholdDirectory } from "../src/lib/pet-record-image";
import { deleteRecordImageHouseholdDirectory } from "../src/lib/record-image";

type StoredMembership = {
  id: string;
  householdId: string;
  userId: string;
  role: HouseholdRole;
};

type FakeDatabase = {
  households: Map<string, { id: string; name: string }>;
  memberships: StoredMembership[];
  userData: Set<string>;
  householdData: Map<string, Set<string>>;
  lockTails: Map<string, Promise<void>>;
  deleteCount: number;
  failDelete: boolean;
};

function member(userId: string, role: HouseholdRole, householdId = "household-1"): StoredMembership {
  return { id: `${householdId}-${userId}`, householdId, userId, role };
}

function createDatabase(members: StoredMembership[]): FakeDatabase {
  return {
    households: new Map([
      ["household-1", { id: "household-1", name: "削除対象" }],
      ["household-2", { id: "household-2", name: "残す共有" }]
    ]),
    memberships: [...members, member("user-1", "MEMBER", "household-2")],
    userData: new Set(["user", "account", "session"]),
    householdData: new Map([
      [
        "household-1",
        new Set([
          "invitation", "appSetting", "dashboardHamster", "hamster", "cleaningRecord",
          "weightRecord", "healthDetail", "medicalDetail", "memoryDetail", "memoryImage", "savedTag"
        ])
      ],
      ["household-2", new Set(["hamster", "weightRecord"])]
    ]),
    lockTails: new Map(),
    deleteCount: 0,
    failDelete: false
  };
}

function createExecutor(database: FakeDatabase): HouseholdDeleteExecutor {
  return async (operation) => {
    let releaseLock: (() => void) | undefined;
    const repository: HouseholdDeleteRepository = {
      lockHousehold: async (householdId) => {
        const previous = database.lockTails.get(householdId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => { release = resolve; });
        database.lockTails.set(householdId, previous.then(() => current));
        await previous;
        releaseLock = release;
      },
      findHousehold: async (householdId) => database.households.get(householdId) ?? null,
      findMembership: async (householdId, userId) =>
        database.memberships.find((item) => item.householdId === householdId && item.userId === userId) ?? null,
      countMembers: async (householdId) =>
        database.memberships.filter((item) => item.householdId === householdId).length,
      countOwners: async (householdId) =>
        database.memberships.filter((item) => item.householdId === householdId && item.role === "OWNER").length,
      deleteHousehold: async (householdId) => {
        if (database.failDelete || !database.households.has(householdId)) return 0;
        database.deleteCount += 1;
        database.households.delete(householdId);
        database.memberships = database.memberships.filter((item) => item.householdId !== householdId);
        database.householdData.delete(householdId);
        return 1;
      }
    };
    try {
      return await operation(repository);
    } finally {
      releaseLock?.();
    }
  };
}

const deleteInput = (confirmationName = "削除対象") => ({
  householdId: "household-1",
  actorUserId: "user-1",
  confirmationName
});

test("OWNERかつ唯一のメンバーだけが削除でき、User・認証情報・別Householdを残す", async () => {
  const database = createDatabase([member("user-1", "OWNER")]);
  const result = await deleteSoleOwnerHousehold(deleteInput(), createExecutor(database));
  assert.deepEqual(result, { status: "deleted", actorHouseholdRole: "OWNER" });
  assert.equal(database.households.has("household-1"), false);
  assert.equal(database.householdData.has("household-1"), false);
  assert.equal(database.households.has("household-2"), true);
  assert.deepEqual(database.householdData.get("household-2"), new Set(["hamster", "weightRecord"]));
  assert.deepEqual(database.userData, new Set(["user", "account", "session"]));
});

test("唯一の非OWNERでは警告し、自動昇格せず削除しない", async () => {
  for (const role of ["ADMIN", "MEMBER", "VIEWER"] as const) {
    const database = createDatabase([member("user-1", role)]);
    const warnings: Array<Record<string, unknown>> = [];
    const result = await deleteSoleOwnerHousehold(deleteInput(), createExecutor(database), (value) => warnings.push(value));
    assert.equal(result.status, "roleStateInvalid");
    assert.equal(database.memberships.find((item) => item.householdId === "household-1")?.role, role);
    assert.equal(database.deleteCount, 0);
    assert.deepEqual(warnings[0], {
      householdId: "household-1", actorUserId: "user-1", currentRole: role, memberCount: 1, ownerCount: 0
    });
  }
});

test("非OWNER・複数メンバー・名称不一致・削除競合を拒否する", async () => {
  const nonOwner = createDatabase([member("user-1", "MEMBER"), member("user-2", "OWNER")]);
  assert.equal((await deleteSoleOwnerHousehold(deleteInput(), createExecutor(nonOwner))).status, "forbidden");
  const shared = createDatabase([member("user-1", "OWNER"), member("user-2", "MEMBER")]);
  assert.equal((await deleteSoleOwnerHousehold(deleteInput(), createExecutor(shared))).status, "stateChanged");
  const wrongName = createDatabase([member("user-1", "OWNER")]);
  assert.equal((await deleteSoleOwnerHousehold(deleteInput("古い名称"), createExecutor(wrongName))).status, "nameMismatch");
  const conflict = createDatabase([member("user-1", "OWNER")]);
  conflict.failDelete = true;
  assert.equal((await deleteSoleOwnerHousehold(deleteInput(), createExecutor(conflict))).status, "stateChanged");
});

test("未所属・存在しないHouseholdを削除しない", async () => {
  const notMember = createDatabase([member("user-2", "OWNER")]);
  assert.equal((await deleteSoleOwnerHousehold(deleteInput(), createExecutor(notMember))).status, "notMember");
  const notFound = createDatabase([member("user-1", "OWNER")]);
  notFound.households.delete("household-1");
  assert.equal((await deleteSoleOwnerHousehold(deleteInput(), createExecutor(notFound))).status, "notFound");
});

test("二重削除をHousehold lockで直列化する", async () => {
  const database = createDatabase([member("user-1", "OWNER")]);
  const execute = createExecutor(database);
  const results = await Promise.all([
    deleteSoleOwnerHousehold(deleteInput(), execute),
    deleteSoleOwnerHousehold(deleteInput(), execute)
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["deleted", "notFound"]);
  assert.equal(database.deleteCount, 1);
});

test("画像ディレクトリは対象Householdだけを削除し、不正IDでルート外を操作できない", async () => {
  const root = await mkdtemp(join(tmpdir(), "hamster-household-delete-"));
  const target = join(root, "household-1");
  const other = join(root, "household-2");
  await mkdir(target);
  await mkdir(other);
  await writeFile(join(target, "image.webp"), "target");
  await writeFile(join(other, "image.webp"), "other");

  await deleteHamsterImageHouseholdDirectory("household-1", root);
  await assert.rejects(readFile(join(target, "image.webp")));
  assert.equal(await readFile(join(other, "image.webp"), "utf8"), "other");
  await assert.rejects(deleteHamsterImageHouseholdDirectory("../household-2", root));
  assert.equal(await readFile(join(other, "image.webp"), "utf8"), "other");
  await deleteRecordImageHouseholdDirectory("household-2", root);
  await assert.rejects(readFile(join(other, "image.webp")));
  await mkdir(other);
  await writeFile(join(other, "image.webp"), "pet");
  await deletePetImageHouseholdDirectory("household-2", root);
  await assert.rejects(readFile(join(other, "image.webp")));
  await mkdir(other);
  await writeFile(join(other, "image.webp"), "pet-record");
  await deletePetRecordImageHouseholdDirectory("household-2", root);
  await assert.rejects(readFile(join(other, "image.webp")));
  await mkdir(other);
  await writeFile(join(other, "image.webp"), "pet-record");
  await assert.rejects(deletePetRecordImageHouseholdDirectory("../household-2", root));
  assert.equal(await readFile(join(other, "image.webp"), "utf8"), "pet-record");
});

test("画像削除失敗はwarning対象にして後処理全体を失敗扱いにしない", async () => {
  const warnings: string[] = [];
  const deleted: string[] = [];
  const result = await deleteHouseholdImageDirectoriesSafely("household-1", {
    deleteHamsterDirectory: async () => { throw new Error("internal path"); },
    deletePetDirectory: async () => { deleted.push("pet"); },
    deleteRecordDirectory: async () => { deleted.push("record"); },
    deletePetRecordDirectory: async () => { deleted.push("petRecord"); },
    warn: (kind) => warnings.push(kind)
  });
  assert.deepEqual(result.failedKinds, ["hamster"]);
  assert.deepEqual(warnings, ["hamster"]);
  assert.deepEqual(deleted.sort(), ["pet", "petRecord", "record"]);
});

test("Household画像cleanupは旧Hamster・Petプロフィール・旧Record・Pet Recordを別rootのまま追加削除する", async () => {
  const cleanup = await readFile(join(process.cwd(), "src/lib/household-delete-images.ts"), "utf8");
  assert.match(cleanup, /deleteHamsterImageHouseholdDirectory/);
  assert.match(cleanup, /deletePetImageHouseholdDirectory/);
  assert.match(cleanup, /deleteRecordImageHouseholdDirectory/);
  assert.match(cleanup, /deletePetRecordImageHouseholdDirectory/);
  assert.match(cleanup, /"hamster" \| "pet" \| "record" \| "petRecord"/);
  assert.equal((cleanup.match(/Directory\(householdId\)/g) ?? []).length, 4);
});

test("本番削除は同一transactionのHousehold lockとCascade起点のhousehold.deleteを使う", async () => {
  const source = await readFile(join(process.cwd(), "src/lib/household-delete.ts"), "utf8");
  const schema = await readFile(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert.match(source, /prisma\.\$transaction/);
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$\{householdId\}, 0\)\)/);
  assert.match(source, /tx\.household\.delete\(\{ where: \{ id: householdId \} \}\)/);
  assert.doesNotMatch(source, /tx\.(hamster|householdMember|appSetting)\.deleteMany/);
  assert.match(schema, /household\s+Household\?\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /household\s+Household\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /hamster\s+Hamster\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /memoryRecord\s+MemoryRecordDetail\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /pet\s+Pet\s+@relation\([^\n]+onDelete: Cascade\)/);
  for (const model of [
    "PetHealthRecordDetail", "PetMedicalVisitDetail", "PetMedicationRecordDetail",
    "PetVaccinationRecordDetail", "PetMemoryRecordDetail", "PetMemoryRecordPet",
    "PetMemoryRecordImage"
  ]) assert.match(schema, new RegExp(`model ${model}`));
});

test("Action・画面は再認可、確認入力、削除後分岐、Cookie、集約、招待受諾lockを備える", async () => {
  const action = await readFile(join(process.cwd(), "src/app/actions/members.ts"), "utf8");
  const page = await readFile(join(process.cwd(), "src/app/(app)/settings/members/delete/page.tsx"), "utf8");
  const form = await readFile(join(process.cwd(), "src/components/household-delete-form.tsx"), "utf8");
  const preview = await readFile(join(process.cwd(), "src/lib/household-delete-preview.ts"), "utf8");
  const authContext = await readFile(join(process.cwd(), "src/lib/auth-context.ts"), "utf8");

  assert.match(action, /context\.household\.id !== householdId/);
  assert.match(action, /hasHouseholdDeleteAcknowledgements\(formData\)/);
  assert.ok(action.lastIndexOf("deleteSoleOwnerHousehold") < action.lastIndexOf("deleteHouseholdImageDirectoriesSafely(householdId)"));
  assert.match(action, /ensureUserHouseholdMembershipWithOutcome\(context\.user\)/);
  assert.match(action, /setCurrentHouseholdCookie\(nextHousehold\.membership\.householdId\)/);
  assert.match(action, /householdDeletedAndCreated/);
  assert.match(action, /householdDeletedAndSwitched/);
  assert.match(action, /pg_advisory_xact_lock\(hashtextextended\(\$\{invitation\.householdId\}, 0\)\)/);
  assert.match(authContext, /existingMembership[\s\S]+created: false/);
  assert.match(authContext, /household\.members\[0\], created: true/);
  assert.match(preview, /\.count\(/);
  assert.match(preview, /\.groupBy\(/);
  assert.match(preview, /profileImageFileName: \{ not: null \}/);

  for (const label of ["ハムスター", "体重記録", "掃除記録", "健康記録", "通院記録", "思い出記録", "画像", "保存済みタグ"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /joinedHouseholdCount > 1/);
  assert.match(page, /新しい共有グループは作成されません/);
  assert.match(page, /新しい空の共有グループが自動的に作成されます/);
  assert.match(form, /confirmationName === householdName/);
  assert.match(form, /disabled={!enabled \|\| pending}/);
  assert.doesNotMatch(form, /window\.confirm/);
});

test("soleMember退出画面はOWNERだけを削除手続きへ案内し、通常退出フォームと分離する", async () => {
  const leavePage = await readFile(join(process.cwd(), "src/app/(app)/settings/members/leave/page.tsx"), "utf8");
  assert.match(leavePage, /soleMemberRoleStateInvalid/);
  assert.match(leavePage, /currentMembership\.role !== "OWNER"/);
  assert.match(leavePage, /href="\/settings\/members\/delete"/);
  assert.match(leavePage, /共有グループの削除手続きへ/);
  assert.match(leavePage, /<HouseholdLeaveForm/);
});
