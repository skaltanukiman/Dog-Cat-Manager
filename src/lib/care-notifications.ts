import {
  getCareDayRecordDate,
  isMinuteOfDay
} from "@/lib/care-day";

export { formatMinutesAsTime, isMinuteOfDay, parseTimeInputToMinutes } from "@/lib/care-day";

export const DEFAULT_FEEDING_DEADLINE_MINUTES = 22 * 60;
export const DEFAULT_WATER_DEADLINE_MINUTES = 21 * 60;
export const DEFAULT_NOTIFY_BEFORE_MINUTES = 30;
export const MAX_NOTIFY_BEFORE_MINUTES = 12 * 60;
// 定期実行の遅延を1時間まで許容し、送信処理は短いリースで確保して一時失敗時だけ再試行する。
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
  careNotificationCompactBody: boolean;
};

export type CareKind = "feeding" | "water";

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
    waterNotifyBeforeMinutes,
    careNotificationCompactBody: setting?.careNotificationCompactBody === true
  };
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

/**
 * 現在のJST時刻が送信対象となる通知予定分を昇順で返す。
 *
 * 定期実行の遅延を許容する時間窓内だけを対象とし、食事と水替えが同じ予定時刻なら
 * 1件のdispatchへまとめるため重複分を返さない。
 */
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

/**
 * 1件のdispatch予定分に含めるお世話種別を返す。
 *
 * 食事と水替えの予定分が一致する場合は両方を返し、通知本文を1件に統合できるようにする。
 */
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

/**
 * 未実施のお世話を、Web Pushの長さ制限内に収まる通知本文へ変換する。
 *
 * 個体名から制御文字を除き、長い一覧は件数表記へ畳み、最終的にUnicode文字単位で切り詰める。
 */
export function buildCareNotificationBody(
  feedingNames: string[],
  waterNames: string[],
  compactBody = false
) {
  const lines: string[] = [];
  if (feedingNames.length > 0) {
    lines.push(compactBody ? "【食事】未実施" : compactNames(feedingNames, "【食事】未実施："));
  }
  if (waterNames.length > 0) {
    lines.push(compactBody ? "【水替え】未実施" : compactNames(waterNames, "【水替え】未実施："));
  }
  const body = lines.join("｜") || "お世話の状況をアプリで確認してください。";
  const characters = Array.from(body);
  return characters.length <= NOTIFICATION_BODY_MAX_LENGTH
    ? body
    : `${characters.slice(0, NOTIFICATION_BODY_MAX_LENGTH - 1).join("")}…`;
}

/**
 * 通知が対象とするお世話日を、Householdの日替わり時刻に基づいて返す。
 *
 * 戻り値はtimestampではなく、日付専用のUTC 00:00の`Date`である。
 */
export function notificationTargetDate(now: Date, careDayStartMinutes = 0) {
  return getCareDayRecordDate(now, careDayStartMinutes);
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}
