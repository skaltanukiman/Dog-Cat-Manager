import type {
  HouseholdActivityCategory,
  HouseholdActivityEvent,
  HouseholdRole,
  Prisma
} from "@prisma/client";
import { formatDateTimeJst } from "@/lib/date";

export const HOUSEHOLD_ACTIVITY_PAGE_SIZE = 20;
export const ACTOR_NAME_FALLBACK = "名前未設定";

export type HouseholdActivityCreateInput = {
  eventType: HouseholdActivityEvent;
  category: HouseholdActivityCategory;
  targetType?: string | null;
  targetId?: string | null;
  targetNameSnapshot?: string | null;
  details?: Prisma.InputJsonValue;
};

export type HouseholdActivityListItem = {
  id: string;
  actorNameSnapshot: string;
  eventType: HouseholdActivityEvent;
  category: HouseholdActivityCategory;
  targetNameSnapshot: string | null;
  details: Prisma.JsonValue | null;
  createdAt: Date;
};

export function activityActorName(user: { name?: string | null }) {
  return user.name?.trim() || ACTOR_NAME_FALLBACK;
}

export async function createHouseholdActivity(
  tx: Prisma.TransactionClient,
  input: HouseholdActivityCreateInput & {
    householdId: string;
    actorUserId?: string | null;
    actorNameSnapshot: string;
  }
) {
  // User削除後も履歴を読めるよう表示名をsnapshotで保持し、メールなど不要な個人情報は保存しない。
  return tx.householdActivity.create({
    data: {
      householdId: input.householdId,
      actorUserId: input.actorUserId ?? null,
      actorNameSnapshot: input.actorNameSnapshot,
      eventType: input.eventType,
      category: input.category,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetNameSnapshot: input.targetNameSnapshot ?? null,
      ...(input.details === undefined ? {} : { details: input.details })
    }
  });
}

function detailRecord(details: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, Prisma.JsonValue>)
    : {};
}

function stringDetail(details: Record<string, Prisma.JsonValue>, key: string) {
  return typeof details[key] === "string" ? details[key] as string : null;
}

function numberDetail(details: Record<string, Prisma.JsonValue>, key: string) {
  return typeof details[key] === "number" && Number.isFinite(details[key]) ? details[key] as number : null;
}

function booleanDetail(details: Record<string, Prisma.JsonValue>, key: string) {
  return typeof details[key] === "boolean" ? details[key] as boolean : null;
}

const ROLE_LABELS: Record<HouseholdRole, string> = {
  OWNER: "オーナー",
  ADMIN: "管理者",
  MEMBER: "メンバー",
  VIEWER: "閲覧者"
};

function roleLabel(value: string | null) {
  return value && value in ROLE_LABELS ? ROLE_LABELS[value as HouseholdRole] : null;
}

function formatDateInput(value: string | null) {
  const match = value && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日` : null;
}

function formatMonthInput(value: string | null) {
  const match = value && /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}年${Number(match[2])}月` : null;
}

function formatTimestamp(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatDateTimeJst(date) : null;
}

function waterActionLabel(value: string | null) {
  return value === "REPLACED" ? "交換" : value === "REFILLED" ? "補充" : null;
}

export function formatHouseholdActivity(activity: HouseholdActivityListItem) {
  const actor = activity.actorNameSnapshot || ACTOR_NAME_FALLBACK;
  const target = activity.targetNameSnapshot || "対象";
  const details = detailRecord(activity.details);
  const fallback = { summary: `${actor}さんが操作しました`, detail: null as string | null };

  try {
    switch (activity.eventType) {
      case "HOUSEHOLD_NAME_UPDATED": return { summary: `${actor}さんが共有グループ名を変更しました`, detail: null };
      case "INVITATION_CREATED": return { summary: `${actor}さんが招待リンクを作成しました`, detail: null };
      case "INVITATION_REVOKED": return { summary: `${actor}さんが招待リンクを無効化しました`, detail: null };
      case "MEMBER_JOINED": return { summary: `${actor}さんが共有グループに参加しました`, detail: null };
      case "MEMBER_ROLE_UPDATED": {
        const before = roleLabel(stringDetail(details, "previousRole"));
        const after = roleLabel(stringDetail(details, "newRole"));
        return { summary: `${actor}さんが${target}さんの権限を変更しました`, detail: before && after ? `${before} → ${after}` : null };
      }
      case "MEMBER_REMOVED": return { summary: `${actor}さんが${target}さんの参加を解除しました`, detail: null };
      case "MEMBER_LEFT": return { summary: `${actor}さんが共有グループから退出しました`, detail: null };
      case "OWNERSHIP_TRANSFERRED_AND_LEFT": return { summary: `${actor}さんが${target}さんへ所有権を移譲して退出しました`, detail: null };
      case "HAMSTER_CREATED": return { summary: `${actor}さんが「${target}」を登録しました`, detail: null };
      case "HAMSTER_DELETED": return { summary: `${actor}さんが「${target}」を削除しました`, detail: null };
      case "WEIGHT_CREATED": {
        const weight = numberDetail(details, "weightG");
        const date = formatDateInput(stringDetail(details, "recordDate"));
        return { summary: `${actor}さんが「${target}」の体重を記録しました`, detail: weight !== null && date ? `${weight}g・${date}` : null };
      }
      case "WEIGHT_UPDATED": {
        const before = numberDetail(details, "previousWeightG");
        const after = numberDetail(details, "newWeightG");
        return { summary: `${actor}さんが「${target}」の体重を更新しました`, detail: before !== null && after !== null ? `${before}g → ${after}g` : null };
      }
      case "WEIGHT_DELETED": {
        const weight = numberDetail(details, "weightG");
        const date = formatDateInput(stringDetail(details, "recordDate"));
        return { summary: `${actor}さんが「${target}」の体重記録を削除しました`, detail: weight !== null && date ? `${weight}g・${date}` : null };
      }
      case "WEIGHTS_BULK_DELETED": {
        const count = numberDetail(details, "count");
        return { summary: `${actor}さんが体重記録を${count ?? 0}件削除しました`, detail: null };
      }
      case "WEIGHT_CSV_APP_IMPORTED":
      case "WEIGHT_CSV_GAS_IMPORTED": {
        const created = numberDetail(details, "createdCount") ?? 0;
        const updated = numberDetail(details, "updatedCount") ?? 0;
        const skipped = numberDetail(details, "skippedCount") ?? 0;
        return { summary: `${actor}さんがCSVから体重記録を取り込みました`, detail: `新規${created}件・更新${updated}件・スキップ${skipped}件` };
      }
      case "PET_WEIGHT_CREATED": {
        const weight = numberDetail(details, "weightKg");
        const date = formatDateInput(stringDetail(details, "recordDate"));
        return { summary: `${actor}さんが「${target}」の体重を記録しました`, detail: weight !== null && date ? `${weight}kg・${date}` : null };
      }
      case "PET_WEIGHT_UPDATED": {
        const before = numberDetail(details, "previousWeightKg");
        const after = numberDetail(details, "newWeightKg");
        return { summary: `${actor}さんが「${target}」の体重を更新しました`, detail: before !== null && after !== null ? `${before}kg → ${after}kg` : null };
      }
      case "PET_WEIGHT_DELETED": {
        const weight = numberDetail(details, "weightKg");
        const date = formatDateInput(stringDetail(details, "recordDate"));
        return { summary: `${actor}さんが「${target}」の体重記録を削除しました`, detail: weight !== null && date ? `${weight}kg・${date}` : null };
      }
      case "PET_FEEDING_CREATED":
        return {
          summary: `${actor}さんが「${target}」の食事を記録しました`,
          detail: formatTimestamp(stringDetail(details, "fedAt"))
        };
      case "PET_FEEDING_UPDATED":
        return {
          summary: `${actor}さんが「${target}」の食事を更新しました`,
          detail: formatTimestamp(stringDetail(details, "fedAt"))
        };
      case "PET_FEEDING_DELETED":
        return {
          summary: `${actor}さんが「${target}」の食事記録を削除しました`,
          detail: formatTimestamp(stringDetail(details, "fedAt"))
        };
      case "PET_WATER_CREATED": {
        const action = waterActionLabel(stringDetail(details, "action"));
        return {
          summary: `${actor}さんが「${target}」の水を${action ?? "お世話"}しました`,
          detail: formatTimestamp(stringDetail(details, "caredAt"))
        };
      }
      case "PET_WATER_UPDATED": {
        const action = waterActionLabel(stringDetail(details, "action"));
        return {
          summary: `${actor}さんが「${target}」の水のお世話を更新しました`,
          detail: [formatTimestamp(stringDetail(details, "caredAt")), action].filter(Boolean).join("・") || null
        };
      }
      case "PET_WATER_DELETED": {
        const action = waterActionLabel(stringDetail(details, "action"));
        return {
          summary: `${actor}さんが「${target}」の水の${action ? `${action}記録` : "記録"}を削除しました`,
          detail: formatTimestamp(stringDetail(details, "caredAt"))
        };
      }
      case "CLEANING_MONTH_SAVED": {
        const month = formatMonthInput(stringDetail(details, "yearMonth"));
        const count = numberDetail(details, "changedDayCount");
        return { summary: `${actor}さんが「${target}」の掃除記録を更新しました`, detail: month && count !== null ? `${month}・${count}日分` : null };
      }
      case "FEEDING_MARKED":
        return {
          summary: `${actor}さんが「${target}」の食事を実施済みにしました`,
          detail: formatDateInput(stringDetail(details, "recordDate"))
        };
      case "FEEDING_UNMARKED":
        return {
          summary: `${actor}さんが「${target}」の食事記録を取り消しました`,
          detail: formatDateInput(stringDetail(details, "recordDate"))
        };
      case "WATER_REPLACEMENT_MARKED":
        return {
          summary: `${actor}さんが「${target}」の水を交換済みにしました`,
          detail: formatDateInput(stringDetail(details, "recordDate"))
        };
      case "WATER_REPLACEMENT_UNMARKED":
        return {
          summary: `${actor}さんが「${target}」の水替え記録を取り消しました`,
          detail: formatDateInput(stringDetail(details, "recordDate"))
        };
      case "HEALTH_RECORD_CREATED":
      case "HEALTH_RECORD_UPDATED":
      case "HEALTH_RECORD_DELETED": {
        const action = activity.eventType === "HEALTH_RECORD_CREATED" ? "追加" : activity.eventType === "HEALTH_RECORD_UPDATED" ? "更新" : "削除";
        return {
          summary: `${actor}さんが「${target}」の健康記録を${action}しました`,
          detail: formatDateInput(stringDetail(details, "recordDate"))
        };
      }
      case "MEDICAL_RECORD_CREATED":
      case "MEDICAL_RECORD_UPDATED":
      case "MEDICAL_RECORD_DELETED": {
        const action = activity.eventType === "MEDICAL_RECORD_CREATED" ? "追加" : activity.eventType === "MEDICAL_RECORD_UPDATED" ? "更新" : "削除";
        return {
          summary: `${actor}さんが「${target}」の通院記録を${action}しました`,
          detail: formatDateInput(stringDetail(details, "recordDate"))
        };
      }
      case "MEMORY_RECORD_CREATED":
      case "MEMORY_RECORD_UPDATED":
      case "MEMORY_RECORD_DELETED": {
        const action = activity.eventType === "MEMORY_RECORD_CREATED" ? "追加" : activity.eventType === "MEMORY_RECORD_UPDATED" ? "更新" : "削除";
        return {
          summary: `${actor}さんが「${target}」の思い出を${action}しました`,
          detail: formatDateInput(stringDetail(details, "recordDate"))
        };
      }
      case "HAMSTER_PROFILE_IMAGE_UPDATED": {
        const action = stringDetail(details, "imageAction");
        const label = action === "ADDED" ? "登録" : action === "REPLACED" ? "変更" : action === "REMOVED" ? "削除" : "更新";
        return { summary: `${actor}さんが「${target}」のプロフィール画像を${label}しました`, detail: null };
      }
      case "HAMSTER_ACTIVE_STATUS_UPDATED": {
        const before = booleanDetail(details, "previousIsActive");
        const after = booleanDetail(details, "newIsActive");
        if (before === true && after === false) {
          return { summary: `${actor}さんが「${target}」を管理外に切り替えました`, detail: "管理中 → 管理外" };
        }
        if (before === false && after === true) {
          return { summary: `${actor}さんが「${target}」を管理中に戻しました`, detail: "管理外 → 管理中" };
        }
        return { summary: `${actor}さんが「${target}」の管理状態を変更しました`, detail: null };
      }
      default: return fallback;
    }
  } catch {
    // 過去行のJSON形式が変わっても履歴画面全体を壊さず、機密値を展開しない固定文言へ退避する。
    return fallback;
  }
}

export function parseActivityCategory(value: string | string[] | undefined): HouseholdActivityCategory | null {
  const category = Array.isArray(value) ? value[0] : value;
  return category === "CARE_RECORD" || category === "MEMBER" || category === "GROUP_SETTING" ? category : null;
}

export function parseActivityPage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : 1;
}
