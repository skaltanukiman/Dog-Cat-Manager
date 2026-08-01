import type { Prisma } from "@prisma/client";

import { getCareDayDateInputJst, getCareDayRecordDate } from "@/lib/care-day";
import { toDateInputValue } from "@/lib/date";

export type WaterReplacementState = "marked" | "unmarked";

type WaterReplacementRecordForToday = {
  id: string;
  hamsterId: string;
  recordDate: Date;
  replacedAt: Date;
};

export function getTodayWaterReplacementRecordDate(now = new Date(), careDayStartMinutes = 0) {
  return getCareDayRecordDate(now, careDayStartMinutes);
}

export function todayWaterReplacementRecordsByHamster<
  T extends { hamsterId: string; recordDate: Date }
>(records: T[], now = new Date(), careDayStartMinutes = 0) {
  const today = getCareDayDateInputJst(now, careDayStartMinutes);
  const recordsByHamster = new Map<string, T>();

  for (const record of records) {
    if (toDateInputValue(record.recordDate) === today && !recordsByHamster.has(record.hamsterId)) {
      recordsByHamster.set(record.hamsterId, record);
    }
  }

  return recordsByHamster;
}

export async function setTodayWaterReplacementState(
  tx: Pick<Prisma.TransactionClient, "waterReplacementRecord">,
  {
    hamsterId,
    createdByUserId,
    state,
    now = new Date(),
    careDayStartMinutes = 0
  }: {
    hamsterId: string;
    createdByUserId: string;
    state: WaterReplacementState;
    now?: Date;
    careDayStartMinutes?: number;
  }
): Promise<{ changed: boolean; record: WaterReplacementRecordForToday | null; recordDate: Date }> {
  const recordDate = getTodayWaterReplacementRecordDate(now, careDayStartMinutes);

  if (state === "marked") {
    const created = await tx.waterReplacementRecord.createMany({
      data: {
        hamsterId,
        recordDate,
        replacedAt: now,
        createdByUserId
      },
      skipDuplicates: true
    });
    const record = await tx.waterReplacementRecord.findUnique({
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
        replacedAt: true
      }
    });

    if (!record) {
      throw new Error("Water replacement record was not found after marking.");
    }

    return { changed: created.count === 1, record, recordDate };
  }

  const deleted = await tx.waterReplacementRecord.deleteMany({
    where: {
      hamsterId,
      recordDate
    }
  });

  return { changed: deleted.count > 0, record: null, recordDate };
}
