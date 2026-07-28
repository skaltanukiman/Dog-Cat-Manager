import type { Prisma } from "@prisma/client";

import { parseDateInput, todayInputJst, toDateInputValue } from "@/lib/date";

export type WaterReplacementState = "marked" | "unmarked";

type WaterReplacementRecordForToday = {
  id: string;
  hamsterId: string;
  recordDate: Date;
  replacedAt: Date;
};

export function getTodayWaterReplacementRecordDate(now = new Date()) {
  return parseDateInput(todayInputJst(now));
}

export function todayWaterReplacementRecordsByHamster<
  T extends { hamsterId: string; recordDate: Date }
>(records: T[], now = new Date()) {
  const today = todayInputJst(now);
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
    now = new Date()
  }: {
    hamsterId: string;
    createdByUserId: string;
    state: WaterReplacementState;
    now?: Date;
  }
): Promise<{ changed: boolean; record: WaterReplacementRecordForToday | null }> {
  const recordDate = getTodayWaterReplacementRecordDate(now);

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

    return { changed: created.count === 1, record };
  }

  const deleted = await tx.waterReplacementRecord.deleteMany({
    where: {
      hamsterId,
      recordDate
    }
  });

  return { changed: deleted.count > 0, record: null };
}
