import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { Prisma } from "@prisma/client";

import { toDateInputValue } from "../src/lib/date";
import {
  DEVICE_CARE_ACTOR_NAME,
  DeviceCareError,
  deviceCareRequestSchema,
  getDeviceCareConfiguration,
  isValidDeviceCareAuthorization,
  markDeviceCare
} from "../src/lib/device-care";
import type { TransactionExecutor } from "../src/lib/realtime";
import { POST as postDeviceCare } from "../src/app/api/device/care/route";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const configuration = {
  token: "a".repeat(32),
  householdId: "household-1"
};

type FakeCareRow = {
  id: string;
  hamsterId: string;
  recordDate: Date;
  occurredAt: Date;
  createdByUserId: string | null;
};

type FakeActivity = {
  actorUserId?: string | null;
  actorNameSnapshot?: string;
  eventType?: string;
  targetId?: string | null;
};

function createFakeDatabase({
  householdExists = true,
  isDemo = false,
  careDayStartMinutes = 0,
  hamsterHouseholdId = "household-1",
  isActive = true
}: {
  householdExists?: boolean;
  isDemo?: boolean;
  careDayStartMinutes?: number;
  hamsterHouseholdId?: string;
  isActive?: boolean;
} = {}) {
  const feedingRows = new Map<string, FakeCareRow>();
  const waterRows = new Map<string, FakeCareRow>();
  const activities: FakeActivity[] = [];
  let revision = 0;
  let nextId = 1;
  const rowKey = (hamsterId: string, recordDate: Date) =>
    hamsterId + ":" + toDateInputValue(recordDate);

  function createRecordRepository(rows: Map<string, FakeCareRow>, occurredAtField: string) {
    return {
      async createMany({
        data
      }: {
        data: {
          hamsterId: string;
          recordDate: Date;
          createdByUserId: string | null;
          fedAt?: Date;
          replacedAt?: Date;
        };
        skipDuplicates: boolean;
      }) {
        const key = rowKey(data.hamsterId, data.recordDate);
        if (rows.has(key)) return { count: 0 };
        const occurredAt = occurredAtField === "fedAt" ? data.fedAt : data.replacedAt;
        assert.ok(occurredAt);
        rows.set(key, {
          id: "care-" + nextId++,
          hamsterId: data.hamsterId,
          recordDate: data.recordDate,
          occurredAt,
          createdByUserId: data.createdByUserId
        });
        return { count: 1 };
      },
      async findUnique({
        where
      }: {
        where: { hamsterId_recordDate: { hamsterId: string; recordDate: Date } };
      }) {
        const key = rowKey(
          where.hamsterId_recordDate.hamsterId,
          where.hamsterId_recordDate.recordDate
        );
        const row = rows.get(key);
        if (!row) return null;
        return occurredAtField === "fedAt"
          ? {
              id: row.id,
              hamsterId: row.hamsterId,
              recordDate: row.recordDate,
              fedAt: row.occurredAt
            }
          : {
              id: row.id,
              hamsterId: row.hamsterId,
              recordDate: row.recordDate,
              replacedAt: row.occurredAt
            };
      },
      async deleteMany({
        where
      }: {
        where: { hamsterId: string; recordDate: Date };
      }) {
        return { count: rows.delete(rowKey(where.hamsterId, where.recordDate)) ? 1 : 0 };
      }
    };
  }

  const tx = {
    household: {
      async findUnique({ where }: { where: { id: string } }) {
        return householdExists && where.id === configuration.householdId
          ? { careDayStartMinutes, isDemo }
          : null;
      },
      async update({ where }: { where: { id: string } }) {
        assert.equal(where.id, configuration.householdId);
        revision += 1;
        return { realtimeRevision: BigInt(revision) };
      }
    },
    hamster: {
      async findFirst({
        where
      }: {
        where: { id: string; householdId: string };
      }) {
        return where.id === "hamster-1" &&
          where.householdId === configuration.householdId &&
          hamsterHouseholdId === configuration.householdId
          ? { isActive, name: "きなこ" }
          : null;
      }
    },
    feedingRecord: createRecordRepository(feedingRows, "fedAt"),
    waterReplacementRecord: createRecordRepository(waterRows, "replacedAt"),
    householdActivity: {
      async create({ data }: { data: FakeActivity }) {
        activities.push(data);
        return { id: "activity-" + activities.length, ...data };
      }
    }
  } as unknown as Prisma.TransactionClient;

  const execute: TransactionExecutor = async (operation) => operation(tx);

  return {
    activities,
    execute,
    feedingRows,
    waterRows,
    get revision() {
      return revision;
    }
  };
}

test("環境変数は十分な長さのtokenと固定Householdが揃う場合だけ有効になる", () => {
  assert.deepEqual(
    getDeviceCareConfiguration({
      DEVICE_CARE_API_TOKEN: configuration.token,
      DEVICE_CARE_HOUSEHOLD_ID: configuration.householdId
    }),
    configuration
  );
  assert.equal(
    getDeviceCareConfiguration({
      DEVICE_CARE_API_TOKEN: "short",
      DEVICE_CARE_HOUSEHOLD_ID: configuration.householdId
    }),
    null
  );
  assert.equal(
    getDeviceCareConfiguration({
      DEVICE_CARE_API_TOKEN: configuration.token,
      DEVICE_CARE_HOUSEHOLD_ID: ""
    }),
    null
  );
});

test("Bearer tokenを固定長digestで照合し、欠落・形式不正・不一致を拒否する", () => {
  assert.equal(
    isValidDeviceCareAuthorization("Bearer " + configuration.token, configuration.token),
    true
  );
  assert.equal(isValidDeviceCareAuthorization(null, configuration.token), false);
  assert.equal(isValidDeviceCareAuthorization("Basic " + configuration.token, configuration.token), false);
  assert.equal(
    isValidDeviceCareAuthorization("Bearer " + "b".repeat(32), configuration.token),
    false
  );
});

test("入力はfeedingとwaterReplacementだけを許可し、unmarked指定や余分なstateを拒否する", () => {
  assert.equal(
    deviceCareRequestSchema.safeParse({ hamsterId: "hamster-1", careType: "feeding" }).success,
    true
  );
  assert.equal(
    deviceCareRequestSchema.safeParse({
      hamsterId: "hamster-1",
      careType: "feeding",
      state: "unmarked"
    }).success,
    false
  );
  assert.equal(
    deviceCareRequestSchema.safeParse({ hamsterId: "hamster-1", careType: "unmarked" }).success,
    false
  );
});

test("Routeは設定・認証・Content-Type・本文サイズ・JSON形式をDB処理前に検証する", async () => {
  const originalToken = process.env.DEVICE_CARE_API_TOKEN;
  const originalHouseholdId = process.env.DEVICE_CARE_HOUSEHOLD_ID;

  try {
    delete process.env.DEVICE_CARE_API_TOKEN;
    delete process.env.DEVICE_CARE_HOUSEHOLD_ID;
    const unavailable = await postDeviceCare(
      new Request("https://example.test/api/device/care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      })
    );
    assert.equal(unavailable.status, 503);

    process.env.DEVICE_CARE_API_TOKEN = configuration.token;
    process.env.DEVICE_CARE_HOUSEHOLD_ID = configuration.householdId;

    const unauthorized = await postDeviceCare(
      new Request("https://example.test/api/device/care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      })
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const authorization = "Bearer " + configuration.token;
    const unsupportedMediaType = await postDeviceCare(
      new Request("https://example.test/api/device/care", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "text/plain" },
        body: "{}"
      })
    );
    assert.equal(unsupportedMediaType.status, 415);

    const payloadTooLarge = await postDeviceCare(
      new Request("https://example.test/api/device/care", {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "Content-Length": "1025"
        },
        body: "{}"
      })
    );
    assert.equal(payloadTooLarge.status, 413);

    const badRequest = await postDeviceCare(
      new Request("https://example.test/api/device/care", {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          hamsterId: "hamster-1",
          careType: "feeding",
          state: "unmarked"
        })
      })
    );
    assert.equal(badRequest.status, 400);
  } finally {
    if (originalToken === undefined) {
      delete process.env.DEVICE_CARE_API_TOKEN;
    } else {
      process.env.DEVICE_CARE_API_TOKEN = originalToken;
    }
    if (originalHouseholdId === undefined) {
      delete process.env.DEVICE_CARE_HOUSEHOLD_ID;
    } else {
      process.env.DEVICE_CARE_HOUSEHOLD_ID = originalHouseholdId;
    }
  }
});

test("食事をデバイス操作者として冪等に記録し、重複時も既存どおりrevisionだけは進める", async () => {
  const database = createFakeDatabase({ careDayStartMinutes: 480 });
  const now = new Date("2026-08-01T22:59:59.999Z");
  const request = { hamsterId: "hamster-1", careType: "feeding" as const };

  const first = await markDeviceCare(configuration, request, now, database.execute);
  const duplicate = await markDeviceCare(configuration, request, now, database.execute);

  assert.equal(first.result.changed, true);
  assert.equal(duplicate.result.changed, false);
  assert.equal(toDateInputValue(first.result.recordDate), "2026-08-01");
  assert.equal(database.feedingRows.size, 1);
  assert.equal([...database.feedingRows.values()][0]?.createdByUserId, null);
  assert.equal(database.activities.length, 1);
  assert.equal(database.activities[0]?.actorUserId, null);
  assert.equal(database.activities[0]?.actorNameSnapshot, DEVICE_CARE_ACTOR_NAME);
  assert.equal(database.activities[0]?.eventType, "FEEDING_MARKED");
  assert.equal(database.revision, 2);
  assert.equal(first.change.actorUserId, null);
  assert.equal(first.change.actorClientId, null);
});

test("水替えも既存共通処理で実施済みだけを記録する", async () => {
  const database = createFakeDatabase();
  const result = await markDeviceCare(
    configuration,
    { hamsterId: "hamster-1", careType: "waterReplacement" },
    new Date("2026-08-09T01:00:00.000Z"),
    database.execute
  );

  assert.equal(result.result.changed, true);
  assert.equal(database.waterRows.size, 1);
  assert.equal([...database.waterRows.values()][0]?.createdByUserId, null);
  assert.equal(database.activities[0]?.eventType, "WATER_REPLACEMENT_MARKED");
});

test("設定Household不在またはdemoを設定不備として拒否する", async () => {
  for (const database of [
    createFakeDatabase({ householdExists: false }),
    createFakeDatabase({ isDemo: true })
  ]) {
    await assert.rejects(
      markDeviceCare(
        configuration,
        { hamsterId: "hamster-1", careType: "feeding" },
        new Date(),
        database.execute
      ),
      (error: unknown) =>
        error instanceof DeviceCareError && error.code === "configurationUnavailable"
    );
    assert.equal(database.revision, 0);
    assert.equal(database.activities.length, 0);
  }
});

test("対象Household外をnot found、管理外をconflictとして拒否する", async () => {
  const outside = createFakeDatabase({ hamsterHouseholdId: "household-2" });
  await assert.rejects(
    markDeviceCare(
      configuration,
      { hamsterId: "hamster-1", careType: "feeding" },
      new Date(),
      outside.execute
    ),
    (error: unknown) => error instanceof DeviceCareError && error.code === "targetNotFound"
  );

  const inactive = createFakeDatabase({ isActive: false });
  await assert.rejects(
    markDeviceCare(
      configuration,
      { hamsterId: "hamster-1", careType: "feeding" },
      new Date(),
      inactive.execute
    ),
    (error: unknown) => error instanceof DeviceCareError && error.code === "targetInactive"
  );
});

test("Routeは503・404・409・500を分離し、commit後の既存副作用を再利用する", () => {
  const route = source("src/app/api/device/care/route.ts");
  const deviceCare = source("src/lib/device-care.ts");

  assert.match(route, /configurationUnavailable[\s\S]*service_unavailable[\s\S]*503/);
  assert.match(route, /targetNotFound[\s\S]*target_not_found[\s\S]*404/);
  assert.match(route, /target_inactive[\s\S]*409/);
  assert.match(route, /internal_server_error[\s\S]*500/);
  assert.match(route, /publishHouseholdChangeSafely\(change\)/);
  assert.match(route, /revalidatePathsSafely\(/);
  assert.match(deviceCare, /createdByUserId: null/);
  assert.match(deviceCare, /actorUserId: null/);
  assert.match(deviceCare, /actorNameSnapshot: DEVICE_CARE_ACTOR_NAME/);
  assert.doesNotMatch(deviceCare, /state:\s*"unmarked"/);
  assert.doesNotMatch(route, /logUnexpectedError\([\s\S]{0,400}authorization/i);
});

test("環境変数例に実tokenを含めない", () => {
  for (const file of [".env.example", ".env.development.example", ".env.production.example"]) {
    const env = source(file);
    assert.match(env, /DEVICE_CARE_API_TOKEN=\r?\n/);
    assert.match(env, /DEVICE_CARE_HOUSEHOLD_ID=\r?\n/);
  }
});
