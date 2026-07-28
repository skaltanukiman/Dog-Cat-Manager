const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function createUtcDate(year: number, monthIndex: number, day: number) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

export function isValidDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const date = createUtcDate(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidYearMonthInput(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && month >= 1 && month <= 12;
}

export function parseDateInput(value: string) {
  if (!isValidDateInput(value)) {
    throw new Error(`Invalid date input: ${value}`);
  }

  // DBは日付のみを扱うため、ブラウザやサーバーのローカルタイムゾーンで日付がずれないようUTC 00:00で固定する。
  const [year, month, day] = value.split("-").map(Number);
  return createUtcDate(year, month - 1, day);
}

export function toDateInputValue(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function formatDateJp(date: Date | null | undefined) {
  if (!date) {
    return "未記録";
  }

  return toDateInputValue(date).split("-").join("/");
}

function getJstDate(date: Date) {
  return new Date(date.getTime() + JST_OFFSET_MS);
}

// createdAtなど時刻を持つtimestampは、DBのUTC値をJSTへ変換してから表示する。
export function formatDateJst(date: Date | null | undefined) {
  if (!date) {
    return "未記録";
  }

  const jst = getJstDate(date);
  return `${jst.getUTCFullYear()}/${pad(jst.getUTCMonth() + 1)}/${pad(jst.getUTCDate())}`;
}

export function formatDateTimeJst(date: Date | null | undefined) {
  if (!date) {
    return "未記録";
  }

  const jst = getJstDate(date);
  return `${formatDateJst(date)} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

export function formatTimeJst(date: Date | null | undefined) {
  if (!date) {
    return "未記録";
  }

  const jst = getJstDate(date);
  return `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

export function todayInputJst(now = new Date()) {
  // 入力上限や経過日数は日本での運用を前提に、JSTの日付境界で判定する。
  const jst = getJstDate(now);
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}

export function currentMonthInputJst() {
  return todayInputJst().slice(0, 7);
}

export function isFutureDateInput(value: string) {
  return parseDateInput(value).getTime() > parseDateInput(todayInputJst()).getTime();
}

export function normalizeYearMonth(value: string | undefined | null) {
  return value && isValidYearMonthInput(value) ? value : currentMonthInputJst();
}

export function getDaysInMonth(yearMonth: string) {
  if (!isValidYearMonthInput(yearMonth)) {
    throw new Error(`Invalid month input: ${yearMonth}`);
  }

  const [year, month] = yearMonth.split("-").map(Number);
  const days = createUtcDate(year, month, 0).getUTCDate();

  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const date = `${yearMonth}-${pad(day)}`;
    const weekday = WEEKDAYS[createUtcDate(year, month - 1, day).getUTCDay()];

    return { date, day, weekday };
  });
}

export function monthDateRange(yearMonth: string) {
  if (!isValidYearMonthInput(yearMonth)) {
    throw new Error(`Invalid month input: ${yearMonth}`);
  }

  const [year, month] = yearMonth.split("-").map(Number);

  return {
    start: parseDateInput(`${yearMonth}-01`),
    // 終端は翌月1日の排他的境界にし、月末日の時刻差を気にせず検索できるようにする。
    end: createUtcDate(year, month, 1)
  };
}

export function daysSinceDate(date: Date) {
  const today = parseDateInput(todayInputJst());
  const target = parseDateInput(toDateInputValue(date));
  const diff = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  // 未来日入力は別途ブロックするが、既存データや時計差で負数表示にならないよう0で丸める。
  return Math.max(diff, 0);
}
