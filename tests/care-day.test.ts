import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CARE_DAY_START_MINUTES,
  formatMinutesAsTime,
  getCareDayDateInputJst,
  getCareDayRecordDate,
  normalizeCareDayStartMinutes,
  parseTimeInputToMinutes
} from "../src/lib/care-day";
import { todayInputJst, toDateInputValue } from "../src/lib/date";

test("デフォルト0時ではJSTの23:59と0:00でお世話日が切り替わる", () => {
  assert.equal(DEFAULT_CARE_DAY_START_MINUTES, 0);
  assert.equal(getCareDayDateInputJst(new Date("2026-08-01T14:59:59.999Z")), "2026-08-01");
  assert.equal(getCareDayDateInputJst(new Date("2026-08-01T15:00:00.000Z")), "2026-08-02");
});

test("8時設定では7:59:59.999が前日、8:00ちょうどが当日になる", () => {
  assert.equal(
    getCareDayDateInputJst(new Date("2026-08-01T22:59:59.999Z"), 8 * 60),
    "2026-08-01"
  );
  assert.equal(
    getCareDayDateInputJst(new Date("2026-08-01T23:00:00.000Z"), 8 * 60),
    "2026-08-02"
  );
});

test("月末、年末、うるう年をまたいでも前日のお世話日を正しく算出する", () => {
  assert.equal(getCareDayDateInputJst(new Date("2026-07-31T22:59:59.999Z"), 480), "2026-07-31");
  assert.equal(getCareDayDateInputJst(new Date("2025-12-31T22:59:59.999Z"), 480), "2025-12-31");
  assert.equal(getCareDayDateInputJst(new Date("2024-02-29T22:59:59.999Z"), 480), "2024-02-29");
});

test("お世話日計算とDB検索用DateはサーバーOSのローカルタイムゾーンに依存しない", () => {
  const originalTimeZone = process.env.TZ;
  try {
    const now = new Date("2026-08-01T22:59:59.999Z");
    process.env.TZ = "America/Los_Angeles";
    const losAngeles = getCareDayDateInputJst(now, 480);
    process.env.TZ = "Pacific/Auckland";
    const auckland = getCareDayDateInputJst(now, 480);

    assert.equal(losAngeles, "2026-08-01");
    assert.equal(auckland, losAngeles);
    assert.equal(toDateInputValue(getCareDayRecordDate(now, 480)), "2026-08-01");
  } finally {
    process.env.TZ = originalTimeZone;
  }
});

test("不正な設定値は安全な0時へ正規化する", () => {
  for (const value of [-1, 1440, 1.5, Number.NaN, null, undefined, "480"]) {
    assert.equal(normalizeCareDayStartMinutes(value), 0);
    assert.equal(getCareDayDateInputJst(new Date("2026-08-01T15:00:00.000Z"), value), "2026-08-02");
  }
  assert.equal(normalizeCareDayStartMinutes(1439), 1439);
});

test("HH:mm入力と分数を分単位で相互変換する", () => {
  assert.equal(parseTimeInputToMinutes("00:00"), 0);
  assert.equal(parseTimeInputToMinutes("08:00"), 480);
  assert.equal(parseTimeInputToMinutes("23:59"), 1439);
  assert.equal(parseTimeInputToMinutes("24:00"), null);
  assert.equal(parseTimeInputToMinutes("8:00"), null);
  assert.equal(parseTimeInputToMinutes(null), null);
  assert.equal(formatMinutesAsTime(480), "08:00");
  assert.equal(formatMinutesAsTime(1439), "23:59");
  assert.equal(formatMinutesAsTime(1440), "00:00");
});

test("通常のtodayInputJstはお世話日の切り替え設定から独立したまま", () => {
  const now = new Date("2026-08-01T22:59:59.999Z");
  assert.equal(todayInputJst(now), "2026-08-02");
  assert.equal(getCareDayDateInputJst(now, 480), "2026-08-01");
});
