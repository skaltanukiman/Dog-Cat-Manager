import { getCareDayDateInputJst } from "@/lib/care-day";
import { isValidDateInput } from "@/lib/date";

export const PET_CARE_MEMO_MAX_LENGTH = 500;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * `datetime-local`の値をサーバーOSのtimezoneに依存せずJSTとしてUTC timestampへ変換する。
 * 厳密な分精度の形式と、うるう年を含む実在日時だけを受け付ける。
 */
export function parseJstDateTimeLocal(value: string) {
  const match = DATETIME_LOCAL_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid JST datetime-local input: ${value}`);

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) {
    throw new Error(`Invalid JST datetime-local input: ${value}`);
  }

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour - 9, minute, 0, 0);

  // UTCへ変換後にJSTへ戻して比較し、月末超過などDateの自動繰り上がりを拒否する。
  if (formatJstDateTimeLocal(date) !== value) {
    throw new Error(`Invalid JST datetime-local input: ${value}`);
  }
  return date;
}

export function isValidJstDateTimeLocal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parseJstDateTimeLocal(value);
    return true;
  } catch {
    return false;
  }
}

/** UTC timestampを`datetime-local`へ戻せるJSTの分精度文字列にする。 */
export function formatJstDateTimeLocal(date: Date) {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

export function isFuturePetCareTimestamp(timestamp: Date, now = new Date()) {
  return timestamp.getTime() > now.getTime();
}

export function isSameInputMinute(left: Date, right: Date) {
  return Math.floor(left.getTime() / 60_000) === Math.floor(right.getTime() / 60_000);
}

export function isTimestampInCareDate(timestamp: Date, careDate: string, careDayStartMinutes: number) {
  return getCareDayDateInputJst(timestamp, careDayStartMinutes) === careDate;
}

/** 不正または未来のお世話日は、Household境界で算出した現在のお世話日へ戻す。 */
export function normalizePetCareDate(value: string | undefined, currentCareDate: string) {
  return value && isValidDateInput(value) && value <= currentCareDate ? value : currentCareDate;
}

/** 過去のお世話日の新規入力には、その日の開始時刻をJSTで初期表示する。 */
export function careDateStartDateTimeLocal(careDate: string, careDayStartMinutes: number) {
  const [year, month, day] = careDate.split("-").map(Number);
  const hour = Math.floor(careDayStartMinutes / 60);
  const minute = careDayStartMinutes % 60;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

export const PET_WATER_ACTION_LABELS = {
  REPLACED: "交換",
  REFILLED: "補充"
} as const;

export const PET_LITTER_ACTION_LABELS = {
  URINATION: "おしっこ",
  DEFECATION: "うんち",
  BOTH: "おしっこ・うんち",
  CLEANED: "トイレ掃除"
} as const;
