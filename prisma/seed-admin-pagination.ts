import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { PrismaClient, type AppRole, type HouseholdRole } from "@prisma/client";

function getDatabaseUrlForSeed() {
  if (process.env.ADMIN_PAGINATION_DATABASE_URL) {
    return process.env.ADMIN_PAGINATION_DATABASE_URL;
  }

  if (existsSync("/.dockerenv")) {
    return undefined;
  }

  const envContents = readFileSync(".env", "utf8");
  const databaseUrl = envContents.match(/^DATABASE_URL="?([^"\r\n]+)"?$/m)?.[1];
  return databaseUrl?.replace("@db:5432/", "@127.0.0.1:5433/");
}

const databaseUrl = getDatabaseUrlForSeed();
const prisma = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  : new PrismaClient();
const SAMPLE_COUNT = 25;

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function createdAtFor(index: number) {
  return new Date(Date.UTC(2026, 6, index, 0, 0, 0));
}

async function main() {
  for (let index = 1; index <= SAMPLE_COUNT; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const userId = `admin-pagination-user-${suffix}`;
    const householdId = `admin-pagination-household-${suffix}`;
    const createdAt = createdAtFor(index);
    const appRole: AppRole = index % 10 === 0 ? "ADMIN" : "USER";
    const householdRole: HouseholdRole = index % 5 === 0 ? "ADMIN" : index % 3 === 0 ? "MEMBER" : "OWNER";

    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        name: `ページング確認ユーザー ${suffix}`,
        email: `admin-pagination-user-${suffix}@example.test`,
        appRole,
        createdAt
      }
    });

    await prisma.household.upsert({
      where: { id: householdId },
      update: {},
      create: {
        id: householdId,
        name: `ページング確認共有 ${suffix}`,
        createdAt
      }
    });

    await prisma.householdMember.upsert({
      where: { householdId_userId: { householdId, userId } },
      update: {},
      create: { householdId, userId, role: householdRole, createdAt }
    });

    await prisma.pet.upsert({
      where: { householdId_name: { householdId, name: `サンプルPet ${suffix}` } },
      update: {},
      create: {
        householdId,
        name: `サンプルPet ${suffix}`,
        species: index % 2 === 0 ? "DOG" : "CAT",
        memo: "管理画面のページング確認用サンプルデータです。",
        createdAt
      }
    });

    if (index % 2 === 0) {
      await prisma.session.upsert({
        where: { sessionToken: `admin-pagination-session-${suffix}` },
        update: {},
        create: {
          id: `admin-pagination-session-${suffix}`,
          sessionToken: `admin-pagination-session-${suffix}`,
          userId,
          expires: new Date("2027-12-31T00:00:00.000Z")
        }
      });
    }

    if (index % 2 === 1) {
      await prisma.householdInvitation.upsert({
        where: { id: `admin-pagination-invitation-${suffix}` },
        update: {},
        create: {
          id: `admin-pagination-invitation-${suffix}`,
          householdId,
          createdByUserId: userId,
          tokenHash: hashToken(`admin-pagination-invitation-${suffix}`),
          createdAt,
          expiresAt: new Date("2027-12-31T00:00:00.000Z")
        }
      });
    }
  }

  console.log(`管理画面のページング確認用サンプルを${SAMPLE_COUNT}件ずつ投入しました。`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
