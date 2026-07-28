import type { Prisma } from "@prisma/client";

import { REALTIME_ACTOR_FIELD } from "@/lib/realtime-constants";
import {
  ACTOR_NAME_FALLBACK,
  createHouseholdActivity,
  type HouseholdActivityCreateInput
} from "@/lib/household-activity";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";

export type HouseholdChangeSource =
  | "hamster"
  | "cleaning"
  | "feeding"
  | "weight"
  | "settings"
  | "household"
  | "member"
  | "profile"
  | "record";

export type HouseholdChangeEvent = {
  id: number;
  householdId: string;
  source: HouseholdChangeSource;
  actorClientId: string | null;
  actorUserId: string | null;
  revision: string;
  createdAt: string;
};

type HouseholdChangeListener = (event: HouseholdChangeEvent) => void;

export type CommittedHouseholdChange = Omit<HouseholdChangeEvent, "createdAt" | "id">;

export type TransactionExecutor = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

type RealtimeBus = {
  nextId: number;
  listeners: Set<HouseholdChangeListener>;
};

type RealtimeGlobal = typeof globalThis & {
  __hamsterRealtimeBus?: RealtimeBus;
};

const REALTIME_ACTOR_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

function getRealtimeBus() {
  const globalForRealtime = globalThis as RealtimeGlobal;

  // SSE配信はプロセス内バスなので、再生成を避けて同一プロセスの購読者を共有する。
  if (!globalForRealtime.__hamsterRealtimeBus) {
    globalForRealtime.__hamsterRealtimeBus = {
      nextId: 1,
      listeners: new Set()
    };
  }

  return globalForRealtime.__hamsterRealtimeBus;
}

export function subscribeHouseholdChanges(listener: HouseholdChangeListener) {
  const bus = getRealtimeBus();
  bus.listeners.add(listener);

  return () => {
    bus.listeners.delete(listener);
  };
}

export function publishHouseholdChange({
  householdId,
  source,
  actorClientId,
  actorUserId,
  revision
}: {
  householdId: string;
  source: HouseholdChangeSource;
  actorClientId?: string | null;
  actorUserId?: string | null;
  revision: string;
}) {
  const bus = getRealtimeBus();
  const event: HouseholdChangeEvent = {
    id: bus.nextId,
    householdId,
    source,
    actorClientId: actorClientId ?? null,
    actorUserId: actorUserId ?? null,
    revision,
    createdAt: new Date().toISOString()
  };

  bus.nextId += 1;

  for (const listener of bus.listeners) {
    listener(event);
  }
}

export function getRealtimeActorId(formData: FormData | undefined) {
  const actorId = formData?.get(REALTIME_ACTOR_FIELD);
  return typeof actorId === "string" && REALTIME_ACTOR_ID_PATTERN.test(actorId) ? actorId : null;
}

const executeTransaction: TransactionExecutor = (operation) => prisma.$transaction(operation);

export async function updateHouseholdRevision(
  tx: Prisma.TransactionClient,
  householdId: string,
  source: HouseholdChangeSource,
  actorClientId?: string | null,
  actorUserId?: string | null
): Promise<CommittedHouseholdChange> {
  const household = await tx.household.update({
    where: { id: householdId },
    data: {
      realtimeRevision: { increment: 1 },
      realtimeActorClientId: actorClientId ?? null,
      realtimeActorUserId: actorUserId ?? null
    },
    select: { realtimeRevision: true }
  });

  return {
    householdId,
    source,
    actorClientId: actorClientId ?? null,
    actorUserId: actorUserId ?? null,
    revision: household.realtimeRevision.toString()
  };
}

export async function updateHouseholdRevisions(
  tx: Prisma.TransactionClient,
  householdIds: string[],
  source: HouseholdChangeSource,
  actorClientId?: string | null,
  actorUserId?: string | null
) {
  const uniqueHouseholdIds = [...new Set(householdIds)];
  return Promise.all(
    uniqueHouseholdIds.map((householdId) =>
      updateHouseholdRevision(tx, householdId, source, actorClientId, actorUserId)
    )
  );
}

export async function commitHouseholdMutation<T>(
  {
    householdId,
    source,
    actorClientId,
    actorUserId,
    actorNameSnapshot,
    activity,
    mutate
  }: {
    householdId: string;
    source: HouseholdChangeSource;
    actorClientId?: string | null;
    actorUserId?: string | null;
    actorNameSnapshot?: string;
    activity?: HouseholdActivityCreateInput | HouseholdActivityCreateInput[] | null | ((result: T) => HouseholdActivityCreateInput | HouseholdActivityCreateInput[] | null);
    mutate: (tx: Prisma.TransactionClient) => Promise<T>;
  },
  transactionExecutor: TransactionExecutor = executeTransaction
) {
  return transactionExecutor(async (tx) => {
    // 業務データとrevisionを同時commitし、通知だけが先行する状態を作らない。
    const result = await mutate(tx);
    const activityInput = typeof activity === "function" ? activity(result) : activity;
    if (activityInput) {
      for (const item of Array.isArray(activityInput) ? activityInput : [activityInput]) {
        await createHouseholdActivity(tx, {
          ...item,
          householdId,
          actorUserId,
          actorNameSnapshot: actorNameSnapshot || ACTOR_NAME_FALLBACK
        });
      }
    }
    const change = await updateHouseholdRevision(tx, householdId, source, actorClientId, actorUserId);
    return { result, change };
  });
}

export function publishHouseholdChangeSafely(
  change: CommittedHouseholdChange,
  publisher: (change: CommittedHouseholdChange) => void = publishHouseholdChange,
  reportError: typeof logUnexpectedError = logUnexpectedError
) {
  try {
    // commit後のプロセス内通知失敗はDB更新を巻き戻せないため、記録してpoll側の追従に委ねる。
    publisher(change);
    return true;
  } catch (error) {
    reportError(error, {
      operation: "realtime.publishHouseholdChange",
      context: {
        householdId: change.householdId,
        source: change.source,
        revision: change.revision
      }
    });
    return false;
  }
}

export function publishHouseholdChangesSafely(changes: CommittedHouseholdChange[]) {
  for (const change of changes) {
    publishHouseholdChangeSafely(change);
  }
}
