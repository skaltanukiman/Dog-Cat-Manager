import assert from "node:assert/strict";
import test from "node:test";

import {
  createRealtimeHealthState,
  getRealtimeRetryDelay,
  REALTIME_BASE_RETRY_MS,
  REALTIME_MAX_RETRY_MS,
  recordRealtimeFailure,
  recordRealtimeSuccess,
  shouldShowRealtimeWarning
} from "../src/lib/realtime-health";
import {
  publishHouseholdChangeSafely,
  subscribeHouseholdChanges,
  type CommittedHouseholdChange
} from "../src/lib/realtime";
import { toCsv } from "../src/lib/csv";
import { parseAppWeightCsvImport } from "../src/lib/weight-csv-app-import";
import { parseWeightCsvImport } from "../src/lib/weight-csv-import";
import { buildWeightCsvRows } from "../src/lib/weight-csv-export";
import {
  getWeightCsvFileSizeError,
  MAX_WEIGHT_CSV_FILE_SIZE_BYTES
} from "../src/lib/weight-rules";

test("CSVの500g超過・未来日・不正値を行単位で拒否する", () => {
  const csv = [
    "date,hamster,weight,unit",
    "2026/07/10,しろ,501,g",
    "2026/07/12,しろ,120,g",
    "2026/07/10,しろ,abc,g",
    "2026/07/10,しろ,120,g"
  ].join("\n");
  const parsed = parseWeightCsvImport(csv, "2026-07-11");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].weightG, 120);
  assert.equal(parsed.errors.length, 3);
  assert.match(parsed.errors[0].message, /500g以下/);
  assert.match(parsed.errors[1].message, /未来日/);
  assert.match(parsed.errors[2].message, /数値/);
});

test("CSVファイルサイズ上限を処理開始前に判定する", () => {
  assert.equal(getWeightCsvFileSizeError(MAX_WEIGHT_CSV_FILE_SIZE_BYTES), null);
  assert.match(getWeightCsvFileSizeError(MAX_WEIGHT_CSV_FILE_SIZE_BYTES + 1) ?? "", /2MB以下/);
});

test("アプリ版エクスポートCSVをそのまま再インポートできる", () => {
  const csv = toCsv(
    buildWeightCsvRows([
      {
        id: "weight-1",
        recordDate: new Date("2026-07-10T00:00:00.000Z"),
        weightG: 120.5,
        createdAt: new Date("2026-07-10T01:00:00.000Z"),
        updatedAt: new Date("2026-07-10T02:00:00.000Z"),
        hamster: { name: "しろ" }
      }
    ])
  );
  const parsed = parseAppWeightCsvImport(csv, "2026-07-11");

  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(
    {
      recordId: parsed.rows[0].recordId,
      date: parsed.rows[0].recordDateInput,
      hamster: parsed.rows[0].hamsterName,
      weightG: parsed.rows[0].weightG
    },
    { recordId: "weight-1", date: "2026-07-10", hamster: "しろ", weightG: 120.5 }
  );
});

test("アプリ版CSVはrecord_idが空の新規行とExcelのスラッシュ日付を受け付ける", () => {
  const csv = [
    "app_id,record_type,schema_version,record_id,date,hamster,weight_g",
    "hamster-manager-browser,weight_record,1,,2026/7/10,しろ,121"
  ].join("\n");
  const parsed = parseAppWeightCsvImport(csv, "2026-07-11");

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].recordId, "");
  assert.equal(parsed.rows[0].recordDateInput, "2026-07-10");
});

test("アプリ版CSVは出力元識別と日付形式を検証する", () => {
  const csv = [
    "app_id,record_type,schema_version,record_id,date,hamster,weight_g",
    "another-app,weight_record,1,weight-1,2026.07.10,しろ,121"
  ].join("\n");
  const parsed = parseAppWeightCsvImport(csv, "2026-07-11");

  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /このアプリ/);
  assert.match(parsed.errors[0].message, /YYYY-MM-DD/);
});

test("同期警告は連続失敗かつ一定時間経過後だけ表示し、回復時に解除する", () => {
  const startedAt = 1_000;
  let state = createRealtimeHealthState(startedAt);
  state = recordRealtimeFailure(state);
  state = recordRealtimeFailure(state);
  assert.equal(shouldShowRealtimeWarning(state, startedAt + 20_000), false);
  state = recordRealtimeFailure(state);
  assert.equal(shouldShowRealtimeWarning(state, startedAt + 11_999), false);
  assert.equal(shouldShowRealtimeWarning(state, startedAt + 12_000), true);
  state = recordRealtimeSuccess(state, startedAt + 12_001);
  assert.equal(shouldShowRealtimeWarning(state, startedAt + 30_000), false);
});

test("同期再試行間隔はバックオフし上限を超えない", () => {
  assert.equal(getRealtimeRetryDelay(0), REALTIME_BASE_RETRY_MS);
  assert.ok(getRealtimeRetryDelay(2) > getRealtimeRetryDelay(1));
  assert.equal(getRealtimeRetryDelay(100), REALTIME_MAX_RETRY_MS);
});

test("Pet RecordsのpetRecord変更をpublishし、通知失敗をcommit済みDB更新の失敗扱いにしない", () => {
  const change: CommittedHouseholdChange = {
    householdId: "household-1",
    source: "petRecord",
    actorClientId: "tab-1",
    actorUserId: "user-1",
    revision: "42"
  };
  const received: string[] = [];
  const unsubscribe = subscribeHouseholdChanges((event) => {
    if (event.householdId === change.householdId && event.source === "petRecord") {
      received.push(event.revision);
    }
  });
  try {
    assert.equal(publishHouseholdChangeSafely(change), true);
    assert.deepEqual(received, ["42"]);

    const reported: string[] = [];
    assert.equal(publishHouseholdChangeSafely(
      change,
      () => { throw new Error("publish failed"); },
      (error) => {
        reported.push(error instanceof Error ? error.message : "unknown");
        return "00000000-0000-4000-8000-000000000000";
      }
    ), false);
    assert.deepEqual(reported, ["publish failed"]);
  } finally {
    unsubscribe();
  }
});
