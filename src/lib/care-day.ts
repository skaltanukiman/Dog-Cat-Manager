import { parseDateInput } from "@/lib/date";

export const DEFAULT_CARE_DAY_START_MINUTES = 0;

const JST_OFFSET_MINUTES = 9 * 60;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function isMinuteOfDay(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1439;
}

export function normalizeCareDayStartMinutes(value: unknown) {
  return isMinuteOfDay(value) ? value : DEFAULT_CARE_DAY_START_MINUTES;
}

export function parseTimeInputToMinutes(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatMinutesAsTime(value: unknown) {
  const safeValue = normalizeCareDayStartMinutes(value);
  return `${pad(Math.floor(safeValue / 60))}:${pad(safeValue % 60)}`;
}

export function getCareDayDateInputJst(
  now = new Date(),
  careDayStartMinutes: unknown = DEFAULT_CARE_DAY_START_MINUTES
) {
  // JSTへ移した後に切り替え時刻分を戻し、そのUTC暦日をお世話日として扱う。
  // UTC系getterだけを使うため、サーバーOSのローカルタイムゾーンには依存しない。
  const normalizedStartMinutes = normalizeCareDayStartMinutes(careDayStartMinutes);
  const shifted = new Date(
    now.getTime() + (JST_OFFSET_MINUTES - normalizedStartMinutes) * 60_000
  );
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function getCareDayRecordDate(
  now = new Date(),
  careDayStartMinutes: unknown = DEFAULT_CARE_DAY_START_MINUTES
) {
  return parseDateInput(getCareDayDateInputJst(now, careDayStartMinutes));
}
