import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deletePetImageAfterPetDeletionSafely } from "../src/lib/pet-delete-image";
import {
  deletePetWithoutHistory,
  PET_DELETE_HISTORY_RELATIONS,
  type PetDeleteHistoryCounts
} from "../src/lib/pet-delete";
import { deletePetSchema } from "../src/lib/schemas";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const emptyHistory = (): PetDeleteHistoryCounts => ({
  weightRecords: 0,
  feedingRecords: 0,
  waterRecords: 0,
  walkRecords: 0,
  litterRecords: 0,
  records: 0,
  memoryRecords: 0
});

function createRepository(options: {
  isActive?: boolean;
  history?: Partial<PetDeleteHistoryCounts>;
  found?: boolean;
  deletedCount?: number;
  events?: string[];
} = {}) {
  const events = options.events ?? [];
  return {
    lockPet: async (householdId: string, petId: string) => {
      events.push(`lock:${householdId}:${petId}`);
      return options.found === false
        ? null
        : {
            id: petId,
            name: "こむぎ",
            isActive: options.isActive ?? false,
            profileImageFileName: "profile.webp"
          };
    },
    countHistory: async () => {
      events.push("countHistory");
      return { ...emptyHistory(), ...options.history };
    },
    deletePet: async (householdId: string, petId: string) => {
      events.push(`delete:${householdId}:${petId}`);
      return options.deletedCount ?? 1;
    }
  };
}

test("履歴なし・管理終了済みPetはロック、履歴再確認、条件付き削除の順で完全削除する", async () => {
  const events: string[] = [];
  const result = await deletePetWithoutHistory(
    { householdId: "household-1", petId: "pet-1" },
    createRepository({ events })
  );

  assert.deepEqual(result, {
    status: "deleted",
    petId: "pet-1",
    petName: "こむぎ",
    profileImageFileName: "profile.webp"
  });
  assert.deepEqual(events, ["lock:household-1:pet-1", "countHistory", "delete:household-1:pet-1"]);
});

test("管理中Petは履歴確認や削除へ進めない", async () => {
  const events: string[] = [];
  const result = await deletePetWithoutHistory(
    { householdId: "household-1", petId: "pet-1" },
    createRepository({ isActive: true, events })
  );

  assert.deepEqual(result, { status: "active" });
  assert.deepEqual(events, ["lock:household-1:pet-1"]);
});

for (const relation of PET_DELETE_HISTORY_RELATIONS) {
  test(`${relation}が1件でもあるPetは完全削除しない`, async () => {
    const events: string[] = [];
    const result = await deletePetWithoutHistory(
      { householdId: "household-1", petId: "pet-1" },
      createRepository({ history: { [relation]: 1 }, events })
    );

    assert.deepEqual(result, { status: "hasHistory" });
    assert.deepEqual(events, ["lock:household-1:pet-1", "countHistory"]);
  });
}

for (const recordType of ["健康", "通院", "投薬", "ワクチン", "思い出"] as const) {
  test(`${recordType}を含むPetRecordは共通のrecords判定で完全削除を拒否する`, async () => {
    const result = await deletePetWithoutHistory(
      { householdId: "household-1", petId: "pet-1" },
      createRepository({ history: { records: 1 } })
    );
    assert.deepEqual(result, { status: "hasHistory" });
  });
}

test("別Householdまたは存在しないPetはロック対象にならず安全に拒否する", async () => {
  const events: string[] = [];
  const result = await deletePetWithoutHistory(
    { householdId: "household-1", petId: "pet-other" },
    createRepository({ found: false, events })
  );
  assert.deepEqual(result, { status: "notFound" });
  assert.deepEqual(events, ["lock:household-1:pet-other"]);
});

test("不正なPet IDを入力schemaで拒否する", () => {
  assert.equal(deletePetSchema.safeParse({ id: "pet-1" }).success, true);
  assert.equal(deletePetSchema.safeParse({ id: "" }).success, false);
  assert.equal(deletePetSchema.safeParse({}).success, false);
});

test("Pet画像はDB削除後の後処理で削除し、画像削除失敗はwarningだけで完了する", async () => {
  const deleted: string[] = [];
  await deletePetImageAfterPetDeletionSafely("household-1", "pet-1", "profile.webp", {
    deleteImage: async (householdId, fileName) => { deleted.push(`${householdId}:${fileName}`); }
  });
  assert.deepEqual(deleted, ["household-1:profile.webp"]);

  const warnings: Array<{ householdId: string; petId: string; errorName: string }> = [];
  await assert.doesNotReject(
    deletePetImageAfterPetDeletionSafely("household-1", "pet-1", "profile.webp", {
      deleteImage: async () => { throw new Error("filesystem unavailable"); },
      warn: (context) => warnings.push(context)
    })
  );
  assert.deepEqual(warnings, [{ householdId: "household-1", petId: "pet-1", errorName: "Error" }]);
});

test("現行Prisma schemaのPet子relationは履歴7系統と設定・派生2系統だけである", async () => {
  const schema = await source("prisma/schema.prisma");
  const petModel = schema.slice(schema.indexOf("model Pet {"), schema.indexOf("model Breed {"));
  const relationFields = [...petModel.matchAll(/^\s+(\w+)\s+\w+\[\]/gm)].map((match) => match[1]).sort();
  assert.deepEqual(
    relationFields,
    [...PET_DELETE_HISTORY_RELATIONS, "dashboardEntries", "notificationRules"].sort()
  );

  for (const model of [
    "PetWeightRecord", "PetFeedingRecord", "PetWaterRecord", "PetWalkRecord", "PetLitterRecord",
    "PetRecord", "PetMemoryRecordPet", "DashboardPet", "PetNotificationRule"
  ]) {
    const start = schema.indexOf(`model ${model} {`);
    const end = schema.indexOf("\nmodel ", start + 1);
    assert.match(schema.slice(start, end === -1 ? undefined : end), /pet\s+Pet\s+@relation\([^\n]+onDelete: Cascade\)/);
  }
});

test("本番RepositoryはHousehold境界付きPet行ロック後に全履歴を数え、inactive条件付きで削除する", async () => {
  const implementation = await source("src/lib/pet-delete.ts");
  const lockPosition = implementation.indexOf("FOR UPDATE");
  const countPosition = implementation.indexOf("countHistory", lockPosition);
  const deletePosition = implementation.indexOf("deletePet:", countPosition);
  assert.ok(lockPosition >= 0 && countPosition > lockPosition && deletePosition > countPosition);
  assert.match(implementation, /"id" = \$\{petId\} AND "household_id" = \$\{householdId\}/);
  for (const delegate of [
    "petWeightRecord", "petFeedingRecord", "petWaterRecord", "petWalkRecord", "petLitterRecord",
    "petRecord", "petMemoryRecordPet"
  ]) {
    assert.match(implementation, new RegExp(`tx\\.${delegate}\\.count`));
  }
  assert.match(implementation, /where: \{ id: petId, householdId, isActive: false \}/);
});

test("Server Actionは認証・最新権限・Household境界を再確認し、commit後だけ通知・画像削除する", async () => {
  const actions = await source("src/app/actions/pets.ts");
  const start = actions.indexOf("export async function deletePet");
  const action = actions.slice(start);
  assert.match(action, /getRequiredHouseholdMutationContext\("\/pets"\)/);
  assert.match(action, /assertCurrentPetMutationPermission\(tx, context\.household\.id, context\.user\.id\)/);
  assert.match(action, /householdId: context\.household\.id, petId: parsed\.data\.id/);
  assert.match(action, /status === "active"/);
  assert.match(action, /status === "hasHistory"/);
  const commitPosition = action.indexOf("await commitHouseholdMutation");
  const publishPosition = action.indexOf("publishHouseholdChangeSafely", commitPosition);
  const imagePosition = action.indexOf("deletePetImageAfterPetDeletionSafely", commitPosition);
  assert.ok(commitPosition >= 0 && publishPosition > commitPosition && imagePosition > publishPosition);
});

test("Pets UIは管理終了済み・編集可能なPetだけに控えめな削除導線と確認Dialogを出す", async () => {
  const [page, control, statusMessage] = await Promise.all([
    source("src/app/(app)/pets/page.tsx"),
    source("src/components/pet-delete-control.tsx"),
    source("src/components/status-message.tsx")
  ]);
  assert.match(page, /canEdit && !pet\.isActive \? <PetDeleteControl/);
  assert.match(control, /その他の操作（完全削除）/);
  assert.match(control, /\{petName\}を完全に削除しますか？/);
  assert.match(control, /この操作は取り消せません。/);
  assert.match(control, /過去の記録があるペットは完全削除できません。/);
  assert.match(control, /role="dialog"/);
  assert.match(control, /aria-modal="true"/);
  assert.match(control, /aria-labelledby=\{titleId\}/);
  assert.match(control, /aria-describedby=\{descriptionId\}/);
  assert.match(control, /キャンセル/);
  assert.match(control, /action=\{deletePet\}/);
  assert.match(control, /event\.key === "Escape"/);
  assert.match(statusMessage, /petDeleted: "ペットを完全に削除しました。"/);
  assert.match(statusMessage, /petDeleteHasHistory: "このペットには記録があるため完全削除できません。管理終了のままご利用ください。"/);
});
