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
const seedPrefix = "[Contact UI Test]";

type Fixture = {
  publicId: string;
  category: ContactInquiryCategory;
  status: ContactInquiryStatus;
  subject: string;
  sourcePath: string | null;
  errorId: string | null;
  assigned: boolean;
  minutesAgo: number;
};

const fixtures: Fixture[] = [
  { publicId: "HMB-20260725-A000000001", category: "BUG", status: "OPEN", subject: `${seedPrefix} Record list display issue`, sourcePath: "/records", errorId: "CLIENT-TEST-LAYOUT-001", assigned: false, minutesAgo: 240 },
  { publicId: "HMB-20260725-A000000002", category: "HOW_TO", status: "IN_PROGRESS", subject: `${seedPrefix} Switching shared groups`, sourcePath: "/settings/members", errorId: null, assigned: true, minutesAgo: 210 },
  { publicId: "HMB-20260725-A000000003", category: "FEATURE_REQUEST", status: "WAITING_FOR_USER", subject: `${seedPrefix} Weight chart range request`, sourcePath: "/weights", errorId: null, assigned: true, minutesAgo: 150 },
  { publicId: "HMB-20260725-A000000004", category: "ACCOUNT", status: "RESOLVED", subject: `${seedPrefix} Account information check`, sourcePath: "/settings", errorId: null, assigned: true, minutesAgo: 100 },
  { publicId: "HMB-20260725-A000000005", category: "OTHER", status: "CLOSED", subject: `${seedPrefix} Previous inquiry confirmation`, sourcePath: null, errorId: null, assigned: true, minutesAgo: 80 },
  { publicId: "HMB-20260725-A000000006", category: "BUG", status: "OPEN", subject: `${seedPrefix} Long subject for responsive layout verification in inquiry lists`, sourcePath: "/admin/inquiries?status=unhandled", errorId: "SERVER-TEST-SEARCH-006", assigned: false, minutesAgo: 20 }
];

function at(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60_000);
}

async function main() {
  if (!targetUserId) throw new Error("CONTACT_INQUIRY_SEED_USER_ID is required.");

  const user = await prisma.user.findFirst({
    where: { id: targetUserId, accessStatus: "ACTIVE" },
    select: { id: true, name: true, email: true, appRole: true }
  });
  if (!user || (user.appRole !== "ADMIN" && user.appRole !== "SUPER_ADMIN")) {
    throw new Error("The specified user must be an active app administrator.");
  }

  const userName = user.name?.trim() || "Support test user";
  const adminName = `${userName} (support)`;

  for (const fixture of fixtures) {
    const createdAt = at(fixture.minutesAgo);
    const hasAdminReply = fixture.assigned;
    const updatedAt = hasAdminReply ? at(fixture.minutesAgo - 20) : createdAt;
    const messages = [
      {
        senderType: "USER" as ContactSenderType,
        senderNameSnapshot: userName,
        body: "This is fixture data for verifying the inquiry user interface.",
        createdAt
      },
      ...(hasAdminReply
        ? [{ senderType: "ADMIN" as ContactSenderType, senderNameSnapshot: adminName, body: "This is a support reply in fixture data.", createdAt: updatedAt }]
        : [])
    ];
    const searchText = `${fixture.publicId} ${fixture.subject} ${userName} ${user.email ?? ""}`.toLowerCase();
    const resolvedAt = fixture.status === "RESOLVED" ? updatedAt : null;
    const closedAt = fixture.status === "CLOSED" ? updatedAt : null;
    const baseData = {
      userId: user.id,
      userIdSnapshot: user.id,
      userNameSnapshot: userName,
      userEmailSnapshot: user.email,
      category: fixture.category,
      subject: fixture.subject,
      searchText,
      status: fixture.status,
      sourcePath: fixture.sourcePath,
      errorId: fixture.errorId,
      assignedAdminUserId: fixture.assigned ? user.id : null,
      assignedAdminNameSnapshot: fixture.assigned ? adminName : null,
      createdAt,
      updatedAt,
      resolvedAt,
      closedAt
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

  console.log(`Seeded ${fixtures.length} contact inquiry fixtures.`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
