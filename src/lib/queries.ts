import type { Prisma } from "@prisma/client";

import { canManageCareDaySettings } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { normalizeCareNotificationSettings } from "@/lib/care-notifications";
import { getCareDayRecordDate, normalizeCareDayStartMinutes } from "@/lib/care-day";
import { normalizeCleaningMobileDefaultDateFilter } from "@/lib/cleaning-settings";
import {
  normalizeDashboardBoardCount,
  normalizeHamsterSelectorMode,
  orderHamstersForSelector,
  pickDashboardPets
} from "@/lib/dashboard-settings";
import { monthDateRange, parseDateInput, toDateInputValue } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { normalizeRecordScope } from "@/lib/records";
import { getAppliedWeightChartRange } from "@/lib/weight-chart-filter";

export const WEIGHT_HISTORY_PAGE_SIZE = 20;

function summarizePetCareRecords<T extends { petId: string }>(records: T[]) {
  const summaries = new Map<string, { count: number; latest: T }>();

  // 各queryはイベント時刻の降順なので、Petごとの先頭行を最新記録として保持する。
  for (const record of records) {
    const current = summaries.get(record.petId);
    if (current) {
      current.count += 1;
    } else {
      summaries.set(record.petId, { count: 1, latest: record });
    }
  }

  return summaries;
}

export async function getDashboardData() {
  const context = await getRequiredHouseholdContext();
  const [pets, setting] = await Promise.all([
    prisma.pet.findMany({
      where: { householdId: context.household.id },
      // fallbackは管理中を優先し、その中では登録日時とIDで決定的にする。
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      include: {
        weightRecords: {
          orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: { id: true, recordDate: true, weightKg: true }
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
        dashboardPets: {
          orderBy: { sortOrder: "asc" }
        }
      }
    })
  ]);
  const boardCount = normalizeDashboardBoardCount(setting?.dashboardBoardCount);
  const selectedIds = setting?.dashboardPets.map((entry) => entry.petId) ?? [];
  const dashboardPets = pickDashboardPets(pets, boardCount, selectedIds);
  const dashboardPetIds = dashboardPets.map((pet) => pet.id);
  const now = new Date();
  const careDayStartMinutes = normalizeCareDayStartMinutes(context.household.careDayStartMinutes);
  const careDayRecordDate = getCareDayRecordDate(now, careDayStartMinutes);

  // イベント種別ごとに表示対象Petを一括取得し、カード単位のN+1を避ける。
  const [feedingRecords, waterRecords, walkRecords, litterRecords] = await Promise.all([
    prisma.petFeedingRecord.findMany({
      where: {
        petId: { in: dashboardPetIds },
        recordDate: careDayRecordDate,
        pet: { householdId: context.household.id }
      },
      orderBy: [{ fedAt: "desc" }, { id: "desc" }],
      select: { id: true, petId: true, fedAt: true }
    }),
    prisma.petWaterRecord.findMany({
      where: {
        petId: { in: dashboardPetIds },
        recordDate: careDayRecordDate,
        pet: { householdId: context.household.id }
      },
      orderBy: [{ caredAt: "desc" }, { id: "desc" }],
      select: { id: true, petId: true, caredAt: true, action: true }
    }),
    prisma.petWalkRecord.findMany({
      where: {
        petId: { in: dashboardPetIds },
        recordDate: careDayRecordDate,
        pet: { householdId: context.household.id, species: "DOG" }
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true, petId: true, startedAt: true, durationMinutes: true }
    }),
    prisma.petLitterRecord.findMany({
      where: {
        petId: { in: dashboardPetIds },
        recordDate: careDayRecordDate,
        pet: { householdId: context.household.id, species: "CAT" }
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { id: true, petId: true, occurredAt: true, action: true }
    })
  ]);
  const feedingByPet = summarizePetCareRecords(feedingRecords);
  const waterByPet = summarizePetCareRecords(waterRecords);
  const walkByPet = summarizePetCareRecords(walkRecords);
  const litterByPet = summarizePetCareRecords(litterRecords);

  return {
    pets: dashboardPets.map((pet) => ({
      ...pet,
      todayFeeding: feedingByPet.get(pet.id) ?? null,
      todayWater: waterByPet.get(pet.id) ?? null,
      todayWalk: pet.species === "DOG" ? walkByPet.get(pet.id) ?? null : null,
      todayLitter: pet.species === "CAT" ? litterByPet.get(pet.id) ?? null : null
    })),
    boardCount,
    totalPets: pets.length
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
      select: {
        dashboardBoardCount: true,
        dashboardHamsters: {
          orderBy: { sortOrder: "asc" },
          select: { hamsterId: true }
        }
      }
    })
  ]);

  return orderHamstersForSelector(
    hamsters,
    setting?.dashboardBoardCount,
    setting?.dashboardHamsters.map((entry) => entry.hamsterId) ?? [],
    true
  );
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
  const [allHamsters, setting] = await Promise.all([
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
      select: {
        hamsterSelectorMode: true,
        cleaningMobileDefaultDateFilter: true,
        dashboardBoardCount: true,
        dashboardHamsters: {
          orderBy: { sortOrder: "asc" },
          select: { hamsterId: true }
        }
      }
    })
  ]);
  const hamsterSelectorMode = normalizeHamsterSelectorMode(setting?.hamsterSelectorMode);
  const cleaningMobileDefaultDateFilter = normalizeCleaningMobileDefaultDateFilter(
    setting?.cleaningMobileDefaultDateFilter
  );
  const hamsters = orderHamstersForSelector(
    allHamsters,
    setting?.dashboardBoardCount,
    setting?.dashboardHamsters.map((entry) => entry.hamsterId) ?? [],
    includeInactive
  );
  // 初期表示では自動選択せず、URLで明示されたハムスターだけを表示対象にする。
  const selectedHamster = pickSelectedHamster(hamsters, selectedHamsterId);

  if (!selectedHamster) {
    return {
      hamsters,
      totalHamsters: allHamsters.length,
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
    totalHamsters: allHamsters.length,
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
  const [allHamsters, setting] = await Promise.all([
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
      select: {
        hamsterSelectorMode: true,
        dashboardBoardCount: true,
        dashboardHamsters: {
          orderBy: { sortOrder: "asc" },
          select: { hamsterId: true }
        }
      }
    })
  ]);
  const hamsterSelectorMode = normalizeHamsterSelectorMode(setting?.hamsterSelectorMode);
  const hamsters = orderHamstersForSelector(
    allHamsters,
    setting?.dashboardBoardCount,
    setting?.dashboardHamsters.map((entry) => entry.hamsterId) ?? [],
    includeInactive
  );
  // 初期表示では自動選択せず、URLで明示されたハムスターだけを表示対象にする。
  const selectedHamster = pickSelectedHamster(hamsters, selectedHamsterId);

  if (!selectedHamster) {
    return {
      hamsters,
      totalHamsters: allHamsters.length,
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
    totalHamsters: allHamsters.length,
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
  const [pets, setting] = await Promise.all([
    prisma.pet.findMany({
      where: { householdId: context.household.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        species: true,
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
        dashboardPets: {
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
  const selectedIds = setting?.dashboardPets.map((entry) => entry.petId) ?? [];
  // 設定画面の初期表示でも、ダッシュボードと同じ補完ルールで選択状態を作る。
  const selectedPetIds = pickDashboardPets(pets, boardCount, selectedIds).map((pet) => pet.id);
  const careNotificationSettings = normalizeCareNotificationSettings(setting);

  return {
    user: context.user,
    boardCount,
    hamsterSelectorMode,
    recordTimelineDefaultScope,
    cleaningMobileDefaultDateFilter,
    careNotificationSettings,
    careDayStartMinutes: normalizeCareDayStartMinutes(context.household.careDayStartMinutes),
    canManageCareDaySettings: canManageCareDaySettings(context.membership.role),
    pets,
    selectedPetIds
  };
}
