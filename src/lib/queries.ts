import { canManageCareDaySettings } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { getCareDayRecordDate, normalizeCareDayStartMinutes } from "@/lib/care-day";
import {
  normalizeDashboardBoardCount,
  pickDashboardPets
} from "@/lib/dashboard-settings";
import { normalizePetRecordScope } from "@/lib/pet-records";
import { prisma } from "@/lib/prisma";

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
  const careDayStartMinutes = normalizeCareDayStartMinutes(context.household.careDayStartMinutes);
  const careDayRecordDate = getCareDayRecordDate(new Date(), careDayStartMinutes);

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
  const recordTimelineDefaultScope = normalizePetRecordScope(setting?.recordTimelineDefaultScope);
  const careNotificationCompactBody = setting?.careNotificationCompactBody === true;
  const selectedIds = setting?.dashboardPets.map((entry) => entry.petId) ?? [];
  // 設定画面の初期表示でも、ダッシュボードと同じ補完ルールで選択状態を作る。
  const selectedPetIds = pickDashboardPets(pets, boardCount, selectedIds).map((pet) => pet.id);

  return {
    user: context.user,
    boardCount,
    recordTimelineDefaultScope,
    careNotificationCompactBody,
    careDayStartMinutes: normalizeCareDayStartMinutes(context.household.careDayStartMinutes),
    canManageCareDaySettings: canManageCareDaySettings(context.membership.role),
    pets,
    selectedPetIds
  };
}
