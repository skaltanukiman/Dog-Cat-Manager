import { randomBytes } from "node:crypto";

import { z } from "zod";

import { normalizeSearchText } from "@/lib/search";

export const CONTACT_INQUIRY_PAGE_SIZE = 20;
export const CONTACT_SUBJECT_MAX_LENGTH = 100;
export const CONTACT_BODY_MIN_LENGTH = 10;
export const CONTACT_BODY_MAX_LENGTH = 2000;
export const CONTACT_REPLY_MAX_LENGTH = 2000;
export const CONTACT_ERROR_ID_MAX_LENGTH = 128;
export const CONTACT_SOURCE_PATH_MAX_LENGTH = 300;
export const CONTACT_CREATION_COOLDOWN_MS = 30 * 1000;
export const CONTACT_CREATION_WINDOW_MS = 60 * 60 * 1000;
export const CONTACT_CREATION_WINDOW_LIMIT = 5;
export const CONTACT_OPEN_INQUIRY_LIMIT = 10;
export const CONTACT_REPLY_COOLDOWN_MS = 10 * 1000;
export const CONTACT_SEARCH_MAX_LENGTH = 100;
export const CONTACT_INQUIRY_OVERDUE_MS = 24 * 60 * 60 * 1000;
export const CONTACT_INQUIRY_AUTO_CLOSE_MS = 7 * 24 * 60 * 60 * 1000;

export const CONTACT_CATEGORIES = [
  "BUG",
  "HOW_TO",
  "FEATURE_REQUEST",
  "ACCOUNT",
  "OTHER"
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const CONTACT_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_USER",
  "RESOLVED",
  "CLOSED"
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export function getContactInquiryOverdueThreshold(now: Date) {
  return new Date(now.getTime() - CONTACT_INQUIRY_OVERDUE_MS);
}

export function isContactInquiryOverdue(
  inquiry: { status: ContactStatus; createdAt: Date },
  now: Date
) {
  return (
    inquiry.status === "OPEN" &&
    inquiry.createdAt.getTime() <= now.getTime() - CONTACT_INQUIRY_OVERDUE_MS
  );
}

/** 対応済み問い合わせを自動終了する基準となる、現在時刻の7日前を返す。 */
export function getContactInquiryAutoCloseThreshold(now: Date) {
  return new Date(now.getTime() - CONTACT_INQUIRY_AUTO_CLOSE_MS);
}

/** 最後に対応済みになった時刻から算出した、自動終了可能になる時刻を返す。 */
export function getContactInquiryAutoCloseAt(resolvedAt: Date) {
  return new Date(resolvedAt.getTime() + CONTACT_INQUIRY_AUTO_CLOSE_MS);
}

/** statusと最後のresolvedAtだけを使い、現在時刻時点の自動終了対象か判定する。 */
export function isContactInquiryAutoCloseEligible(
  inquiry: { status: ContactStatus; resolvedAt: Date | null },
  now: Date
) {
  return (
    inquiry.status === "RESOLVED" &&
    inquiry.resolvedAt !== null &&
    inquiry.resolvedAt.getTime() <= getContactInquiryAutoCloseThreshold(now).getTime()
  );
}

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  BUG: "不具合",
  HOW_TO: "使い方",
  FEATURE_REQUEST: "機能要望",
  ACCOUNT: "アカウント",
  OTHER: "その他"
};

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  OPEN: "受付済み",
  IN_PROGRESS: "確認中",
  WAITING_FOR_USER: "利用者からの回答待ち",
  RESOLVED: "対応済み",
  CLOSED: "終了"
};

const optionalErrorIdSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.union([
    z
      .string()
      .trim()
      .max(CONTACT_ERROR_ID_MAX_LENGTH)
      .regex(/^[A-Za-z0-9._:-]+$/),
    z.null()
  ])
);

export function isSafeContactSourcePath(value: string) {
  if (
    value.length > CONTACT_SOURCE_PATH_MAX_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, "https://app.invalid");
    return parsed.origin === "https://app.invalid" && parsed.pathname.startsWith("/");
  } catch {
    return false;
  }
}

const optionalSourcePathSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.union([
    z
      .string()
      .trim()
      .max(CONTACT_SOURCE_PATH_MAX_LENGTH)
      .refine(isSafeContactSourcePath),
    z.null()
  ])
);

export const createContactInquirySchema = z.object({
  category: z.enum(CONTACT_CATEGORIES),
  subject: z.string().trim().min(1).max(CONTACT_SUBJECT_MAX_LENGTH),
  body: z.string().trim().min(CONTACT_BODY_MIN_LENGTH).max(CONTACT_BODY_MAX_LENGTH),
  errorId: optionalErrorIdSchema,
  sourcePath: optionalSourcePathSchema
});

export const contactReplySchema = z.string().trim().min(1).max(CONTACT_REPLY_MAX_LENGTH);

export function parseInitialErrorId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = optionalErrorIdSchema.safeParse(raw ?? null);
  return parsed.success ? parsed.data ?? "" : "";
}

export function parseInitialSourcePath(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = optionalSourcePathSchema.safeParse(raw ?? null);
  return parsed.success ? parsed.data ?? "" : "";
}

function jstDateParts(date: Date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return [
    jst.getUTCFullYear(),
    String(jst.getUTCMonth() + 1).padStart(2, "0"),
    String(jst.getUTCDate()).padStart(2, "0")
  ].join("");
}

export function createContactPublicId(
  now = new Date(),
  random: (size: number) => Buffer = randomBytes
) {
  const suffix = random(8).toString("hex").slice(0, 10).toUpperCase();
  return `HMB-${jstDateParts(now)}-${suffix}`;
}

export function isPublicContactId(value: unknown): value is string {
  return typeof value === "string" && /^HMB-\d{8}-[A-F0-9]{10}$/.test(value);
}

export function createContactSearchText(input: {
  publicId: string;
  subject: string;
  userName: string;
  userEmail: string | null;
}) {
  return normalizeSearchText(
    [input.publicId, input.subject, input.userName, input.userEmail ?? ""].join(" ")
  );
}

export type ContactCreationLimitCode = "cooldown" | "hourlyLimit" | "openLimit";

export function evaluateContactCreationLimit(input: {
  now: Date;
  latestCreatedAt: Date | null;
  createdWithinWindow: number;
  oldestCreatedWithinWindowAt: Date | null;
  openInquiryCount: number;
}): { code: ContactCreationLimitCode; retryAt?: Date } | null {
  if (
    input.latestCreatedAt &&
    input.now.getTime() - input.latestCreatedAt.getTime() < CONTACT_CREATION_COOLDOWN_MS
  ) {
    return {
      code: "cooldown",
      retryAt: new Date(input.latestCreatedAt.getTime() + CONTACT_CREATION_COOLDOWN_MS)
    };
  }
  if (input.createdWithinWindow >= CONTACT_CREATION_WINDOW_LIMIT) {
    return {
      code: "hourlyLimit",
      retryAt: input.oldestCreatedWithinWindowAt
        ? new Date(input.oldestCreatedWithinWindowAt.getTime() + CONTACT_CREATION_WINDOW_MS)
        : undefined
    };
  }
  if (input.openInquiryCount >= CONTACT_OPEN_INQUIRY_LIMIT) {
    return { code: "openLimit" };
  }
  return null;
}

const ADMIN_STATUS_TRANSITIONS: Record<ContactStatus, readonly ContactStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_FOR_USER", "RESOLVED", "CLOSED"],
  WAITING_FOR_USER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: []
};

export function canTransitionContactStatus(current: ContactStatus, next: ContactStatus) {
  return current === next || ADMIN_STATUS_TRANSITIONS[current].includes(next);
}

export function statusAfterUserReply(current: ContactStatus): ContactStatus | null {
  if (current === "CLOSED") return null;
  return current === "WAITING_FOR_USER" || current === "RESOLVED" ? "IN_PROGRESS" : current;
}

export function contactStatusTimestamps(nextStatus: ContactStatus, now: Date) {
  return {
    resolvedAt: nextStatus === "RESOLVED" ? now : null,
    closedAt: nextStatus === "CLOSED" ? now : null
  };
}

export const ADMIN_INQUIRY_FILTERS = [
  "all",
  "unhandled",
  "inProgress",
  "waiting",
  "resolved",
  "closed"
] as const;
export type AdminInquiryFilter = (typeof ADMIN_INQUIRY_FILTERS)[number];

export type AdminInquiryQuery = {
  page: number;
  status: AdminInquiryFilter;
  category: ContactCategory | "all";
  search: string;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeContactPage(value: string | string[] | undefined) {
  const raw = firstParam(value);
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function parseAdminInquiryQuery(params: {
  page?: string | string[];
  status?: string | string[];
  category?: string | string[];
  search?: string | string[];
}): AdminInquiryQuery {
  const rawStatus = firstParam(params.status);
  const rawCategory = firstParam(params.category);
  const rawSearch = firstParam(params.search) ?? "";
  return {
    page: normalizeContactPage(params.page),
    status: ADMIN_INQUIRY_FILTERS.includes(rawStatus as AdminInquiryFilter)
      ? (rawStatus as AdminInquiryFilter)
      : "all",
    category:
      rawCategory === "all" || CONTACT_CATEGORIES.includes(rawCategory as ContactCategory)
        ? (rawCategory as ContactCategory | "all")
        : "all",
    search: normalizeSearchText(rawSearch.slice(0, CONTACT_SEARCH_MAX_LENGTH))
  };
}

export function statusesForAdminFilter(filter: AdminInquiryFilter): ContactStatus[] | undefined {
  const mapping: Record<Exclude<AdminInquiryFilter, "all">, ContactStatus[]> = {
    unhandled: ["OPEN"],
    inProgress: ["IN_PROGRESS"],
    waiting: ["WAITING_FOR_USER"],
    resolved: ["RESOLVED"],
    closed: ["CLOSED"]
  };
  return filter === "all" ? undefined : mapping[filter];
}

export function buildAdminInquiryHref(query: AdminInquiryQuery, page: number) {
  const params = new URLSearchParams();
  if (query.status !== "all") params.set("status", query.status);
  if (query.category !== "all") params.set("category", query.category);
  if (query.search) params.set("search", query.search);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/admin/inquiries?${suffix}` : "/admin/inquiries";
}

const ADMIN_INQUIRIES_PATH = "/admin/inquiries";
const ADMIN_INQUIRIES_ORIGIN = "https://app.invalid";

/** 管理問い合わせ詳細から戻る一覧URLを、管理問い合わせ一覧だけに制限する。 */
export function normalizeAdminInquiryReturnTo(value: string | string[] | undefined) {
  const raw = firstParam(value);
  if (
    !raw ||
    (raw !== ADMIN_INQUIRIES_PATH && !raw.startsWith(`${ADMIN_INQUIRIES_PATH}?`))
  ) {
    return ADMIN_INQUIRIES_PATH;
  }

  try {
    const parsed = new URL(raw, ADMIN_INQUIRIES_ORIGIN);
    return parsed.origin === ADMIN_INQUIRIES_ORIGIN &&
      parsed.pathname === ADMIN_INQUIRIES_PATH &&
      parsed.hash === ""
      ? raw
      : ADMIN_INQUIRIES_PATH;
  } catch {
    return ADMIN_INQUIRIES_PATH;
  }
}

/** 一覧へ戻るURLをreturnToへ格納した管理問い合わせ詳細URLを生成する。 */
export function buildAdminInquiryDetailHref(publicId: string, returnTo: string) {
  const params = new URLSearchParams({ returnTo });
  return `/admin/inquiries/${encodeURIComponent(publicId)}?${params.toString()}`;
}
