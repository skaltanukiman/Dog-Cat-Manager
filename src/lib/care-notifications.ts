import { parseDateInput, todayInputJst } from "@/lib/date";

export const DEFAULT_FEEDING_DEADLINE_MINUTES = 22 * 60;
export const DEFAULT_WATER_DEADLINE_MINUTES = 21 * 60;
export const DEFAULT_NOTIFY_BEFORE_MINUTES = 30;
export const MAX_NOTIFY_BEFORE_MINUTES = 12 * 60;
export const NOTIFICATION_LATE_WINDOW_MINUTES = 60;
export const NOTIFICATION_RETRY_DELAY_MINUTES = 5;
export const NOTIFICATION_CLAIM_LEASE_MINUTES = 2;
export const NOTIFICATION_MAX_ATTEMPTS = 3;
export const NOTIFICATION_TITLE = "ハムスターのお世話を確認してください";
export const NOTIFICATION_BODY_MAX_LENGTH = 180;

export type CareNotificationSettings = {
  feedingNotificationEnabled: boolean;
  feedingDeadlineMinutes: number;
  feedingNotifyBeforeMinutes: number;
  waterNotificationEnabled: boolean;
  waterDeadlineMinutes: number;
  waterNotifyBeforeMinutes: number;
};

export type CareKind = "feeding" | "water";

export function isMinuteOfDay(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1439;
}

export function normalizeCareNotificationSettings(
  setting: Partial<CareNotificationSettings> | null | undefined
): CareNotificationSettings {
  const feedingDeadlineMinutes = isMinuteOfDay(setting?.feedingDeadlineMinutes)
    ? setting.feedingDeadlineMinutes
    : DEFAULT_FEEDING_DEADLINE_MINUTES;
  const waterDeadlineMinutes = isMinuteOfDay(setting?.waterDeadlineMinutes)
    ? setting.waterDeadlineMinutes
    : DEFAULT_WATER_DEADLINE_MINUTES;
  const feedingNotifyBeforeMinutes =
    Number.isSafeInteger(setting?.feedingNotifyBeforeMinutes) &&
    Number(setting?.feedingNotifyBeforeMinutes) >= 0 &&
    Number(setting?.feedingNotifyBeforeMinutes) <= Math.min(MAX_NOTIFY_BEFORE_MINUTES, feedingDeadlineMinutes)
      ? Number(setting?.feedingNotifyBeforeMinutes)
      : Math.min(DEFAULT_NOTIFY_BEFORE_MINUTES, feedingDeadlineMinutes);
  const waterNotifyBeforeMinutes =
    Number.isSafeInteger(setting?.waterNotifyBeforeMinutes) &&
    Number(setting?.waterNotifyBeforeMinutes) >= 0 &&
    Number(setting?.waterNotifyBeforeMinutes) <= Math.min(MAX_NOTIFY_BEFORE_MINUTES, waterDeadlineMinutes)
      ? Number(setting?.waterNotifyBeforeMinutes)
      : Math.min(DEFAULT_NOTIFY_BEFORE_MINUTES, waterDeadlineMinutes);

  return {
    feedingNotificationEnabled: setting?.feedingNotificationEnabled === true,
    feedingDeadlineMinutes,
    feedingNotifyBeforeMinutes,
    waterNotificationEnabled: setting?.waterNotificationEnabled === true,
    waterDeadlineMinutes,
    waterNotifyBeforeMinutes
  };
}

export function parseTimeInputToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatMinutesAsTime(value: number) {
  const safeValue = isMinuteOfDay(value) ? value : 0;
  return `${String(Math.floor(safeValue / 60)).padStart(2, "0")}:${String(safeValue % 60).padStart(2, "0")}`;
}

export function getJstMinuteOfDay(now: Date) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

export function getNotificationScheduledMinute(deadlineMinutes: number, notifyBeforeMinutes: number) {
  return deadlineMinutes - notifyBeforeMinutes;
}

export function isWithinNotificationWindow(
  nowMinute: number,
  scheduledMinute: number,
  lateWindowMinutes = NOTIFICATION_LATE_WINDOW_MINUTES
) {
  return nowMinute >= scheduledMinute && nowMinute <= Math.min(1439, scheduledMinute + lateWindowMinutes);
}

export function dueNotificationMinutes(setting: CareNotificationSettings, now: Date) {
  const nowMinute = getJstMinuteOfDay(now);
  const due = new Set<number>();
  if (setting.feedingNotificationEnabled) {
    const minute = getNotificationScheduledMinute(
      setting.feedingDeadlineMinutes,
      setting.feedingNotifyBeforeMinutes
    );
    if (isWithinNotificationWindow(nowMinute, minute)) due.add(minute);
  }
  if (setting.waterNotificationEnabled) {
    const minute = getNotificationScheduledMinute(
      setting.waterDeadlineMinutes,
      setting.waterNotifyBeforeMinutes
    );
    if (isWithinNotificationWindow(nowMinute, minute)) due.add(minute);
  }
  return [...due].sort((left, right) => left - right);
}

export function dueCareKinds(setting: CareNotificationSettings, scheduledMinute: number): CareKind[] {
  const kinds: CareKind[] = [];
  if (
    setting.feedingNotificationEnabled &&
    getNotificationScheduledMinute(setting.feedingDeadlineMinutes, setting.feedingNotifyBeforeMinutes) ===
      scheduledMinute
  ) {
    kinds.push("feeding");
  }
  if (
    setting.waterNotificationEnabled &&
    getNotificationScheduledMinute(setting.waterDeadlineMinutes, setting.waterNotifyBeforeMinutes) ===
      scheduledMinute
  ) {
    kinds.push("water");
  }
  return kinds;
}

function safeName(value: string) {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "名前未設定").slice(0, 30).join("");
}

function compactNames(names: string[], prefix: string, maxLength = 88) {
  const safeNames = names.map(safeName);
  const shown: string[] = [];
  for (const name of safeNames) {
    const remaining = safeNames.length - shown.length - 1;
    const suffix = remaining > 0 ? `、ほか${remaining}匹` : "";
    const candidate = `${prefix}${[...shown, name].join("、")}${suffix}`;
    if (Array.from(candidate).length > maxLength) break;
    shown.push(name);
  }
  if (shown.length === 0) return `${prefix}${safeNames.length}匹`;
  const omitted = safeNames.length - shown.length;
  return `${prefix}${shown.join("、")}${omitted > 0 ? `、ほか${omitted}匹` : ""}`;
}

export function buildCareNotificationBody(feedingNames: string[], waterNames: string[]) {
  const lines: string[] = [];
  if (feedingNames.length > 0) lines.push(compactNames(feedingNames, "食事が未実施："));
  if (waterNames.length > 0) lines.push(compactNames(waterNames, "水替えが未交換："));
  const body = lines.join("\n") || "お世話の状況をアプリで確認してください。";
  const characters = Array.from(body);
  return characters.length <= NOTIFICATION_BODY_MAX_LENGTH
    ? body
    : `${characters.slice(0, NOTIFICATION_BODY_MAX_LENGTH - 1).join("")}…`;
}

export function notificationTargetDate(now: Date) {
  return parseDateInput(todayInputJst(now));
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}
