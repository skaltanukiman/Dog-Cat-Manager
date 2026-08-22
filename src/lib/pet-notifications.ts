import { formatMinutesAsTime, getCareDayRecordDate, isMinuteOfDay } from "@/lib/care-day";
import { toDateInputValue } from "@/lib/date";
import { parseJstDateTimeLocal } from "@/lib/pet-care";

export type PetNotificationKind = "FEEDING" | "WATER" | "WALK" | "LITTER_CLEANING";
export type NotificationPetSpecies = "DOG" | "CAT";

export const PET_NOTIFICATION_RULE_MAX_COUNT = 20;
export const PET_NOTIFICATION_LABEL_MAX_LENGTH = 40;
export const MAX_NOTIFY_BEFORE_MINUTES = 12 * 60;
export const NOTIFICATION_LATE_WINDOW_MINUTES = 60;
export const NOTIFICATION_RETRY_DELAY_MINUTES = 5;
export const NOTIFICATION_CLAIM_LEASE_MINUTES = 2;
export const NOTIFICATION_MAX_ATTEMPTS = 3;
export const NOTIFICATION_TITLE = "犬・猫のお世話を確認してください";
export const NOTIFICATION_BODY_MAX_LENGTH = 180;

export const PET_NOTIFICATION_KIND_LABELS: Record<PetNotificationKind, string> = {
  FEEDING: "食事",
  WATER: "水のお世話",
  WALK: "散歩",
  LITTER_CLEANING: "猫トイレ清掃"
};

const SPECIES_KINDS: Record<NotificationPetSpecies, readonly PetNotificationKind[]> = {
  DOG: ["FEEDING", "WATER", "WALK"],
  CAT: ["FEEDING", "WATER", "LITTER_CLEANING"]
};

export function notificationKindsForSpecies(species: NotificationPetSpecies) {
  return SPECIES_KINDS[species];
}

export function isNotificationKindAllowed(
  species: NotificationPetSpecies,
  kind: PetNotificationKind
) {
  return SPECIES_KINDS[species].includes(kind);
}

/** Care種別ごとに通知完了として消費できる記録かを判定する。 */
export function isCompletingPetCareRecord(kind: PetNotificationKind, action?: string) {
  if (kind === "LITTER_CLEANING") return action === "CLEANED";
  if (kind === "WATER") return action === "REPLACED" || action === "REFILLED";
  return kind === "FEEDING" || kind === "WALK";
}

/** JST壁時計の分数を、Householdのお世話日開始からの経過分数へ変換する。 */
export function careDayOffset(wallClockMinutes: number, careDayStartMinutes: number) {
  if (!isMinuteOfDay(wallClockMinutes) || !isMinuteOfDay(careDayStartMinutes)) {
    throw new Error("Invalid care-day minute");
  }
  return (wallClockMinutes - careDayStartMinutes + 1440) % 1440;
}

/**
 * お世話日とJST壁時計から、そのお世話日内にある実際のUTC timestampを返す。
 * 境界より前の壁時計は暦日の翌日に配置するため、深夜を跨ぐ期限も一意に決まる。
 */
export function careDayWallClockDateTime(
  targetCareDate: string,
  careDayStartMinutes: number,
  wallClockMinutes: number
) {
  const start = parseJstDateTimeLocal(
    `${targetCareDate}T${formatMinutesAsTime(careDayStartMinutes)}`
  );
  return new Date(start.getTime() + careDayOffset(wallClockMinutes, careDayStartMinutes) * 60_000);
}

/** 通知予定時刻を日跨ぎを含む実DateTimeとして計算する。 */
export function notificationScheduledDateTime(
  targetCareDate: string,
  careDayStartMinutes: number,
  deadlineMinutes: number,
  notifyBeforeMinutes: number
) {
  if (!Number.isSafeInteger(notifyBeforeMinutes) || notifyBeforeMinutes < 0) {
    throw new Error("Invalid notification lead time");
  }
  const deadline = careDayWallClockDateTime(
    targetCareDate,
    careDayStartMinutes,
    deadlineMinutes
  );
  return new Date(deadline.getTime() - notifyBeforeMinutes * 60_000);
}

export function isNotificationScheduleWithinCareDay(
  careDayStartMinutes: number,
  deadlineMinutes: number,
  notifyBeforeMinutes: number
) {
  if (
    !isMinuteOfDay(careDayStartMinutes) ||
    !isMinuteOfDay(deadlineMinutes) ||
    !Number.isSafeInteger(notifyBeforeMinutes) ||
    notifyBeforeMinutes < 0 ||
    notifyBeforeMinutes > MAX_NOTIFY_BEFORE_MINUTES
  ) {
    return false;
  }
  return notifyBeforeMinutes <= careDayOffset(deadlineMinutes, careDayStartMinutes);
}

export function notificationTargetCareDate(now: Date, careDayStartMinutes: number) {
  return getCareDayRecordDate(now, careDayStartMinutes);
}

export function isWithinNotificationWindow(
  now: Date,
  scheduledAt: Date,
  lateWindowMinutes = NOTIFICATION_LATE_WINDOW_MINUTES
) {
  const delay = now.getTime() - scheduledAt.getTime();
  return delay >= 0 && delay <= lateWindowMinutes * 60_000;
}

export type RuleForCompletion = {
  id: string;
  deadlineMinutes: number;
};

/**
 * 同一Pet・同一kindの記録を期限ごとの半開区間へ割り当て、各ルールの実施済み状態を返す。
 * 最初だけお世話日開始を含み、以降は前期限を含めないため境界上の記録を二重消費しない。
 */
export function evaluateRuleCompletions(
  rules: readonly RuleForCompletion[],
  recordTimes: readonly Date[],
  targetCareDate: string,
  careDayStartMinutes: number
) {
  const careDayStart = careDayWallClockDateTime(
    targetCareDate,
    careDayStartMinutes,
    careDayStartMinutes
  );
  const sorted = [...rules].sort((left, right) => {
    const difference =
      careDayOffset(left.deadlineMinutes, careDayStartMinutes) -
      careDayOffset(right.deadlineMinutes, careDayStartMinutes);
    return difference || left.id.localeCompare(right.id);
  });
  const result = new Map<string, boolean>();
  let previousDeadline: Date | null = null;

  for (const rule of sorted) {
    const deadline = careDayWallClockDateTime(
      targetCareDate,
      careDayStartMinutes,
      rule.deadlineMinutes
    );
    const completed = recordTimes.some((recordTime) => {
      const timestamp = recordTime.getTime();
      const afterStart = previousDeadline
        ? timestamp > previousDeadline.getTime()
        : timestamp >= careDayStart.getTime();
      return afterStart && timestamp <= deadline.getTime();
    });
    result.set(rule.id, completed);
    previousDeadline = deadline;
  }
  return result;
}

function safeNotificationText(value: string, fallback: string, maxLength: number) {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim() || fallback;
  return Array.from(cleaned).slice(0, maxLength).join("");
}

export type PendingNotificationItem = {
  petName: string;
  label: string;
};

/** 未実施ルールを制御文字除去とUnicode単位の上限付きPush本文へ変換する。 */
export function buildPetCareNotificationBody(
  items: readonly PendingNotificationItem[],
  compactBody = false
) {
  if (compactBody) return `未実施のお世話があります（${items.length}件）`;
  const lines = items.map(
    (item) =>
      `${safeNotificationText(item.petName, "Pet", 30)}：${safeNotificationText(
        item.label,
        "お世話",
        PET_NOTIFICATION_LABEL_MAX_LENGTH
      )}が未実施です`
  );
  const body = lines.join("\n") || "お世話の状況をアプリで確認してください。";
  const characters = Array.from(body);
  return characters.length <= NOTIFICATION_BODY_MAX_LENGTH
    ? body
    : `${characters.slice(0, NOTIFICATION_BODY_MAX_LENGTH - 1).join("")}…`;
}

export function notificationDispatchKeyDate(targetCareDate: Date) {
  return toDateInputValue(targetCareDate);
}
