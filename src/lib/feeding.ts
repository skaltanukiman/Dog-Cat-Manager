import type { Prisma } from "@prisma/client";

import { parseDateInput, todayInputJst, toDateInputValue } from "@/lib/date";

export type FeedingState = "marked" | "unmarked";

type FeedingRecordForToday = {
  id: string;
  hamsterId: string;
  recordDate: Date;
  fedAt: Date;
};

export function getTodayFeedingRecordDate(now = new Date()) {
  return parseDateInput(todayInputJst(now));
}

export function todayFeedingRecordsByHamster<T extends { hamsterId: string; recordDate: Date }>(
  records: T[],
  now = new Date()
) {
  const today = todayInputJst(now);
  const recordsByHamster = new Map<string, T>();

  for (const record of records) {
    if (toDateInputValue(record.recordDate) === today && !recordsByHamster.has(record.hamsterId)) {
      recordsByHamster.set(record.hamsterId, record);
    }
  }

  return recordsByHamster;
}

export async function setTodayFeedingState(
  tx: Pick<Prisma.TransactionClient, "feedingRecord">,
  {
    hamsterId,
    createdByUserId,
    state,
    now = new Date()
  }: {
    hamsterId: string;
    createdByUserId: string;
    state: FeedingState;
    now?: Date;
  }
): Promise<{ changed: boolean; record: FeedingRecordForToday | null }> {
  const recordDate = getTodayFeedingRecordDate(now);

  if (state === "marked") {
    // 同時操作でも一意制約違反でtransaction全体を失敗させず、最初の1件だけを作成する。
    const created = await tx.feedingRecord.createMany({
      data: {
        hamsterId,
        recordDate,
        fedAt: now,
        createdByUserId
      },
      skipDuplicates: true
    });
    const record = await tx.feedingRecord.findUnique({
      where: {
        hamsterId_recordDate: {
          hamsterId,
          recordDate
        }
      },
      select: {
        id: true,
        hamsterId: true,
        recordDate: true,
        fedAt: true
      }
    });

    if (!record) {
      throw new Error("Feeding record was not found after marking.");
    }

    return { changed: created.count === 1, record };
  }

  const deleted = await tx.feedingRecord.deleteMany({
    where: {
      hamsterId,
      recordDate
    }
  });

  return { changed: deleted.count > 0, record: null };
}
