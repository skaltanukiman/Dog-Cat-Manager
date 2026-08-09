import type { Prisma } from "@prisma/client";

import {
  CONTACT_INQUIRY_PAGE_SIZE,
  getContactInquiryOverdueThreshold,
  type AdminInquiryQuery,
  statusesForAdminFilter
} from "@/lib/contact-inquiry-core";
import { createAdminPagination } from "@/lib/admin-pagination";
import { prisma } from "@/lib/prisma";

const inquiryListSelect = {
  id: true,
  publicId: true,
  category: true,
  subject: true,
  status: true,
  userNameSnapshot: true,
  userEmailSnapshot: true,
  assignedAdminNameSnapshot: true,
  assignedAdmin: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true
} satisfies Prisma.ContactInquirySelect;

const inquiryDetailSelect = {
  id: true,
  publicId: true,
  userId: true,
  userIdSnapshot: true,
  userNameSnapshot: true,
  userEmailSnapshot: true,
  category: true,
  subject: true,
  status: true,
  sourcePath: true,
  errorId: true,
  assignedAdminUserId: true,
  assignedAdminNameSnapshot: true,
  assignedAdmin: { select: { id: true, name: true, appRole: true } },
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  closedAt: true,
  realtimeRevision: true,
  messages: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      senderType: true,
      senderUserIdSnapshot: true,
      senderNameSnapshot: true,
      body: true,
      createdAt: true
    }
  }
} satisfies Prisma.ContactInquirySelect;

export type ContactInquiryListItem = Prisma.ContactInquiryGetPayload<{
  select: typeof inquiryListSelect;
}>;
export type ContactInquiryDetail = Prisma.ContactInquiryGetPayload<{
  select: typeof inquiryDetailSelect;
}>;

type ContactInquiryPageReader = {
  count(args: Prisma.ContactInquiryCountArgs): Promise<number>;
  findMany(args: Prisma.ContactInquiryFindManyArgs): Promise<ContactInquiryListItem[]>;
};

const pageReader: ContactInquiryPageReader = {
  count: (args) => prisma.contactInquiry.count(args),
  findMany: (args) =>
    prisma.contactInquiry.findMany(args) as unknown as Promise<ContactInquiryListItem[]>
};

type ContactInquiryOverviewReader = {
  count(args: Prisma.ContactInquiryCountArgs): Promise<number>;
};

const overviewReader: ContactInquiryOverviewReader = {
  count: (args) => prisma.contactInquiry.count(args)
};

export async function getUserContactInquiryPage(
  userId: string,
  requestedPage: number,
  reader: ContactInquiryPageReader = pageReader
) {
  const where: Prisma.ContactInquiryWhereInput = { userId };
  const totalCount = await reader.count({ where });
  const pagination = createAdminPagination(requestedPage, totalCount);
  const inquiries = await reader.findMany({
    where,
    select: inquiryListSelect,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (pagination.currentPage - 1) * CONTACT_INQUIRY_PAGE_SIZE,
    take: CONTACT_INQUIRY_PAGE_SIZE
  });
  return { inquiries, pagination };
}

export function createAdminInquiryWhere(query: AdminInquiryQuery): Prisma.ContactInquiryWhereInput {
  const statuses = statusesForAdminFilter(query.status);
  return {
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(query.category !== "all" ? { category: query.category } : {}),
    ...(query.search ? { searchText: { contains: query.search } } : {})
  };
}

export async function getAdminContactInquiryPage(
  query: AdminInquiryQuery,
  reader: ContactInquiryPageReader = pageReader
) {
  const where = createAdminInquiryWhere(query);
  const totalCount = await reader.count({ where });
  const pagination = createAdminPagination(query.page, totalCount);
  const orderBy = query.status === "unhandled"
    ? [{ createdAt: "asc" as const }, { id: "asc" as const }]
    : [{ updatedAt: "desc" as const }, { id: "desc" as const }];
  const inquiries = await reader.findMany({
    where,
    select: inquiryListSelect,
    orderBy,
    skip: (pagination.currentPage - 1) * CONTACT_INQUIRY_PAGE_SIZE,
    take: CONTACT_INQUIRY_PAGE_SIZE
  });
  return { inquiries, pagination };
}

export function getUserContactInquiryDetail(userId: string, publicId: string) {
  return prisma.contactInquiry.findFirst({
    where: { publicId, userId },
    select: inquiryDetailSelect
  });
}

export function getAdminContactInquiryDetail(publicId: string) {
  return prisma.contactInquiry.findUnique({
    where: { publicId },
    select: inquiryDetailSelect
  });
}

export function getAssignableContactAdmins() {
  return prisma.user.findMany({
    where: {
      appRole: { in: ["ADMIN", "SUPER_ADMIN"] },
      accessStatus: "ACTIVE"
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, email: true, appRole: true }
  });
}

export async function getAdminContactInquiryOverview(
  now = new Date(),
  reader: ContactInquiryOverviewReader = overviewReader
) {
  const overdueThreshold = getContactInquiryOverdueThreshold(now);
  const [openCount, overdueOpenCount, inProgressCount, waitingCount] = await Promise.all([
    reader.count({ where: { status: "OPEN" } }),
    reader.count({ where: { status: "OPEN", createdAt: { lte: overdueThreshold } } }),
    reader.count({ where: { status: "IN_PROGRESS" } }),
    reader.count({ where: { status: "WAITING_FOR_USER" } }),
  ]);
  return { openCount, overdueOpenCount, inProgressCount, waitingCount };
}

export function assignedAdminDisplayName(inquiry: {
  assignedAdmin: { name: string | null } | null;
  assignedAdminNameSnapshot: string | null;
}) {
  return inquiry.assignedAdmin?.name?.trim() || inquiry.assignedAdminNameSnapshot || "未設定";
}
