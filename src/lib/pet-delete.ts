import type { Prisma } from "@prisma/client";

export const PET_DELETE_HISTORY_RELATIONS = [
  "weightRecords",
  "feedingRecords",
  "waterRecords",
  "walkRecords",
  "litterRecords",
  "records",
  "memoryRecords"
] as const;

export type PetDeleteHistoryRelation = (typeof PET_DELETE_HISTORY_RELATIONS)[number];
export type PetDeleteHistoryCounts = Record<PetDeleteHistoryRelation, number>;

type DeletablePet = {
  id: string;
  name: string;
  isActive: boolean;
  profileImageFileName: string | null;
};

export type PetDeleteRepository = {
  lockPet(householdId: string, petId: string): Promise<DeletablePet | null>;
  countHistory(petId: string): Promise<PetDeleteHistoryCounts>;
  deletePet(householdId: string, petId: string): Promise<number>;
};

export type PetDeleteResult =
  | { status: "notFound" }
  | { status: "active" }
  | { status: "hasHistory" }
  | {
      status: "deleted";
      petId: string;
      petName: string;
      profileImageFileName: string | null;
    };

export function createPrismaPetDeleteRepository(tx: Prisma.TransactionClient): PetDeleteRepository {
  return {
    lockPet: async (householdId, petId) => {
      // Pet行の排他ロックは、子テーブルへのFK参照追加が取得するKEY SHAREロックと競合する。
      // この後の履歴確認から削除確定まで、同時追加された履歴をCascadeへ巻き込ませない。
      const pets = await tx.$queryRaw<DeletablePet[]>`
        SELECT
          "id",
          "name",
          "is_active" AS "isActive",
          "profile_image_file_name" AS "profileImageFileName"
        FROM "pets"
        WHERE "id" = ${petId} AND "household_id" = ${householdId}
        FOR UPDATE
      `;
      return pets[0] ?? null;
    },
    countHistory: async (petId) => {
      const [weightRecords, feedingRecords, waterRecords, walkRecords, litterRecords, records, memoryRecords] =
        await Promise.all([
          tx.petWeightRecord.count({ where: { petId } }),
          tx.petFeedingRecord.count({ where: { petId } }),
          tx.petWaterRecord.count({ where: { petId } }),
          tx.petWalkRecord.count({ where: { petId } }),
          tx.petLitterRecord.count({ where: { petId } }),
          tx.petRecord.count({ where: { petId } }),
          tx.petMemoryRecordPet.count({ where: { petId } })
        ]);
      return {
        weightRecords,
        feedingRecords,
        waterRecords,
        walkRecords,
        litterRecords,
        records,
        memoryRecords
      };
    },
    deletePet: async (householdId, petId) => {
      const deleted = await tx.pet.deleteMany({
        where: { id: petId, householdId, isActive: false }
      });
      return deleted.count;
    }
  };
}

/**
 * 管理終了済みかつ履歴のないPetだけを、ロック・再確認・削除の順で処理する。
 * Dashboard表示設定と通知ルールは履歴ではないため、PetのCascadeにより削除する。
 */
export async function deletePetWithoutHistory(
  input: { householdId: string; petId: string },
  repository: PetDeleteRepository
): Promise<PetDeleteResult> {
  const pet = await repository.lockPet(input.householdId, input.petId);
  if (!pet) return { status: "notFound" };
  if (pet.isActive) return { status: "active" };

  const historyCounts = await repository.countHistory(pet.id);
  if (PET_DELETE_HISTORY_RELATIONS.some((relation) => historyCounts[relation] > 0)) {
    return { status: "hasHistory" };
  }

  if ((await repository.deletePet(input.householdId, pet.id)) !== 1) {
    return { status: "notFound" };
  }

  return {
    status: "deleted",
    petId: pet.id,
    petName: pet.name,
    profileImageFileName: pet.profileImageFileName
  };
}
