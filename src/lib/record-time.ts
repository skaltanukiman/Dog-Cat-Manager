const RECORD_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function parseRecordTimeInput(value: string) {
  if (!RECORD_TIME_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatRecordTime(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || !Number.isInteger(minutes) || minutes < 0 || minutes > 1439) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * 日付のみのrecordDateとJST壁時計の分数を比較する。
 * UTC timestampへ変換しないことで、DBに保存した記録日の暦日を維持する。
 */
export function isFutureRecordTime(recordDate: string, minutes: number | null, now = new Date()) {
  if (minutes === null) return false;

  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const currentDate = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`;
  if (recordDate !== currentDate) return recordDate > currentDate;

  return minutes > jst.getUTCHours() * 60 + jst.getUTCMinutes();
}
