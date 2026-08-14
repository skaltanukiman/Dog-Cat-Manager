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
