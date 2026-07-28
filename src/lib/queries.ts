import type { Prisma } from "@prisma/client";

import { canEditHouseholdSharedData } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { normalizeCleaningMobileDefaultDateFilter } from "@/lib/cleaning-settings";
import {
  normalizeDashboardBoardCount,
  normalizeHamsterSelectorMode,
  pickDashboardHamsters
} from "@/lib/dashboard-settings";
import { monthDateRange, parseDateInput, toDateInputValue } from "@/lib/date";
import { getTodayFeedingRecordDate, todayFeedingRecordsByHamster } from "@/lib/feeding";
import { prisma } from "@/lib/prisma";
import { normalizeRecordScope } from "@/lib/records";
import { getAppliedWeightChartRange } from "@/lib/weight-chart-filter";

export const WEIGHT_HISTORY_PAGE_SIZE = 20;

function latestRecordByHamster<T extends { hamsterId: string }>(records: T[]) {
  const recordsByHamster = new Map<string, T>();

  // 呼び出し側で新しい順に取得しているため、最初に見つかったレコードをそのハムスターの最新扱いにする。
  for (const record of records) {
    if (!recordsByHamster.has(record.hamsterId)) {
      recordsByHamster.set(record.hamsterId, record);
    }
  }

  return recordsByHamster;
}

export async function getDashboardData() {
  const context = await getRequiredHouseholdContext();
  const [hamsters, setting] = await Promise.all([
    // 一覧カードで使う最新体重だけを取得し、不要な体重履歴全体は読み込まない。
    prisma.hamster.findMany({
      where: { householdId: context.household.id },
      orderBy: { createdAt: "asc" },
      include: {
        weightRecords: {
          orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
          take: 1
        }
      }
    }),
    prisma.appSetting.findUnique({
      where: {
        userId_householdId: {
          userId: context.user.id,
          householdId: context.household.id
        }
      },
      include: {
        dashboardHamsters: {
          orderBy: { sortOrder: "asc" }
        }
      }
    })
  ]);
  const boardCount = normalizeDashboardBoardCount(setting?.dashboardBoardCount);
  const selectedIds = setting?.dashboardHamsters.map((entry) => entry.hamsterId) ?? [];
  const dashboardHamsters = pickDashboardHamsters(hamsters, boardCount, selectedIds);
  const dashboardHamsterIds = dashboardHamsters.map((hamster) => hamster.id);
  const now = new Date();

  // 本日の食事と、主要な掃除タスクごとの最終実施日だけをダッシュボード用に取得する。
  const [feedingRecords, toiletCleaningRecords, bathCleaningRecords, flooringAllCleaningRecords, houseCleaningRecords] = await Promise.all([
    // 表示対象IDをまとめて指定し、本日の食事記録を1クエリで取得する。
    prisma.feedingRecord.findMany({
      where: {
        hamsterId: { in: dashboardHamsterIds },
        recordDate: getTodayFeedingRecordDate(now)
      },
      select: { id: true, hamsterId: true, recordDate: true, fedAt: true }
    }),
    prisma.cleaningRecord.findMany({
      where: {
        hamsterId: { in: dashboardHamsterIds },
        toiletCleaned: true
      },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.cleaningRecord.findMany({
      where: {
        hamsterId: { in: dashboardHamsterIds },
        bathCleaned: true
      },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.cleaningRecord.findMany({
      where: {
        hamsterId: { in: dashboardHamsterIds },
        flooringAllCleaned: true
      },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.cleaningRecord.findMany({
      where: {
        hamsterId: { in: dashboardHamsterIds },
        houseCleaned: true
      },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }]
    })
  ]);
  const feedingByHamster = todayFeedingRecordsByHamster(feedingRecords, now);
  const toiletCleaningByHamster = latestRecordByHamster(toiletCleaningRecords);
  const bathCleaningByHamster = latestRecordByHamster(bathCleaningRecords);
  const flooringAllCleaningByHamster = latestRecordByHamster(flooringAllCleaningRecords);
  const houseCleaningByHamster = latestRecordByHamster(houseCleaningRecords);

  return {
    hamsters: dashboardHamsters.map((hamster) => ({
      ...hamster,
      todayFeeding: feedingByHamster.get(hamster.id) ?? null,
      latestToiletCleaning: toiletCleaningByHamster.get(hamster.id) ?? null,
      latestBathCleaning: bathCleaningByHamster.get(hamster.id) ?? null,
      latestFlooringAllCleaning: flooringAllCleaningByHamster.get(hamster.id) ?? null,
      latestHouseCleaning: houseCleaningByHamster.get(hamster.id) ?? null
    })),
    canEdit: canEditHouseholdSharedData(context.membership.role),
    boardCount,
    totalHamsters: hamsters.length
  };
}

export async function getHamsterManagementData() {
  const context = await getRequiredHouseholdContext();

  return prisma.hamster.findMany({
    where: { householdId: context.household.id },
    orderBy: { createdAt: "asc" },
    include: {
      _count: {
        select: {
          cleaningRecords: true,
          weightRecords: true
        }
      }
    }
  });
}

export async function getHamsterOptions() {
  const context = await getRequiredHouseholdContext();

  return prisma.hamster.findMany({
    where: { householdId: context.household.id },
    orderBy: { createdAt: "asc" }
  });
}

export async function getHamsterSelectorMode() {
  const context = await getRequiredHouseholdContext();
  const setting = await prisma.appSetting.findUnique({
    where: {
      userId_householdId: {
        userId: context.user.id,
        householdId: context.household.id
      }
    },
    select: { hamsterSelectorMode: true }
  });

  return normalizeHamsterSelectorMode(setting?.hamsterSelectorMode);
}

function getSelectableHamsters<T extends { isActive: boolean }>(hamsters: T[], includeInactive: boolean) {
  return includeInactive ? hamsters : hamsters.filter((hamster) => hamster.isActive);
}

function pickSelectedHamster<T extends { id: string; isActive: boolean }>(
  hamsters: T[],
  selectedHamsterId: string | undefined
) {
  if (!selectedHamsterId) {
    return null;
  }

  return hamsters.find((hamster) => hamster.id === selectedHamsterId) ?? null;
}

export async function getCleaningPageData(selectedHamsterId: string | undefined, yearMonth: string, includeInactive: boolean) {
  const context = await getRequiredHouseholdContext();
  const [hamsters, setting] = await Promise.all([
    prisma.hamster.findMany({
      where: { householdId: context.household.id },
      orderBy: { createdAt: "asc" }
    }),
    prisma.appSetting.findUnique({
      where: {
        userId_householdId: {
          userId: context.user.id,
          householdId: context.household.id
        }
      },
      select: { hamsterSelectorMode: true, cleaningMobileDefaultDateFilter: true }
    })
  ]);
  const hamsterSelectorMode = normalizeHamsterSelectorMode(setting?.hamsterSelectorMode);
  const cleaningMobileDefaultDateFilter = normalizeCleaningMobileDefaultDateFilter(
    setting?.cleaningMobileDefaultDateFilter
  );
  const selectableHamsters = getSelectableHamsters(hamsters, includeInactive);
  // 初期表示では自動選択せず、URLで明示されたハムスターだけを表示対象にする。
  const selectedHamster = pickSelectedHamster(selectableHamsters, selectedHamsterId);

  if (!selectedHamster) {
    return {
      hamsters,
      selectedHamster,
      recordsByDate: new Map(),
      hamsterSelectorMode,
      cleaningMobileDefaultDateFilter
    };
  }

  const { start, end } = monthDateRange(yearMonth);
  const records = await prisma.cleaningRecord.findMany({
    where: {
      hamsterId: selectedHamster.id,
      recordDate: {
        gte: start,
        lt: end
      }
    },
    orderBy: { recordDate: "asc" }
  });

  return {
    hamsters,
    selectedHamster,
    hamsterSelectorMode,
    cleaningMobileDefaultDateFilter,
    // 表形式では日付文字列から即座にレコードを引けるよう、DB結果をMapへ変換しておく。
    recordsByDate: new Map(records.map((record) => [toDateInputValue(record.recordDate), record]))
  };
}

type WeightHistoryFilterMode = "all" | "month";
type WeightHistorySortTarget = "registered" | "date" | "weight";
type SortDirection = "asc" | "desc";

function buildWeightRecordWhere(hamsterId: string, filterMode: WeightHistoryFilterMode, selectedMonth: string) {
  const where: Prisma.WeightRecordWhereInput = { hamsterId };

  if (filterMode === "month" && selectedMonth) {
    const { start, end } = monthDateRange(selectedMonth);
    where.recordDate = {
      gte: start,
      lt: end
    };
  }

  return where;
}

function buildWeightRecordOrderBy(sortTarget: WeightHistorySortTarget, sortDirection: SortDirection) {
  const tieBreakDirection = sortDirection;

  // 体重履歴一覧の表示順だけを切り替え、同値のときは安定して並ぶよう補助条件を足す。
  if (sortTarget === "registered") {
    return [{ createdAt: sortDirection }, { recordDate: tieBreakDirection }];
  }

  if (sortTarget === "weight") {
    return [{ weightG: sortDirection }, { recordDate: tieBreakDirection }, { createdAt: tieBreakDirection }];
  }

  return [{ recordDate: sortDirection }, { createdAt: tieBreakDirection }];
}

export async function getWeightPageData({
  selectedHamsterId,
  filterMode,
  month,
  chartFrom,
  chartTo,
  page,
  sortTarget,
  sortDirection,
  includeInactive
}: {
  selectedHamsterId: string | undefined;
  filterMode: WeightHistoryFilterMode;
  month: string | undefined;
  chartFrom: string | undefined;
  chartTo: string | undefined;
  page: number;
  sortTarget: WeightHistorySortTarget;
  sortDirection: SortDirection;
  includeInactive: boolean;
}) {
  const context = await getRequiredHouseholdContext();
  const [hamsters, setting] = await Promise.all([
    prisma.hamster.findMany({
      where: { householdId: context.household.id },
      orderBy: { createdAt: "asc" }
    }),
    prisma.appSetting.findUnique({
      where: {
        userId_householdId: {
          userId: context.user.id,
          householdId: context.household.id
        }
      },
      select: { hamsterSelectorMode: true }
    })
  ]);
  const hamsterSelectorMode = normalizeHamsterSelectorMode(setting?.hamsterSelectorMode);
  const selectableHamsters = getSelectableHamsters(hamsters, includeInactive);
  // 初期表示では自動選択せず、URLで明示されたハムスターだけを表示対象にする。
  const selectedHamster = pickSelectedHamster(selectableHamsters, selectedHamsterId);

  if (!selectedHamster) {
    return {
      hamsters,
      selectedHamster,
      hamsterSelectorMode,
      records: [],
      chartRecords: [],
      monthOptions: [] as string[],
      selectedMonth: "",
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalCount: 0,
        pageSize: WEIGHT_HISTORY_PAGE_SIZE
      }
    };
  }

  // 月候補は体重履歴の実データからDB側で年月だけを重複排除して作る。
  const monthRows = await prisma.$queryRaw<Array<{ yearMonth: string }>>`
    SELECT to_char("recordDate", 'YYYY-MM') AS "yearMonth"
    FROM "weight_records"
    WHERE "hamsterId" = ${selectedHamster.id}
    GROUP BY to_char("recordDate", 'YYYY-MM')
    ORDER BY "yearMonth" DESC
  `;
  const monthOptions = monthRows.map((row) => row.yearMonth);
  const selectedMonth = filterMode === "month" ? month ?? monthOptions[0] ?? "" : "";
  const where = buildWeightRecordWhere(selectedHamster.id, filterMode, selectedMonth);
  const appliedChartRange = getAppliedWeightChartRange(filterMode, chartFrom, chartTo);
  const chartWhere: Prisma.WeightRecordWhereInput = filterMode === "month" ? where : { hamsterId: selectedHamster.id };
  if (appliedChartRange.from || appliedChartRange.to) {
    chartWhere.recordDate = {
      ...(appliedChartRange.from ? { gte: parseDateInput(appliedChartRange.from) } : {}),
      ...(appliedChartRange.to ? { lte: parseDateInput(appliedChartRange.to) } : {})
    };
  }
  const totalCount = await prisma.weightRecord.count({ where });
  const totalPages = Math.max(Math.ceil(totalCount / WEIGHT_HISTORY_PAGE_SIZE), 1);
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const orderBy = buildWeightRecordOrderBy(sortTarget, sortDirection);
  const [records, chartRecords] = await Promise.all([
    prisma.weightRecord.findMany({
      where,
      orderBy,
      skip: (currentPage - 1) * WEIGHT_HISTORY_PAGE_SIZE,
      take: WEIGHT_HISTORY_PAGE_SIZE
    }),
    // グラフはページング中の一覧とは独立して、現在の表示条件に一致する体重推移全体を描画する。
    prisma.weightRecord.findMany({
      where: chartWhere,
      orderBy: [{ recordDate: "asc" }, { createdAt: "asc" }]
    })
  ]);

  return {
    hamsters,
    selectedHamster,
    hamsterSelectorMode,
    records,
    chartRecords,
    monthOptions,
    selectedMonth,
    pagination: {
      currentPage,
      totalPages,
      totalCount,
      pageSize: WEIGHT_HISTORY_PAGE_SIZE
    }
  };
}

export async function getDashboardSettingsPageData() {
  const context = await getRequiredHouseholdContext();
  const [hamsters, setting] = await Promise.all([
    prisma.hamster.findMany({
      where: { householdId: context.household.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        memo: true,
        isActive: true
      }
    }),
    prisma.appSetting.findUnique({
      where: {
        userId_householdId: {
          userId: context.user.id,
          householdId: context.household.id
        }
      },
      include: {
        dashboardHamsters: {
          orderBy: { sortOrder: "asc" }
        }
      }
    })
  ]);
  const boardCount = normalizeDashboardBoardCount(setting?.dashboardBoardCount);
  const hamsterSelectorMode = normalizeHamsterSelectorMode(setting?.hamsterSelectorMode);
  const recordTimelineDefaultScope = normalizeRecordScope(setting?.recordTimelineDefaultScope);
  const cleaningMobileDefaultDateFilter = normalizeCleaningMobileDefaultDateFilter(
    setting?.cleaningMobileDefaultDateFilter
  );
  const selectedIds = setting?.dashboardHamsters.map((entry) => entry.hamsterId) ?? [];
  // 設定画面の初期表示でも、ダッシュボードと同じ補完ルールで選択状態を作る。
  const selectedHamsterIds = pickDashboardHamsters(hamsters, boardCount, selectedIds).map((hamster) => hamster.id);

  return {
    user: context.user,
    boardCount,
    hamsterSelectorMode,
    recordTimelineDefaultScope,
    cleaningMobileDefaultDateFilter,
    hamsters,
    selectedHamsterIds
  };
}
