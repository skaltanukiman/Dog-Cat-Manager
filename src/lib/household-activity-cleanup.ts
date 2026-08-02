import type { Prisma } from "@prisma/client";

export const HOUSEHOLD_ACTIVITY_RETENTION_DAYS_ENV = "HOUSEHOLD_ACTIVITY_RETENTION_DAYS";

const DAY_MS = 24 * 60 * 60 * 1000;

type CleanupWhere = Prisma.HouseholdActivityWhereInput;

export type HouseholdActivityCleanupClient = {
  count(args: { where: CleanupWhere }): Promise<number>;
  deleteMany(args: { where: CleanupWhere }): Promise<{ count: number }>;
};

export class HouseholdActivityRetentionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HouseholdActivityRetentionConfigError";
  }
}

function assertPositiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new HouseholdActivityRetentionConfigError(
      `${HOUSEHOLD_ACTIVITY_RETENTION_DAYS_ENV} must be a positive integer.`
    );
  }
}

export function getHouseholdActivityRetentionDays(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  const rawValue = env[HOUSEHOLD_ACTIVITY_RETENTION_DAYS_ENV];

  if (rawValue === undefined) {
    throw new HouseholdActivityRetentionConfigError(
      `${HOUSEHOLD_ACTIVITY_RETENTION_DAYS_ENV} is not set.`
    );
  }

  const normalizedValue = rawValue.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new HouseholdActivityRetentionConfigError(
      `${HOUSEHOLD_ACTIVITY_RETENTION_DAYS_ENV} must be a positive integer.`
    );
  }

  const retentionDays = Number(normalizedValue);
  assertPositiveInteger(retentionDays);
  return retentionDays;
}

export function calculateHouseholdActivityCutoffDate(now: Date, retentionDays: number) {
  assertPositiveInteger(retentionDays);
  const cutoffDate = new Date(now.getTime() - retentionDays * DAY_MS);

  if (Number.isNaN(now.getTime()) || Number.isNaN(cutoffDate.getTime())) {
    throw new RangeError("A valid cleanup reference date and retention period are required.");
  }

  return cutoffDate;
}

export function householdActivityCleanupWhere(cutoffDate: Date): CleanupWhere {
  return {
    createdAt: {
      // 保持期間ちょうどの行は残し、基準より古い履歴だけを削除する。
      lt: cutoffDate
    }
  };
}

export async function cleanupHouseholdActivities(
  client: HouseholdActivityCleanupClient,
  retentionDays: number,
  now = new Date(),
  options: { dryRun?: boolean } = {}
) {
  const cutoffDate = calculateHouseholdActivityCutoffDate(now, retentionDays);
  const where = householdActivityCleanupWhere(cutoffDate);
  const targetCount = await client.count({ where });

  if (options.dryRun) {
    return { cutoffDate, targetCount, deletedCount: 0 };
  }

  const { count: deletedCount } = await client.deleteMany({ where });
  return { cutoffDate, targetCount, deletedCount };
}
