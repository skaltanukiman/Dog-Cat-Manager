import { randomUUID } from "node:crypto";

import {
  addMinutes,
  buildCareNotificationBody,
  dueCareKinds,
  dueNotificationMinutes,
  getJstMinuteOfDay,
  isWithinNotificationWindow,
  normalizeCareNotificationSettings,
  notificationTargetDate,
  NOTIFICATION_CLAIM_LEASE_MINUTES,
  NOTIFICATION_LATE_WINDOW_MINUTES,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_RETRY_DELAY_MINUTES,
  NOTIFICATION_TITLE
} from "@/lib/care-notifications";
import { todayInputJst, toDateInputValue } from "@/lib/date";
import { writeServerLog } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  configureWebPush,
  isInvalidPushSubscriptionError,
  sendCareWebPush
} from "@/lib/web-push";

type ClaimedDispatch = {
  id: string;
  userId: string;
  householdId: string;
  targetDate: Date;
  scheduledMinute: number;
  attemptCount: number;
  claimToken: string;
};

export type CareNotificationDispatchSummary = {
  settingCount: number;
  candidateCount: number;
  claimedCount: number;
  sentCount: number;
  skippedCount: number;
  retryableCount: number;
  invalidSubscriptionCount: number;
  temporaryFailureCount: number;
};

function createSummary(): CareNotificationDispatchSummary {
  return {
    settingCount: 0,
    candidateCount: 0,
    claimedCount: 0,
    sentCount: 0,
    skippedCount: 0,
    retryableCount: 0,
    invalidSubscriptionCount: 0,
    temporaryFailureCount: 0
  };
}

async function reserveNewDispatch(
  userId: string,
  householdId: string,
  targetDate: Date,
  scheduledMinute: number,
  now: Date
): Promise<ClaimedDispatch | null> {
  const claimToken = randomUUID();
  const created = await prisma.careNotificationDispatch.createMany({
    data: {
      userId,
      householdId,
      targetDate,
      scheduledMinute,
      claimToken,
      claimedAt: now,
      leaseExpiresAt: addMinutes(now, NOTIFICATION_CLAIM_LEASE_MINUTES)
    },
    skipDuplicates: true
  });
  if (created.count !== 1) return null;
  return prisma.careNotificationDispatch.findFirst({
    where: {
      userId,
      householdId,
      targetDate,
      scheduledMinute,
      claimToken,
      status: "CLAIMED"
    },
    select: {
      id: true,
      userId: true,
      householdId: true,
      targetDate: true,
      scheduledMinute: true,
      attemptCount: true,
      claimToken: true
    }
  });
}

async function reclaimDispatch(id: string, now: Date): Promise<ClaimedDispatch | null> {
  const claimToken = randomUUID();
  const claimed = await prisma.careNotificationDispatch.updateMany({
    where: {
      id,
      attemptCount: { lt: NOTIFICATION_MAX_ATTEMPTS },
      OR: [
        { status: "RETRYABLE", nextAttemptAt: { lte: now } },
        { status: "CLAIMED", leaseExpiresAt: { lte: now } }
      ]
    },
    data: {
      status: "CLAIMED",
      claimToken,
      claimedAt: now,
      leaseExpiresAt: addMinutes(now, NOTIFICATION_CLAIM_LEASE_MINUTES),
      nextAttemptAt: null,
      attemptCount: { increment: 1 }
    }
  });
  if (claimed.count !== 1) return null;
  return prisma.careNotificationDispatch.findFirst({
    where: { id, claimToken, status: "CLAIMED" },
    select: {
      id: true,
      userId: true,
      householdId: true,
      targetDate: true,
      scheduledMinute: true,
      attemptCount: true,
      claimToken: true
    }
  });
}

async function finishDispatch(
  dispatch: ClaimedDispatch,
  status: "SENT" | "RETRYABLE" | "SKIPPED",
  now: Date
) {
  return prisma.careNotificationDispatch.updateMany({
    where: { id: dispatch.id, claimToken: dispatch.claimToken, status: "CLAIMED" },
    data: {
      status,
      lastAttemptAt: now,
      sentAt: status === "SENT" ? now : null,
      nextAttemptAt: status === "RETRYABLE" ? addMinutes(now, NOTIFICATION_RETRY_DELAY_MINUTES) : null,
      leaseExpiresAt: now
    }
  });
}

async function dispatchClaim(dispatch: ClaimedDispatch, now: Date) {
  const today = todayInputJst(now);
  if (
    toDateInputValue(dispatch.targetDate) !== today ||
    !isWithinNotificationWindow(getJstMinuteOfDay(now), dispatch.scheduledMinute)
  ) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }

  // 外部送信の直前に所属、設定、管理中個体、当日の実施記録をまとめて取り直す。
  const [membership, rawSetting] = await Promise.all([
    prisma.householdMember.findUnique({
      where: {
        householdId_userId: { householdId: dispatch.householdId, userId: dispatch.userId }
      },
      select: { id: true }
    }),
    prisma.appSetting.findUnique({
      where: {
        userId_householdId: { userId: dispatch.userId, householdId: dispatch.householdId }
      },
      select: {
        feedingNotificationEnabled: true,
        feedingDeadlineMinutes: true,
        feedingNotifyBeforeMinutes: true,
        waterNotificationEnabled: true,
        waterDeadlineMinutes: true,
        waterNotifyBeforeMinutes: true,
        careNotificationCompactBody: true,
        user: { select: { accessStatus: true } },
        household: { select: { isDemo: true } }
      }
    })
  ]);
  if (!membership || !rawSetting || rawSetting.user?.accessStatus !== "ACTIVE" || rawSetting.household?.isDemo) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }
  const setting = normalizeCareNotificationSettings(rawSetting);
  const kinds = dueCareKinds(setting, dispatch.scheduledMinute);
  if (kinds.length === 0) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }

  const hamsters = await prisma.hamster.findMany({
    where: { householdId: dispatch.householdId, isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      name: true,
      feedingRecords: {
        where: { recordDate: dispatch.targetDate },
        take: 1,
        select: { id: true }
      },
      waterReplacementRecords: {
        where: { recordDate: dispatch.targetDate },
        take: 1,
        select: { id: true }
      }
    }
  });
  const feedingNames = kinds.includes("feeding")
    ? hamsters.filter((hamster) => hamster.feedingRecords.length === 0).map((hamster) => hamster.name)
    : [];
  const waterNames = kinds.includes("water")
    ? hamsters
        .filter((hamster) => hamster.waterReplacementRecords.length === 0)
        .map((hamster) => hamster.name)
    : [];
  if (feedingNames.length === 0 && waterNames.length === 0) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }

  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { userId: dispatch.userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true }
  });
  if (subscriptions.length === 0) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }

  const body = buildCareNotificationBody(
    feedingNames,
    waterNames,
    setting.careNotificationCompactBody
  );
  let successCount = 0;
  let invalidCount = 0;
  let temporaryCount = 0;
  for (const subscription of subscriptions) {
    try {
      await sendCareWebPush(subscription, { title: NOTIFICATION_TITLE, body });
      successCount += 1;
      await prisma.webPushSubscription.updateMany({
        where: { id: subscription.id, userId: dispatch.userId },
        data: { lastSuccessAt: now }
      });
    } catch (error) {
      if (isInvalidPushSubscriptionError(error)) {
        invalidCount += 1;
        await prisma.webPushSubscription.deleteMany({
          where: { id: subscription.id, userId: dispatch.userId }
        });
      } else {
        temporaryCount += 1;
      }
    }
  }

  if (successCount > 0) {
    // 成功端末への重複送信を避けるため、一部端末だけ一時失敗しても配信全体は成功扱いにする。
    await finishDispatch(dispatch, "SENT", now);
    return { status: "sent" as const, invalid: invalidCount, temporary: temporaryCount };
  }
  if (temporaryCount > 0 && dispatch.attemptCount < NOTIFICATION_MAX_ATTEMPTS) {
    await finishDispatch(dispatch, "RETRYABLE", now);
    return { status: "retryable" as const, invalid: invalidCount, temporary: temporaryCount };
  }
  await finishDispatch(dispatch, "SKIPPED", now);
  return { status: "skipped" as const, invalid: invalidCount, temporary: temporaryCount };
}

export async function dispatchCareNotifications(now = new Date()) {
  configureWebPush();
  const summary = createSummary();
  const targetDate = notificationTargetDate(now);
  const nowMinute = getJstMinuteOfDay(now);

  await prisma.careNotificationDispatch.updateMany({
    where: {
      status: { in: ["CLAIMED", "RETRYABLE"] },
      OR: [
        { targetDate: { lt: targetDate } },
        {
          targetDate,
          scheduledMinute: { lt: Math.max(0, nowMinute - NOTIFICATION_LATE_WINDOW_MINUTES) },
          OR: [{ status: "RETRYABLE" }, { status: "CLAIMED", leaseExpiresAt: { lte: now } }]
        }
      ]
    },
    data: { status: "SKIPPED", nextAttemptAt: null, leaseExpiresAt: now }
  });

  const settings = await prisma.appSetting.findMany({
    where: {
      userId: { not: null },
      householdId: { not: null },
      household: { isDemo: false },
      user: { accessStatus: "ACTIVE" },
      OR: [{ feedingNotificationEnabled: true }, { waterNotificationEnabled: true }]
    },
    select: {
      userId: true,
      householdId: true,
      feedingNotificationEnabled: true,
      feedingDeadlineMinutes: true,
      feedingNotifyBeforeMinutes: true,
      waterNotificationEnabled: true,
      waterDeadlineMinutes: true,
      waterNotifyBeforeMinutes: true,
      careNotificationCompactBody: true
    }
  });
  summary.settingCount = settings.length;
  const claims: ClaimedDispatch[] = [];
  for (const rawSetting of settings) {
    if (!rawSetting.userId || !rawSetting.householdId) continue;
    const dueMinutes = dueNotificationMinutes(normalizeCareNotificationSettings(rawSetting), now);
    summary.candidateCount += dueMinutes.length;
    for (const scheduledMinute of dueMinutes) {
      const claim = await reserveNewDispatch(
        rawSetting.userId,
        rawSetting.householdId,
        targetDate,
        scheduledMinute,
        now
      );
      if (claim) claims.push(claim);
    }
  }

  const retryCandidates = await prisma.careNotificationDispatch.findMany({
    where: {
      targetDate,
      scheduledMinute: {
        gte: Math.max(0, nowMinute - NOTIFICATION_LATE_WINDOW_MINUTES),
        lte: nowMinute
      },
      attemptCount: { lt: NOTIFICATION_MAX_ATTEMPTS },
      OR: [
        { status: "RETRYABLE", nextAttemptAt: { lte: now } },
        { status: "CLAIMED", leaseExpiresAt: { lte: now } }
      ]
    },
    select: { id: true }
  });
  for (const candidate of retryCandidates) {
    const claim = await reclaimDispatch(candidate.id, now);
    if (claim) claims.push(claim);
  }
  summary.claimedCount = claims.length;

  for (const claim of claims) {
    const result = await dispatchClaim(claim, new Date());
    summary.invalidSubscriptionCount += result.invalid;
    summary.temporaryFailureCount += result.temporary;
    if (result.status === "sent") summary.sentCount += 1;
    if (result.status === "skipped") summary.skippedCount += 1;
    if (result.status === "retryable") summary.retryableCount += 1;
  }

  writeServerLog("info", {
    event: "care_notification_dispatch_completed",
    message: "お世話通知の判定と配信が完了しました。",
    operation: "careNotifications.dispatch",
    context: summary
  });
  return summary;
}
