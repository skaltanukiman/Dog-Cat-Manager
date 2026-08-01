import { z } from "zod";

import {
  MAX_NOTIFY_BEFORE_MINUTES,
  parseTimeInputToMinutes,
  type CareNotificationSettings
} from "@/lib/care-notifications";

export const careNotificationSettingsFormSchema = z
  .object({
    feedingNotificationEnabled: z.boolean(),
    feedingDeadline: z.string(),
    feedingNotifyBeforeMinutes: z.coerce.number().int().min(0).max(MAX_NOTIFY_BEFORE_MINUTES),
    waterNotificationEnabled: z.boolean(),
    waterDeadline: z.string(),
    waterNotifyBeforeMinutes: z.coerce.number().int().min(0).max(MAX_NOTIFY_BEFORE_MINUTES),
    careNotificationCompactBody: z.boolean()
  })
  .superRefine((value, context) => {
    const feedingDeadline = parseTimeInputToMinutes(value.feedingDeadline);
    const waterDeadline = parseTimeInputToMinutes(value.waterDeadline);
    if (feedingDeadline === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["feedingDeadline"], message: "Invalid time" });
    } else if (value.feedingNotifyBeforeMinutes > feedingDeadline) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["feedingNotifyBeforeMinutes"], message: "Too early" });
    }
    if (waterDeadline === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["waterDeadline"], message: "Invalid time" });
    } else if (value.waterNotifyBeforeMinutes > waterDeadline) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["waterNotifyBeforeMinutes"], message: "Too early" });
    }
  });

export function parseCareNotificationSettingsForm(input: unknown): CareNotificationSettings | null {
  const result = careNotificationSettingsFormSchema.safeParse(input);
  if (!result.success) return null;
  const feedingDeadlineMinutes = parseTimeInputToMinutes(result.data.feedingDeadline);
  const waterDeadlineMinutes = parseTimeInputToMinutes(result.data.waterDeadline);
  if (feedingDeadlineMinutes === null || waterDeadlineMinutes === null) return null;
  return {
    feedingNotificationEnabled: result.data.feedingNotificationEnabled,
    feedingDeadlineMinutes,
    feedingNotifyBeforeMinutes: result.data.feedingNotifyBeforeMinutes,
    waterNotificationEnabled: result.data.waterNotificationEnabled,
    waterDeadlineMinutes,
    waterNotifyBeforeMinutes: result.data.waterNotifyBeforeMinutes,
    careNotificationCompactBody: result.data.careNotificationCompactBody
  };
}

export function careNotificationSettingsEqual(
  left: CareNotificationSettings,
  right: CareNotificationSettings
) {
  return (Object.keys(left) as (keyof CareNotificationSettings)[]).every((key) => left[key] === right[key]);
}
