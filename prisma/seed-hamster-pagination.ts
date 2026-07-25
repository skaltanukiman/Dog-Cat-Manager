import { existsSync, readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const TARGET_HOUSEHOLD_NAME = "とっとこハム太郎のハムスター管理";
const SAMPLE_COUNT = 31;

function getDatabaseUrlForSeed() {
  if (process.env.HAMSTER_PAGINATION_DATABASE_URL) {
    return process.env.HAMSTER_PAGINATION_DATABASE_URL;
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

async function main() {
  const household = await prisma.household.findFirst({
    where: { name: TARGET_HOUSEHOLD_NAME, isDemo: false },
    select: { id: true }
  });

  if (!household) {
    throw new Error(`共有「${TARGET_HOUSEHOLD_NAME}」が見つかりません。`);
  }

  for (let index = 1; index <= SAMPLE_COUNT; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const name = `ページング確認ハムスター ${suffix}`;

    await prisma.hamster.upsert({
      where: { householdId_name: { householdId: household.id, name } },
      update: {},
      create: {
        householdId: household.id,
        name,
        memo: "ハムスター管理画面のページング確認用サンプルデータです。"
      }
    });
  }

  const totalCount = await prisma.hamster.count({ where: { householdId: household.id } });
  console.log(`「${TARGET_HOUSEHOLD_NAME}」へ確認用ハムスターを${SAMPLE_COUNT}件投入しました（合計${totalCount}件）。`);
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
