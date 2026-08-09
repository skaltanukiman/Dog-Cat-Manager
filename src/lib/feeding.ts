import type { Prisma } from "@prisma/client";

import { getCareDayDateInputJst, getCareDayRecordDate } from "@/lib/care-day";
import { toDateInputValue } from "@/lib/date";

export type FeedingState = "marked" | "unmarked";

type FeedingRecordForToday = {
  id: string;
  hamsterId: string;
  recordDate: Date;
  fedAt: Date;
};

export function getTodayFeedingRecordDate(now = new Date(), careDayStartMinutes = 0) {
  return getCareDayRecordDate(now, careDayStartMinutes);
}

export function todayFeedingRecordsByHamster<T extends { hamsterId: string; recordDate: Date }>(
  records: T[],
  now = new Date(),
  careDayStartMinutes = 0
) {
  const today = getCareDayDateInputJst(now, careDayStartMinutes);
  const recordsByHamster = new Map<string, T>();

  for (const record of records) {
    if (toDateInputValue(record.recordDate) === today && !recordsByHamster.has(record.hamsterId)) {
      recordsByHamster.set(record.hamsterId, record);
    }
  }

  return recordsByHamster;
}

/**
 * transaction内で、現在のお世話日に対する給餌済み状態を冪等に設定する。
 *
 * 同一個体・お世話日は1件だけとし、`changed`はDBに実変更があった場合だけ`true`になる。
 * `recordDate`はtimestampではなく日付専用の`Date`である。
 *
 * @throws marked後のレコードを取得できず、更新結果を確定できない場合
 */
export async function setTodayFeedingState(
  tx: Pick<Prisma.TransactionClient, "feedingRecord">,
  {
    hamsterId,
    createdByUserId,
    state,
    now = new Date(),
    careDayStartMinutes = 0
  }: {
    hamsterId: string;
    createdByUserId: string | null;
    state: FeedingState;
    now?: Date;
    careDayStartMinutes?: number;
  }
): Promise<{ changed: boolean; record: FeedingRecordForToday | null; recordDate: Date }> {
  const recordDate = getTodayFeedingRecordDate(now, careDayStartMinutes);

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

    return { changed: created.count === 1, record, recordDate };
  }

  const deleted = await tx.feedingRecord.deleteMany({
    where: {
      hamsterId,
      recordDate
    }
  });

  return { changed: deleted.count > 0, record: null, recordDate };
}
