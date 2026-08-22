import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export const PET_WEIGHT_HISTORY_PAGE_SIZE = 20;
export const PET_WEIGHT_CHART_MAX_POINTS = 365;

/** CSVエクスポート用に、管理終了Petを含む現在Household内の選択肢を返す。 */
export async function getPetWeightExportPets() {
  const context = await getRequiredHouseholdContext();
  return prisma.pet.findMany({
    where: { householdId: context.household.id },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, species: true, isActive: true }
  });
}

/**
 * 現在のHouseholdに属するPetと、選択Petの体重履歴を取得する。
 * 一覧はDBでページングし、グラフはClient Componentへの転送量を抑えるため直近365点に制限する。
 */
export async function getPetWeightPageData({
  selectedPetId,
  includeInactive,
  page
}: {
  selectedPetId?: string;
  includeInactive: boolean;
  page: number;
}) {
  const context = await getRequiredHouseholdContext();
  const allPets = await prisma.pet.findMany({
    where: { householdId: context.household.id },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, species: true, isActive: true }
  });
  const pets = includeInactive ? allPets : allPets.filter((pet) => pet.isActive);
  const selectedPet = pets.find((pet) => pet.id === selectedPetId) ?? null;

  if (!selectedPet) {
    return {
      pets,
      totalPets: allPets.length,
      selectedPet,
      records: [],
      chartRecords: [],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalCount: 0,
        pageSize: PET_WEIGHT_HISTORY_PAGE_SIZE
      }
    };
  }

  const where = { petId: selectedPet.id };
  const totalCount = await prisma.petWeightRecord.count({ where });
  const totalPages = Math.max(Math.ceil(totalCount / PET_WEIGHT_HISTORY_PAGE_SIZE), 1);
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const [records, chartRecordsDescending] = await Promise.all([
    prisma.petWeightRecord.findMany({
      where,
      orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
      skip: (currentPage - 1) * PET_WEIGHT_HISTORY_PAGE_SIZE,
      take: PET_WEIGHT_HISTORY_PAGE_SIZE
    }),
    prisma.petWeightRecord.findMany({
      where,
      orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
      take: PET_WEIGHT_CHART_MAX_POINTS
    })
  ]);

  return {
    pets,
    totalPets: allPets.length,
    selectedPet,
    records,
    chartRecords: chartRecordsDescending.reverse(),
    pagination: {
      currentPage,
      totalPages,
      totalCount,
      pageSize: PET_WEIGHT_HISTORY_PAGE_SIZE
    }
  };
}
