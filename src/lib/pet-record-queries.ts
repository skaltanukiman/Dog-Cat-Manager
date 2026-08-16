import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { toDateInputValue } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { formatRecordTime } from "@/lib/record-time";
import {
  buildPetRecordListWhere,
  buildPetRecordScopeWhere,
  collectPetRecordTagSuggestions,
  PET_RECORD_PAGE_SIZE,
  resolvePetRecordScope,
  type PetRecordTypeFilter
} from "@/lib/pet-records";

export type PetRecordPageFilters = {
  selectedPetId?: string;
  includeInactive: boolean;
  hasScopeParam: boolean;
  scopeParam?: string;
  recordType: PetRecordTypeFilter;
  from: string;
  to: string;
  keyword: string;
  favoriteOnly: boolean;
  page: number;
};

/**
 * 現在のHouseholdに属するPet記録を、scope・filter・ページ単位で取得する。
 * MemoryのPet scopeは代表Petではなく中間関連で判定し、Household表示でも親記録を重複させない。
 */
export async function getPetRecordsPageData(filters: PetRecordPageFilters) {
  const context = await getRequiredHouseholdContext();
  const [allPets, setting, savedMemoryTagRows] = await Promise.all([
    prisma.pet.findMany({
      where: { householdId: context.household.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        species: true,
        isActive: true,
        profileImageFileName: true,
        createdAt: true
      }
    }),
    prisma.appSetting.findUnique({
      where: { userId_householdId: { userId: context.user.id, householdId: context.household.id } },
      select: { recordTimelineDefaultScope: true }
    }),
    prisma.savedMemoryTag.findMany({
      where: { householdId: context.household.id },
      orderBy: [{ createdAt: "desc" }, { name: "asc" }],
      select: { name: true }
    })
  ]);
  const pets = filters.includeInactive ? allPets : allPets.filter((pet) => pet.isActive);
  const selectedPet =
    pets.find((pet) => pet.id === filters.selectedPetId) ??
    pets.find((pet) => pet.isActive) ??
    pets[0] ??
    null;
  const scope = resolvePetRecordScope({
    hasScopeParam: filters.hasScopeParam,
    scopeParam: filters.scopeParam,
    defaultScope: setting?.recordTimelineDefaultScope
  });
  const savedMemoryTags = savedMemoryTagRows.map((tag) => tag.name);

  if (!selectedPet) {
    return {
      context,
      pets,
      totalPets: allPets.length,
      selectedPet: null,
      scope,
      savedMemoryTags,
      tagSuggestions: [],
      records: [],
      pagination: { currentPage: 1, totalPages: 1, totalCount: 0, pageSize: PET_RECORD_PAGE_SIZE }
    };
  }

  const where = buildPetRecordListWhere({
    scope,
    householdId: context.household.id,
    selectedPetId: selectedPet.id,
    recordType: filters.recordType,
    from: filters.from,
    to: filters.to,
    keyword: filters.keyword,
    favoriteOnly: filters.favoriteOnly
  });
  const [totalCount, tagRows] = await Promise.all([
    prisma.petRecord.count({ where }),
    prisma.petMemoryRecordDetail.findMany({
      where: {
        petRecord: buildPetRecordScopeWhere(scope, context.household.id, selectedPet.id)
      },
      select: { tags: true }
    })
  ]);
  const totalPages = Math.max(Math.ceil(totalCount / PET_RECORD_PAGE_SIZE), 1);
  const currentPage = Math.min(Math.max(filters.page, 1), totalPages);
  const rows = await prisma.petRecord.findMany({
    where,
    orderBy: [
      { recordDate: "desc" },
      { recordTimeMinutes: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" }
    ],
    skip: (currentPage - 1) * PET_RECORD_PAGE_SIZE,
    take: PET_RECORD_PAGE_SIZE,
    include: {
      pet: {
        select: {
          id: true,
          name: true,
          species: true,
          isActive: true,
          profileImageFileName: true
        }
      },
      createdBy: { select: { name: true, email: true } },
      healthDetail: true,
      medicalDetail: true,
      medicationDetail: true,
      vaccinationDetail: true,
      memoryDetail: {
        include: {
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
          pets: {
            orderBy: [{ sortOrder: "asc" }, { petId: "asc" }],
            include: {
              pet: {
                select: {
                  id: true,
                  name: true,
                  species: true,
                  isActive: true,
                  profileImageFileName: true
                }
              }
            }
          }
        }
      }
    }
  });

  return {
    context,
    pets,
    totalPets: allPets.length,
    selectedPet,
    scope,
    savedMemoryTags,
    tagSuggestions: collectPetRecordTagSuggestions(tagRows),
    records: rows.map((record) => ({
      id: record.id,
      recordType: record.recordType,
      recordDate: toDateInputValue(record.recordDate),
      recordTime: formatRecordTime(record.recordTimeMinutes),
      title: record.title,
      memo: record.memo,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      pet: record.pet,
      createdByLabel: record.createdBy?.name || record.createdBy?.email || "退会済みユーザー",
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
      medicationDetail: record.medicationDetail,
      vaccinationDetail: record.vaccinationDetail
        ? {
            ...record.vaccinationDetail,
            nextDueDate: record.vaccinationDetail.nextDueDate
              ? toDateInputValue(record.vaccinationDetail.nextDueDate)
              : null
          }
        : null,
      memoryDetail: record.memoryDetail
        ? {
            tags: record.memoryDetail.tags,
            isFavorite: record.memoryDetail.isFavorite,
            imageFileName: record.memoryDetail.images[0]?.fileName ?? null,
            pets: record.memoryDetail.pets.map((entry) => entry.pet)
          }
        : null
    })),
    pagination: { currentPage, totalPages, totalCount, pageSize: PET_RECORD_PAGE_SIZE }
  };
}
