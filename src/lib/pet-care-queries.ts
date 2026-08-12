import { getCareDayDateInputJst } from "@/lib/care-day";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { parseDateInput } from "@/lib/date";
import { normalizePetCareDate } from "@/lib/pet-care";
import { prisma } from "@/lib/prisma";

/**
 * 現在のHouseholdに属するPet候補と、選択した1 Pet・1お世話日のCare履歴を取得する。
 * 履歴は全件取得せず、`petId + recordDate`をDB条件としてイベント時刻順に絞り込む。
 * species固有履歴はDOGならWalk、CATならLitterだけを問い合わせる。
 */
export async function getPetCarePageData({
  selectedPetId,
  requestedCareDate,
  includeInactive,
  now = new Date()
}: {
  selectedPetId?: string;
  requestedCareDate?: string;
  includeInactive: boolean;
  now?: Date;
}) {
  const context = await getRequiredHouseholdContext();
  const currentCareDate = getCareDayDateInputJst(now, context.household.careDayStartMinutes);
  const selectedCareDate = normalizePetCareDate(requestedCareDate, currentCareDate);
  const allPets = await prisma.pet.findMany({
    where: { householdId: context.household.id },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      species: true,
      isActive: true,
      profileImageFileName: true
    }
  });
  const pets = includeInactive ? allPets : allPets.filter((pet) => pet.isActive);
  const selectedPet = pets.find((pet) => pet.id === selectedPetId) ?? null;

  if (!selectedPet) {
    return {
      context,
      pets,
      totalPets: allPets.length,
      selectedPet,
      selectedCareDate,
      currentCareDate,
      feedingRecords: [],
      waterRecords: [],
      walkRecords: [],
      litterRecords: []
    };
  }

  const recordDate = parseDateInput(selectedCareDate);
  const [feedingRecords, waterRecords] = await Promise.all([
    prisma.petFeedingRecord.findMany({
      where: {
        petId: selectedPet.id,
        recordDate,
        pet: { householdId: context.household.id }
      },
      orderBy: [{ fedAt: "asc" }, { id: "asc" }],
      include: { createdBy: { select: { name: true } } }
    }),
    prisma.petWaterRecord.findMany({
      where: {
        petId: selectedPet.id,
        recordDate,
        pet: { householdId: context.household.id }
      },
      orderBy: [{ caredAt: "asc" }, { id: "asc" }],
      include: { createdBy: { select: { name: true } } }
    })
  ]);
  const walkRecords = selectedPet.species === "DOG"
    ? await prisma.petWalkRecord.findMany({
        where: {
          petId: selectedPet.id,
          recordDate,
          pet: { householdId: context.household.id, species: "DOG" }
        },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        include: { createdBy: { select: { name: true } } }
      })
    : [];
  const litterRecords = selectedPet.species === "CAT"
    ? await prisma.petLitterRecord.findMany({
        where: {
          petId: selectedPet.id,
          recordDate,
          pet: { householdId: context.household.id, species: "CAT" }
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        include: { createdBy: { select: { name: true } } }
      })
    : [];

  return {
    context,
    pets,
    totalPets: allPets.length,
    selectedPet,
    selectedCareDate,
    currentCareDate,
    feedingRecords,
    waterRecords,
    walkRecords,
    litterRecords
  };
}
