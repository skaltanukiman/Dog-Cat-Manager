import { z } from "zod";

import {
  isNotificationKindAllowed,
  isNotificationScheduleWithinCareDay,
  MAX_NOTIFY_BEFORE_MINUTES,
  PET_NOTIFICATION_LABEL_MAX_LENGTH,
  PET_NOTIFICATION_RULE_MAX_COUNT,
  type PetNotificationKind
} from "@/lib/pet-notifications";
import type { NotificationPetSpecies } from "@/lib/pet-notifications";

const ruleSchema = z.object({
  kind: z.enum(["FEEDING", "WATER", "WALK", "LITTER_CLEANING"]),
  label: z.string().trim().min(1).max(PET_NOTIFICATION_LABEL_MAX_LENGTH),
  deadlineMinutes: z.number().int().min(0).max(1439),
  notifyBeforeMinutes: z.number().int().min(0).max(MAX_NOTIFY_BEFORE_MINUTES),
  enabled: z.boolean()
});

export type PetNotificationRuleInput = {
  kind: PetNotificationKind;
  label: string;
  deadlineMinutes: number;
  notifyBeforeMinutes: number;
  enabled: boolean;
};

// 件数・重複・species・care-day制約はPet取得後に理由を区別して検証する。
const rulesSchema = z.array(ruleSchema);

export function parsePetNotificationRulesJson(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.length > 12_000) return null;
  try {
    const parsed = rulesSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function petNotificationRulesEqual(
  current: readonly PetNotificationRuleInput[],
  next: readonly PetNotificationRuleInput[]
) {
  const sort = (rules: readonly PetNotificationRuleInput[]) =>
    [...rules].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.deadlineMinutes - right.deadlineMinutes
    );
  return JSON.stringify(sort(current)) === JSON.stringify(sort(next));
}

export function validatePetNotificationRuleSet(
  species: NotificationPetSpecies,
  careDayStartMinutes: number,
  rules: readonly PetNotificationRuleInput[]
) {
  if (rules.length > PET_NOTIFICATION_RULE_MAX_COUNT) return "tooMany" as const;
  const unique = new Set<string>();
  for (const rule of rules) {
    if (!isNotificationKindAllowed(species, rule.kind)) return "speciesMismatch" as const;
    if (
      !isNotificationScheduleWithinCareDay(
        careDayStartMinutes,
        rule.deadlineMinutes,
        rule.notifyBeforeMinutes
      )
    ) {
      return "invalidSchedule" as const;
    }
    const key = `${rule.kind}:${rule.deadlineMinutes}`;
    if (unique.has(key)) return "duplicate" as const;
    unique.add(key);
  }
  return null;
}
