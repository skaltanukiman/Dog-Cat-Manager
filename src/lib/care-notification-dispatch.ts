import { randomUUID } from "node:crypto";

import type { PetNotificationKind } from "@prisma/client";

import { toDateInputValue } from "@/lib/date";
import { writeServerLog } from "@/lib/logger";
import {
  buildPetCareNotificationBody,
  evaluateRuleCompletions,
  isNotificationKindAllowed,
  isNotificationScheduleWithinCareDay,
  isWithinNotificationWindow,
  notificationScheduledDateTime,
  notificationTargetCareDate,
  NOTIFICATION_CLAIM_LEASE_MINUTES,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_RETRY_DELAY_MINUTES,
  NOTIFICATION_TITLE,
  type PendingNotificationItem
} from "@/lib/pet-notifications";
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
  targetCareDate: Date;
  scheduledAt: Date;
  attemptCount: number;
  claimToken: string;
};

export type CareNotificationDispatchSummary = {
  ruleCount: number;
  candidateCount: number;
  claimedCount: number;
  sentCount: number;
  skippedCount: number;
  retryableCount: number;
  invalidSubscriptionCount: number;
  temporaryFailureCount: number;
};

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function createSummary(): CareNotificationDispatchSummary {
  return {
    ruleCount: 0,
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
  targetCareDate: Date,
  scheduledAt: Date,
  now: Date
): Promise<ClaimedDispatch | null> {
  const claimToken = randomUUID();
  // 同じ実通知予定時刻の複数Pet・複数ルールを複合一意制約で1 dispatchへ集約する。
  const created = await prisma.careNotificationDispatch.createMany({
    data: {
      userId,
      householdId,
      targetCareDate,
      scheduledAt,
      claimToken,
      claimedAt: now,
      leaseExpiresAt: addMinutes(now, NOTIFICATION_CLAIM_LEASE_MINUTES)
    },
    skipDuplicates: true
  });
  if (created.count !== 1) return null;
  return prisma.careNotificationDispatch.findFirst({
    where: { userId, householdId, targetCareDate, scheduledAt, claimToken, status: "CLAIMED" },
    select: {
      id: true,
      userId: true,
      householdId: true,
      targetCareDate: true,
      scheduledAt: true,
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
      targetCareDate: true,
      scheduledAt: true,
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
  // claim tokenをフェンスにし、期限切れリースの古い処理が新しいclaimを上書きしない。
  return prisma.careNotificationDispatch.updateMany({
    where: { id: dispatch.id, claimToken: dispatch.claimToken, status: "CLAIMED" },
    data: {
      status,
      lastAttemptAt: now,
      sentAt: status === "SENT" ? now : null,
      nextAttemptAt: status === "RETRYABLE"
        ? addMinutes(now, NOTIFICATION_RETRY_DELAY_MINUTES)
        : null,
      leaseExpiresAt: now
    }
  });
}

type DueRule = {
  id: string;
  petId: string;
  kind: PetNotificationKind;
  label: string;
  deadlineMinutes: number;
  pet: { name: string; species: "DOG" | "CAT" };
};

function groupKey(petId: string, kind: PetNotificationKind) {
  return `${petId}:${kind}`;
}

async function pendingItemsForDispatch(
  dispatch: ClaimedDispatch,
  careDayStartMinutes: number,
  dueRules: DueRule[]
) {
  const targetCareDate = toDateInputValue(dispatch.targetCareDate);
  const petIds = [...new Set(dueRules.map((rule) => rule.petId))];
  const allRules = await prisma.petNotificationRule.findMany({
    where: {
      userId: dispatch.userId,
      householdId: dispatch.householdId,
      petId: { in: petIds }
    },
    select: { id: true, petId: true, kind: true, deadlineMinutes: true }
  });
  const feedingPetIds = petIds.filter((petId) => dueRules.some((rule) => rule.petId === petId && rule.kind === "FEEDING"));
  const waterPetIds = petIds.filter((petId) => dueRules.some((rule) => rule.petId === petId && rule.kind === "WATER"));
  const walkPetIds = petIds.filter((petId) => dueRules.some((rule) => rule.petId === petId && rule.kind === "WALK"));
  const litterPetIds = petIds.filter((petId) => dueRules.some((rule) => rule.petId === petId && rule.kind === "LITTER_CLEANING"));
  const [feeding, water, walk, litter] = await Promise.all([
    prisma.petFeedingRecord.findMany({
      where: { petId: { in: feedingPetIds }, recordDate: dispatch.targetCareDate, pet: { householdId: dispatch.householdId, isActive: true } },
      select: { petId: true, fedAt: true }
    }),
    prisma.petWaterRecord.findMany({
      where: { petId: { in: waterPetIds }, recordDate: dispatch.targetCareDate, pet: { householdId: dispatch.householdId, isActive: true } },
      select: { petId: true, caredAt: true }
    }),
    prisma.petWalkRecord.findMany({
      where: { petId: { in: walkPetIds }, recordDate: dispatch.targetCareDate, pet: { householdId: dispatch.householdId, species: "DOG", isActive: true } },
      select: { petId: true, startedAt: true }
    }),
    prisma.petLitterRecord.findMany({
      where: { petId: { in: litterPetIds }, recordDate: dispatch.targetCareDate, action: "CLEANED", pet: { householdId: dispatch.householdId, species: "CAT", isActive: true } },
      select: { petId: true, occurredAt: true }
    })
  ]);

  const times = new Map<string, Date[]>();
  const add = (key: string, time: Date) => times.set(key, [...(times.get(key) ?? []), time]);
  feeding.forEach((record) => add(groupKey(record.petId, "FEEDING"), record.fedAt));
  water.forEach((record) => add(groupKey(record.petId, "WATER"), record.caredAt));
  walk.forEach((record) => add(groupKey(record.petId, "WALK"), record.startedAt));
  litter.forEach((record) => add(groupKey(record.petId, "LITTER_CLEANING"), record.occurredAt));

  const completions = new Map<string, boolean>();
  const processedGroups = new Set<string>();
  for (const due of dueRules) {
    const key = groupKey(due.petId, due.kind);
    if (processedGroups.has(key)) continue;
    processedGroups.add(key);
    const sameKindRules = allRules.filter((rule) => groupKey(rule.petId, rule.kind) === key);
    const evaluated = evaluateRuleCompletions(
      sameKindRules,
      times.get(key) ?? [],
      targetCareDate,
      careDayStartMinutes
    );
    evaluated.forEach((completed, id) => completions.set(id, completed));
  }
  return dueRules
    .filter((rule) => completions.get(rule.id) !== true)
    .map<PendingNotificationItem>((rule) => ({ petName: rule.pet.name, label: rule.label }));
}

async function dispatchClaim(dispatch: ClaimedDispatch, now: Date) {
  if (!isWithinNotificationWindow(now, dispatch.scheduledAt)) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }

  // Push送信直前に利用状態、所属、Household、Pet、species、enabled、care-dayをすべて取り直す。
  const membership = await prisma.householdMember.findUnique({
    where: {
      householdId_userId: { householdId: dispatch.householdId, userId: dispatch.userId }
    },
    select: {
      user: { select: { accessStatus: true } },
      household: { select: { isDemo: true, careDayStartMinutes: true } }
    }
  });
  if (!membership || membership.user.accessStatus !== "ACTIVE" || membership.household.isDemo) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }
  const latestTargetDate = notificationTargetCareDate(
    now,
    membership.household.careDayStartMinutes
  );
  if (toDateInputValue(latestTargetDate) !== toDateInputValue(dispatch.targetCareDate)) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }

  const rules = await prisma.petNotificationRule.findMany({
    where: {
      userId: dispatch.userId,
      householdId: dispatch.householdId,
      enabled: true,
      pet: { householdId: dispatch.householdId, isActive: true }
    },
    select: {
      id: true,
      petId: true,
      kind: true,
      label: true,
      deadlineMinutes: true,
      notifyBeforeMinutes: true,
      pet: { select: { name: true, species: true } }
    }
  });
  const targetCareDate = toDateInputValue(dispatch.targetCareDate);
  const dueRules = rules.filter((rule) => {
    if (!isNotificationKindAllowed(rule.pet.species, rule.kind)) return false;
    if (!isNotificationScheduleWithinCareDay(
      membership.household.careDayStartMinutes,
      rule.deadlineMinutes,
      rule.notifyBeforeMinutes
    )) return false;
    return notificationScheduledDateTime(
      targetCareDate,
      membership.household.careDayStartMinutes,
      rule.deadlineMinutes,
      rule.notifyBeforeMinutes
    ).getTime() === dispatch.scheduledAt.getTime();
  });
  if (dueRules.length === 0) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }

  const pendingItems = await pendingItemsForDispatch(
    dispatch,
    membership.household.careDayStartMinutes,
    dueRules
  );
  if (pendingItems.length === 0) {
    await finishDispatch(dispatch, "SKIPPED", now);
    return { status: "skipped" as const, invalid: 0, temporary: 0 };
  }

  const [setting, subscriptions, delivered] = await Promise.all([
    prisma.appSetting.findUnique({
      where: { userId_householdId: { userId: dispatch.userId, householdId: dispatch.householdId } },
      select: { careNotificationCompactBody: true }
    }),
    prisma.webPushSubscription.findMany({
      where: { userId: dispatch.userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true }
    }),
    prisma.careNotificationDelivery.findMany({
      where: { dispatchId: dispatch.id },
      select: { subscriptionId: true }
    })
  ]);
  const deliveredIds = new Set(delivered.map((entry) => entry.subscriptionId));
  const pendingSubscriptions = subscriptions.filter((entry) => !deliveredIds.has(entry.id));
  if (pendingSubscriptions.length === 0) {
    await finishDispatch(dispatch, deliveredIds.size > 0 ? "SENT" : "SKIPPED", now);
    return { status: deliveredIds.size > 0 ? "sent" as const : "skipped" as const, invalid: 0, temporary: 0 };
  }

  const body = buildPetCareNotificationBody(
    pendingItems,
    setting?.careNotificationCompactBody === true
  );
  let successCount = 0;
  let invalidCount = 0;
  let temporaryCount = 0;
  for (const subscription of pendingSubscriptions) {
    const stillClaimed = await prisma.careNotificationDispatch.count({
      where: { id: dispatch.id, claimToken: dispatch.claimToken, status: "CLAIMED" }
    });
    if (stillClaimed !== 1) break;
    try {
      await sendCareWebPush(subscription, { title: NOTIFICATION_TITLE, body });
      successCount += 1;
      await prisma.$transaction([
        prisma.careNotificationDelivery.createMany({
          data: { dispatchId: dispatch.id, subscriptionId: subscription.id, sentAt: now },
          skipDuplicates: true
        }),
        prisma.webPushSubscription.updateMany({
          where: { id: subscription.id, userId: dispatch.userId },
          data: { lastSuccessAt: now }
        })
      ]);
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

  if (temporaryCount > 0 && dispatch.attemptCount < NOTIFICATION_MAX_ATTEMPTS) {
    await finishDispatch(dispatch, "RETRYABLE", now);
    return { status: "retryable" as const, invalid: invalidCount, temporary: temporaryCount };
  }
  if (successCount > 0 || deliveredIds.size > 0) {
    await finishDispatch(dispatch, "SENT", now);
    return { status: "sent" as const, invalid: invalidCount, temporary: temporaryCount };
  }
  await finishDispatch(dispatch, "SKIPPED", now);
  return { status: "skipped" as const, invalid: invalidCount, temporary: temporaryCount };
}

/** DB claim・短期lease・端末別成功履歴を使って、期限到来ルールを冪等に配信する。 */
export async function dispatchCareNotifications(now = new Date()) {
  configureWebPush();
  const summary = createSummary();
  const pendingDispatches = await prisma.careNotificationDispatch.findMany({
    where: { status: { in: ["CLAIMED", "RETRYABLE"] } },
    select: {
      id: true,
      targetCareDate: true,
      scheduledAt: true,
      status: true,
      attemptCount: true,
      leaseExpiresAt: true,
      nextAttemptAt: true,
      household: { select: { isDemo: true, careDayStartMinutes: true } }
    }
  });
  for (const pending of pendingDispatches) {
    const currentTarget = notificationTargetCareDate(now, pending.household.careDayStartMinutes);
    const stale =
      pending.household.isDemo ||
      toDateInputValue(currentTarget) !== toDateInputValue(pending.targetCareDate) ||
      (!isWithinNotificationWindow(now, pending.scheduledAt) &&
        (pending.status === "RETRYABLE" || pending.leaseExpiresAt <= now));
    if (!stale) continue;
    await prisma.careNotificationDispatch.updateMany({
      where: { id: pending.id, status: { in: ["CLAIMED", "RETRYABLE"] } },
      data: { status: "SKIPPED", nextAttemptAt: null, leaseExpiresAt: now }
    });
  }

  const rules = await prisma.petNotificationRule.findMany({
    where: {
      enabled: true,
      user: { accessStatus: "ACTIVE" },
      household: { isDemo: false },
      pet: { isActive: true }
    },
    select: {
      userId: true,
      householdId: true,
      deadlineMinutes: true,
      notifyBeforeMinutes: true,
      household: { select: { careDayStartMinutes: true } }
    }
  });
  summary.ruleCount = rules.length;
  const candidates = new Map<string, { userId: string; householdId: string; targetCareDate: Date; scheduledAt: Date }>();
  for (const rule of rules) {
    const start = rule.household.careDayStartMinutes;
    if (!isNotificationScheduleWithinCareDay(start, rule.deadlineMinutes, rule.notifyBeforeMinutes)) continue;
    const targetCareDate = notificationTargetCareDate(now, start);
    const scheduledAt = notificationScheduledDateTime(
      toDateInputValue(targetCareDate),
      start,
      rule.deadlineMinutes,
      rule.notifyBeforeMinutes
    );
    if (!isWithinNotificationWindow(now, scheduledAt)) continue;
    const key = `${rule.userId}:${rule.householdId}:${targetCareDate.toISOString()}:${scheduledAt.toISOString()}`;
    candidates.set(key, { userId: rule.userId, householdId: rule.householdId, targetCareDate, scheduledAt });
  }
  summary.candidateCount = candidates.size;
  const claims: ClaimedDispatch[] = [];
  for (const candidate of candidates.values()) {
    const claim = await reserveNewDispatch(
      candidate.userId,
      candidate.householdId,
      candidate.targetCareDate,
      candidate.scheduledAt,
      now
    );
    if (claim) claims.push(claim);
  }

  for (const pending of pendingDispatches) {
    const targetMatches = toDateInputValue(notificationTargetCareDate(
      now,
      pending.household.careDayStartMinutes
    )) === toDateInputValue(pending.targetCareDate);
    const ready = pending.status === "RETRYABLE"
      ? pending.nextAttemptAt !== null && pending.nextAttemptAt <= now
      : pending.leaseExpiresAt <= now;
    if (
      pending.household.isDemo ||
      pending.attemptCount >= NOTIFICATION_MAX_ATTEMPTS ||
      !targetMatches ||
      !ready ||
      !isWithinNotificationWindow(now, pending.scheduledAt)
    ) continue;
    const claim = await reclaimDispatch(pending.id, now);
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
    message: "Petお世話通知の判定と配信が完了しました。",
    operation: "careNotifications.dispatch",
    context: summary
  });
  return summary;
}
