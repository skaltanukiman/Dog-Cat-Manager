import type { HouseholdRole } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type HouseholdDeletePreview = {
  householdId: string;
  householdName: string;
  currentRole: HouseholdRole;
  memberCount: number;
  ownerCount: number;
  joinedHouseholdCount: number;
  petCount: number;
  weightRecordCount: number;
  careRecordCount: number;
  recordCount: number;
  imageCount: number;
  savedMemoryTagCount: number;
};

/**
 * Household削除前に、Pet関連テーブルを横断して削除対象件数と実行者の権限状態を取得する。
 *
 * DBのCascade削除そのものとは分離し、確認画面に表示するための読み取り専用スナップショットを返す。
 */
export async function getHouseholdDeletePreview(
  householdId: string,
  actorUserId: string
): Promise<HouseholdDeletePreview | null> {
  const [
    household,
    ownerCount,
    joinedHouseholdCount,
    weightRecordCount,
    feedingRecordCount,
    waterRecordCount,
    walkRecordCount,
    litterRecordCount,
    recordCount,
    memoryImageCount,
    profileImageCount,
    savedMemoryTagCount
  ] = await Promise.all([
    prisma.household.findUnique({
      where: { id: householdId },
      select: {
        id: true,
        name: true,
        _count: { select: { members: true, pets: true } },
        members: {
          where: { userId: actorUserId },
          select: { role: true },
          take: 1
        }
      }
    }),
    prisma.householdMember.count({ where: { householdId, role: "OWNER" } }),
    prisma.householdMember.count({ where: { userId: actorUserId } }),
    prisma.petWeightRecord.count({ where: { pet: { householdId } } }),
    prisma.petFeedingRecord.count({ where: { pet: { householdId } } }),
    prisma.petWaterRecord.count({ where: { pet: { householdId } } }),
    prisma.petWalkRecord.count({ where: { pet: { householdId } } }),
    prisma.petLitterRecord.count({ where: { pet: { householdId } } }),
    prisma.petRecord.count({ where: { pet: { householdId } } }),
    prisma.petMemoryRecordImage.count({
      where: { memoryRecord: { petRecord: { pet: { householdId } } } }
    }),
    prisma.pet.count({ where: { householdId, profileImageFileName: { not: null } } }),
    prisma.savedMemoryTag.count({ where: { householdId } })
  ]);

  const currentRole = household?.members[0]?.role;
  if (!household || !currentRole) return null;

  return {
    householdId: household.id,
    householdName: household.name,
    currentRole,
    memberCount: household._count.members,
    ownerCount,
    joinedHouseholdCount,
    petCount: household._count.pets,
    weightRecordCount,
    careRecordCount:
      feedingRecordCount + waterRecordCount + walkRecordCount + litterRecordCount,
    recordCount,
    imageCount: memoryImageCount + profileImageCount,
    savedMemoryTagCount
  };
}
