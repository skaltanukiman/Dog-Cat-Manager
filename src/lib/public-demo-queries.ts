import type { Prisma } from "@prisma/client";

import { monthDateRange, parseDateInput, toDateInputValue } from "@/lib/date";
import { getTodayFeedingRecordDate, todayFeedingRecordsByHamster } from "@/lib/feeding";
import { prisma } from "@/lib/prisma";
import {
  getPublicDemoHamsterImagePath,
  getPublicDemoRecordImagePath,
  PUBLIC_DEMO_SLUG
} from "@/lib/public-demo";
import {
  buildRecordListWhere,
  buildRecordScopeWhere,
  collectRecordTagSuggestions,
  RECORD_PAGE_SIZE,
  resolveRecordScope
} from "@/lib/records";
import type { RecordPageFilters } from "@/lib/record-queries";
import { formatRecordTime } from "@/lib/record-time";
import { getAppliedWeightChartRange } from "@/lib/weight-chart-filter";

export const PUBLIC_DEMO_WEIGHT_HISTORY_PAGE_SIZE = 20;

type PublicDemoHouseholdReader = {
  findFirst(args: {
    where: { isDemo: true; demoSlug: typeof PUBLIC_DEMO_SLUG };
    select: { id: true; name: true };
  }): Promise<{ id: string; name: string } | null>;
};

const publicDemoHouseholdReader: PublicDemoHouseholdReader = {
  findFirst: (args) => prisma.household.findFirst(args)
};

export function getPublicDemoHousehold(reader: PublicDemoHouseholdReader = publicDemoHouseholdReader) {
  return reader.findFirst({
    where: {
      isDemo: true,
      demoSlug: PUBLIC_DEMO_SLUG
    },
    select: {
      id: true,
      name: true
    }
  });
}

function latestRecordByHamster<T extends { hamsterId: string }>(records: T[]) {
  const recordsByHamster = new Map<string, T>();
  for (const record of records) {
    if (!recordsByHamster.has(record.hamsterId)) recordsByHamster.set(record.hamsterId, record);
  }
  return recordsByHamster;
}

export async function getPublicDemoDashboardData() {
  const household = await getPublicDemoHousehold();
  if (!household) return null;

  const hamsters = await prisma.hamster.findMany({
    where: { householdId: household.id },
    orderBy: { createdAt: "asc" },
    include: {
      weightRecords: {
        orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
        take: 1
      }
    }
  });
  const hamsterIds = hamsters.map((hamster) => hamster.id);
  const now = new Date();
  const [feedingRecords, toiletRecords, bathRecords, flooringAllRecords, houseRecords] = await Promise.all([
    prisma.feedingRecord.findMany({
      where: { hamsterId: { in: hamsterIds }, recordDate: getTodayFeedingRecordDate(now) },
      select: { id: true, hamsterId: true, recordDate: true, fedAt: true }
    }),
    prisma.cleaningRecord.findMany({
      where: { hamsterId: { in: hamsterIds }, toiletCleaned: true },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.cleaningRecord.findMany({
      where: { hamsterId: { in: hamsterIds }, bathCleaned: true },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.cleaningRecord.findMany({
      where: { hamsterId: { in: hamsterIds }, flooringAllCleaned: true },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.cleaningRecord.findMany({
      where: { hamsterId: { in: hamsterIds }, houseCleaned: true },
      orderBy: [{ recordDate: "desc" }, { updatedAt: "desc" }]
    })
  ]);
  const feedings = todayFeedingRecordsByHamster(feedingRecords, now);
  const toilets = latestRecordByHamster(toiletRecords);
  const baths = latestRecordByHamster(bathRecords);
  const flooringAll = latestRecordByHamster(flooringAllRecords);
  const houses = latestRecordByHamster(houseRecords);

  return {
    household,
    boardCount: hamsters.length,
    totalHamsters: hamsters.length,
    hamsters: hamsters.map((hamster) => ({
      ...hamster,
      staticImagePath: getPublicDemoHamsterImagePath(hamster.id),
      todayFeeding: feedings.get(hamster.id) ?? null,
      latestToiletCleaning: toilets.get(hamster.id) ?? null,
      latestBathCleaning: baths.get(hamster.id) ?? null,
      latestFlooringAllCleaning: flooringAll.get(hamster.id) ?? null,
      latestHouseCleaning: houses.get(hamster.id) ?? null
    }))
  };
}

export async function getPublicDemoHamsterManagementData() {
  const household = await getPublicDemoHousehold();
  if (!household) return null;

  const hamsters = await prisma.hamster.findMany({
    where: { householdId: household.id },
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

  return {
    household,
    hamsters: hamsters.map((hamster) => ({
      ...hamster,
      staticImagePath: getPublicDemoHamsterImagePath(hamster.id)
    }))
  };
}

function getSelectableHamsters<T extends { isActive: boolean }>(hamsters: T[], includeInactive: boolean) {
  return includeInactive ? hamsters : hamsters.filter((hamster) => hamster.isActive);
}

function pickSelectedHamster<T extends { id: string; isActive: boolean }>(
  hamsters: T[],
  selectedHamsterId: string | undefined
) {
  if (!selectedHamsterId) return hamsters[0] ?? null;
  return hamsters.find((hamster) => hamster.id === selectedHamsterId) ?? null;
}

export async function getPublicDemoCleaningPageData(
  selectedHamsterId: string | undefined,
  yearMonth: string,
  includeInactive: boolean
) {
  const household = await getPublicDemoHousehold();
  if (!household) return null;

  const hamsters = await prisma.hamster.findMany({
    where: { householdId: household.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, isActive: true }
  });
  const selectedHamster = pickSelectedHamster(getSelectableHamsters(hamsters, includeInactive), selectedHamsterId);
  if (!selectedHamster) {
    return { household, hamsters, selectedHamster, recordsByDate: new Map<string, never>() };
  }

  const { start, end } = monthDateRange(yearMonth);
  const records = await prisma.cleaningRecord.findMany({
    where: {
      hamsterId: selectedHamster.id,
      recordDate: { gte: start, lt: end }
    },
    orderBy: { recordDate: "asc" }
  });

  return {
    household,
    hamsters,
    selectedHamster,
    recordsByDate: new Map(records.map((record) => [toDateInputValue(record.recordDate), record]))
  };
}

type WeightFilterMode = "all" | "month";
type WeightSortTarget = "registered" | "date" | "weight";
type SortDirection = "asc" | "desc";

function buildWeightWhere(hamsterId: string, filterMode: WeightFilterMode, selectedMonth: string) {
  const where: Prisma.WeightRecordWhereInput = { hamsterId };
  if (filterMode === "month" && selectedMonth) {
    const { start, end } = monthDateRange(selectedMonth);
    where.recordDate = { gte: start, lt: end };
  }
  return where;
}

function buildWeightOrderBy(sortTarget: WeightSortTarget, sortDirection: SortDirection) {
  if (sortTarget === "registered") {
    return [{ createdAt: sortDirection }, { recordDate: sortDirection }];
  }
  if (sortTarget === "weight") {
    return [{ weightG: sortDirection }, { recordDate: sortDirection }, { createdAt: sortDirection }];
  }
  return [{ recordDate: sortDirection }, { createdAt: sortDirection }];
}

export async function getPublicDemoWeightPageData({
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
  filterMode: WeightFilterMode;
  month: string | undefined;
  chartFrom: string | undefined;
  chartTo: string | undefined;
  page: number;
  sortTarget: WeightSortTarget;
  sortDirection: SortDirection;
  includeInactive: boolean;
}) {
  const household = await getPublicDemoHousehold();
  if (!household) return null;

  const hamsters = await prisma.hamster.findMany({
    where: { householdId: household.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, isActive: true }
  });
  const selectedHamster = pickSelectedHamster(
    getSelectableHamsters(hamsters, includeInactive),
    selectedHamsterId
  );
  const emptyPagination = {
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    pageSize: PUBLIC_DEMO_WEIGHT_HISTORY_PAGE_SIZE
  };
  if (!selectedHamster) {
    return {
      household,
      hamsters,
      selectedHamster,
      records: [],
      chartRecords: [],
      monthOptions: [] as string[],
      selectedMonth: "",
      pagination: emptyPagination
    };
  }

  const allDates = await prisma.weightRecord.findMany({
    where: { hamsterId: selectedHamster.id },
    orderBy: { recordDate: "desc" },
    select: { recordDate: true }
  });
  const monthOptions = [...new Set(allDates.map((record) => toDateInputValue(record.recordDate).slice(0, 7)))];
  const selectedMonth = filterMode === "month" ? month ?? monthOptions[0] ?? "" : "";
  const where = buildWeightWhere(selectedHamster.id, filterMode, selectedMonth);
  const appliedChartRange = getAppliedWeightChartRange(filterMode, chartFrom, chartTo);
  const chartWhere: Prisma.WeightRecordWhereInput =
    filterMode === "month" ? { ...where } : { hamsterId: selectedHamster.id };
  if (appliedChartRange.from || appliedChartRange.to) {
    chartWhere.recordDate = {
      ...(appliedChartRange.from ? { gte: parseDateInput(appliedChartRange.from) } : {}),
      ...(appliedChartRange.to ? { lte: parseDateInput(appliedChartRange.to) } : {})
    };
  }

  const totalCount = await prisma.weightRecord.count({ where });
  const totalPages = Math.max(Math.ceil(totalCount / PUBLIC_DEMO_WEIGHT_HISTORY_PAGE_SIZE), 1);
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const [records, chartRecords] = await Promise.all([
    prisma.weightRecord.findMany({
      where,
      orderBy: buildWeightOrderBy(sortTarget, sortDirection),
      skip: (currentPage - 1) * PUBLIC_DEMO_WEIGHT_HISTORY_PAGE_SIZE,
      take: PUBLIC_DEMO_WEIGHT_HISTORY_PAGE_SIZE
    }),
    prisma.weightRecord.findMany({
      where: chartWhere,
      orderBy: [{ recordDate: "asc" }, { createdAt: "asc" }]
    })
  ]);

  return {
    household,
    hamsters,
    selectedHamster,
    records,
    chartRecords,
    monthOptions,
    selectedMonth,
    pagination: {
      currentPage,
      totalPages,
      totalCount,
      pageSize: PUBLIC_DEMO_WEIGHT_HISTORY_PAGE_SIZE
    }
  };
}

export async function getPublicDemoRecordsPageData(filters: RecordPageFilters) {
  const household = await getPublicDemoHousehold();
  if (!household) return null;

  const [hamsters, savedTagRows] = await Promise.all([
    prisma.hamster.findMany({
      where: { householdId: household.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true, isActive: true }
    }),
    prisma.savedMemoryTag.findMany({
      where: { householdId: household.id },
      orderBy: [{ createdAt: "desc" }, { name: "asc" }],
      select: { name: true }
    })
  ]);
  const scope = resolveRecordScope({
    hasScopeParam: filters.hasScopeParam,
    scopeParam: filters.scopeParam,
    defaultScope: "hamster"
  });
  const selectedHamster =
    hamsters.find((hamster) => hamster.id === filters.selectedHamsterId) ??
    hamsters.find((hamster) => hamster.isActive) ??
    hamsters[0] ??
    null;
  if (!selectedHamster) {
    return {
      household,
      hamsters,
      selectedHamster,
      scope,
      savedMemoryTags: savedTagRows.map((tag) => tag.name),
      tagSuggestions: [],
      records: [],
      pagination: { currentPage: 1, totalPages: 1, totalCount: 0, pageSize: RECORD_PAGE_SIZE }
    };
  }

  const where = buildRecordListWhere({
    scope,
    householdId: household.id,
    selectedHamsterId: selectedHamster.id,
    recordType: filters.recordType,
    from: filters.from,
    to: filters.to,
    keyword: filters.keyword,
    favoriteOnly: filters.favoriteOnly
  });
  const [totalCount, tagRows] = await Promise.all([
    prisma.hamsterRecord.count({ where }),
    prisma.memoryRecordDetail.findMany({
      where: { hamsterRecord: buildRecordScopeWhere(scope, household.id, selectedHamster.id) },
      select: { tags: true }
    })
  ]);
  const totalPages = Math.max(Math.ceil(totalCount / RECORD_PAGE_SIZE), 1);
  const currentPage = Math.min(Math.max(filters.page, 1), totalPages);
  const rows = await prisma.hamsterRecord.findMany({
    where,
    orderBy: [
      { recordDate: "desc" },
      { recordTimeMinutes: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" }
    ],
    skip: (currentPage - 1) * RECORD_PAGE_SIZE,
    take: RECORD_PAGE_SIZE,
    include: {
      hamster: { select: { id: true, name: true, isActive: true } },
      healthDetail: true,
      medicalDetail: true,
      memoryDetail: true
    }
  });

  return {
    household,
    hamsters,
    selectedHamster,
    scope,
    savedMemoryTags: savedTagRows.map((tag) => tag.name),
    tagSuggestions: collectRecordTagSuggestions(tagRows),
    records: rows.map((record) => ({
      id: record.id,
      recordType: record.recordType,
      recordDate: toDateInputValue(record.recordDate),
      recordTime: formatRecordTime(record.recordTimeMinutes),
      title: record.title,
      memo: record.memo,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      hamster: record.hamster,
      createdByLabel: "サンプル記録",
      staticImagePath: getPublicDemoRecordImagePath(record.id),
      healthDetail: record.healthDetail,
      medicalDetail: record.medicalDetail
        ? {
            ...record.medicalDetail,
            nextVisitDate: record.medicalDetail.nextVisitDate
              ? toDateInputValue(record.medicalDetail.nextVisitDate)
              : null,
            consultationFee: record.medicalDetail.consultationFee?.toString() ?? null
          }
        : null,
      memoryDetail: record.memoryDetail
        ? {
            tags: record.memoryDetail.tags,
            isFavorite: record.memoryDetail.isFavorite,
            imageFileName: null
          }
        : null
    })),
    pagination: { currentPage, totalPages, totalCount, pageSize: RECORD_PAGE_SIZE }
  };
}
