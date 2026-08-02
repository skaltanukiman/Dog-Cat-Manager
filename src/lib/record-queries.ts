import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { normalizeHamsterSelectorMode, orderHamstersForSelector } from "@/lib/dashboard-settings";
import { toDateInputValue } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { formatRecordTime } from "@/lib/record-time";
import {
  buildRecordListWhere,
  buildRecordScopeWhere,
  collectRecordTagSuggestions,
  RECORD_PAGE_SIZE,
  resolveRecordScope,
  type RecordTypeFilter
} from "@/lib/records";

export type RecordPageFilters = {
  selectedHamsterId?: string;
  hasScopeParam: boolean;
  scopeParam?: string;
  recordType: RecordTypeFilter;
  from: string;
  to: string;
  keyword: string;
  favoriteOnly: boolean;
  page: number;
};

export async function getRecordsPageData(filters: RecordPageFilters) {
  const context = await getRequiredHouseholdContext();
  const [allHamsters, setting, savedMemoryTagRows] = await Promise.all([
    prisma.hamster.findMany({
      where: { householdId: context.household.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, isActive: true, createdAt: true }
    }),
    prisma.appSetting.findUnique({
      where: { userId_householdId: { userId: context.user.id, householdId: context.household.id } },
      select: {
        hamsterSelectorMode: true,
        recordTimelineDefaultScope: true,
        dashboardBoardCount: true,
        dashboardHamsters: {
          orderBy: { sortOrder: "asc" },
          select: { hamsterId: true }
        }
      }
    }),
    prisma.savedMemoryTag.findMany({
      where: { householdId: context.household.id },
      orderBy: [{ createdAt: "desc" }, { name: "asc" }],
      select: { name: true }
    })
  ]);
  const hamsters = orderHamstersForSelector(
    allHamsters,
    setting?.dashboardBoardCount,
    setting?.dashboardHamsters.map((entry) => entry.hamsterId) ?? [],
    true
  );
  const scope = resolveRecordScope({
    hasScopeParam: filters.hasScopeParam,
    scopeParam: filters.scopeParam,
    defaultScope: setting?.recordTimelineDefaultScope
  });
  const savedMemoryTags = savedMemoryTagRows.map((tag) => tag.name);
  const selectedHamster =
    hamsters.find((hamster) => hamster.id === filters.selectedHamsterId) ?? hamsters.find((hamster) => hamster.isActive) ?? hamsters[0] ?? null;

  if (!selectedHamster) {
    return {
      context,
      hamsters,
      selectedHamster: null,
      selectorMode: normalizeHamsterSelectorMode(setting?.hamsterSelectorMode),
      scope,
      savedMemoryTags,
      tagSuggestions: [],
      records: [],
      pagination: { currentPage: 1, totalPages: 1, totalCount: 0, pageSize: RECORD_PAGE_SIZE }
    };
  }

  const where = buildRecordListWhere({
    scope,
    householdId: context.household.id,
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
      where: {
        hamsterRecord: buildRecordScopeWhere(scope, context.household.id, selectedHamster.id)
      },
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
      createdBy: { select: { name: true, email: true } },
      healthDetail: true,
      medicalDetail: true,
      memoryDetail: {
        include: {
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
          hamsters: {
            orderBy: [{ sortOrder: "asc" }, { hamsterId: "asc" }],
            include: { hamster: { select: { id: true, name: true, isActive: true } } }
          }
        }
      }
    }
  });

  return {
    context,
    hamsters,
    selectedHamster,
    selectorMode: normalizeHamsterSelectorMode(setting?.hamsterSelectorMode),
    scope,
    savedMemoryTags,
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
      createdByLabel: record.createdBy?.name || record.createdBy?.email || "退会済みユーザー",
      staticImagePath: null as string | null,
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
            imageFileName: (record.memoryDetail.images[0]?.fileName ?? null) as string | null,
            hamsters: record.memoryDetail.hamsters.map((entry) => entry.hamster)
          }
        : null
    })),
    pagination: { currentPage, totalPages, totalCount, pageSize: RECORD_PAGE_SIZE }
  };
}
