import { existsSync, readFileSync } from "node:fs";

import {
  ContactInquiryCategory,
  ContactInquiryStatus,
  ContactSenderType,
  PrismaClient
} from "@prisma/client";

function getDatabaseUrlForSeed() {
  if (process.env.CONTACT_INQUIRY_SEED_DATABASE_URL) return process.env.CONTACT_INQUIRY_SEED_DATABASE_URL;
  if (existsSync("/.dockerenv")) return undefined;

  const envContents = readFileSync(".env", "utf8");
  const databaseUrl = envContents.match(/^DATABASE_URL="?([^"\r\n]+)"?$/m)?.[1];
  return databaseUrl?.replace("@db:5432/", "@127.0.0.1:5433/");
}

const databaseUrl = getDatabaseUrlForSeed();
const prisma = databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : new PrismaClient();
const targetUserId = process.env.CONTACT_INQUIRY_SEED_USER_ID;
const seedPrefix = "[検証]";

type Fixture = {
  publicId: string;
  category: ContactInquiryCategory;
  status: ContactInquiryStatus;
  subject: string;
  createdMinutesAgo: number;
  updatedMinutesAgo: number;
  assigned: boolean;
};

const fixtures: Fixture[] = [
  { publicId: "HMB-20260809-O000000001", category: "BUG", status: "OPEN", subject: `${seedPrefix} 未対応・48時間経過`, createdMinutesAgo: 48 * 60, updatedMinutesAgo: 5, assigned: false },
  { publicId: "HMB-20260809-O000000002", category: "HOW_TO", status: "OPEN", subject: `${seedPrefix} 未対応・24時間経過`, createdMinutesAgo: 24 * 60, updatedMinutesAgo: 120, assigned: false },
  { publicId: "HMB-20260809-O000000003", category: "FEATURE_REQUEST", status: "OPEN", subject: `${seedPrefix} 未対応・22時間経過`, createdMinutesAgo: 22 * 60, updatedMinutesAgo: 1, assigned: false },
  { publicId: "HMB-20260809-O000000004", category: "ACCOUNT", status: "IN_PROGRESS", subject: `${seedPrefix} 確認中・72時間経過`, createdMinutesAgo: 72 * 60, updatedMinutesAgo: 10, assigned: true },
  { publicId: "HMB-20260809-O000000005", category: "OTHER", status: "WAITING_FOR_USER", subject: `${seedPrefix} 回答待ち・72時間経過`, createdMinutesAgo: 72 * 60, updatedMinutesAgo: 15, assigned: true },
  { publicId: "HMB-20260809-O000000006", category: "BUG", status: "RESOLVED", subject: `${seedPrefix} 対応済み・72時間経過`, createdMinutesAgo: 72 * 60, updatedMinutesAgo: 20, assigned: true }
];

function at(now: Date, minutesAgo: number) {
  return new Date(now.getTime() - minutesAgo * 60_000);
}

async function main() {
  const user = await prisma.user.findFirst({
    where: {
      ...(targetUserId ? { id: targetUserId } : {}),
      accessStatus: "ACTIVE",
      appRole: { in: ["ADMIN", "SUPER_ADMIN"] }
    },
    orderBy: { id: "asc" },
    select: { id: true, name: true, email: true }
  });
  if (!user) {
    throw new Error("An active app administrator is required for test fixtures.");
  }

  const now = new Date();
  const userName = user.name?.trim() || "Support test user";
  const adminName = `${userName} (support)`;

  for (const fixture of fixtures) {
    const createdAt = at(now, fixture.createdMinutesAgo);
    const updatedAt = at(now, fixture.updatedMinutesAgo);
    const messages = [
      {
        senderType: "USER" as ContactSenderType,
        senderNameSnapshot: userName,
        body: "This is fixture data for verifying overdue contact inquiry displays.",
        createdAt
      },
      ...(fixture.assigned
        ? [{ senderType: "ADMIN" as ContactSenderType, senderNameSnapshot: adminName, body: "This is a support reply in fixture data.", createdAt: updatedAt }]
        : [])
    ];
    const resolvedAt = fixture.status === "RESOLVED" ? updatedAt : null;
    const baseData = {
      userId: user.id,
      userIdSnapshot: user.id,
      userNameSnapshot: userName,
      userEmailSnapshot: user.email,
      category: fixture.category,
      subject: fixture.subject,
      searchText: `${fixture.publicId} ${fixture.subject} ${userName} ${user.email ?? ""}`.toLowerCase(),
      status: fixture.status,
      sourcePath: "/admin/inquiries",
      errorId: null,
      assignedAdminUserId: fixture.assigned ? user.id : null,
      assignedAdminNameSnapshot: fixture.assigned ? adminName : null,
      createdAt,
      updatedAt,
      resolvedAt,
      closedAt: null
    };

    await prisma.contactInquiry.upsert({
      where: { publicId: fixture.publicId },
      update: {
        ...baseData,
        messages: {
          deleteMany: {},
          create: messages.map((message) => ({
            ...message,
            senderUserId: user.id,
            senderUserIdSnapshot: user.id
          }))
        }
      },
      create: {
        publicId: fixture.publicId,
        ...baseData,
        messages: {
          create: messages.map((message) => ({
            ...message,
            senderUserId: user.id,
            senderUserIdSnapshot: user.id
          }))
        }
      }
    });
  }

  console.log(`Seeded ${fixtures.length} overdue contact inquiry fixtures.`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
