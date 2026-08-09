import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("管理トップはユーザーと共有を新しい順で最大5件だけ取得する", async () => {
  const userSource = await readFile("src/lib/admin-users.ts", "utf8");
  const householdSource = await readFile("src/lib/admin-households.ts", "utf8");
  const pageSource = await readFile("src/app/(app)/admin/page.tsx", "utf8");

  assert.match(userSource, /getAdminUserPreview[\s\S]*?orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*?take: 5/);
  assert.match(householdSource, /getAdminHouseholdPreview[\s\S]*?orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\][\s\S]*?take: 5/);
  assert.match(pageSource, /<AdminUserList users=\{users\} \/>/);
  assert.match(pageSource, /<AdminHouseholdList households=\{households\} \/>/);
  assert.match(pageSource, /すべてのユーザーを表示/);
  assert.match(pageSource, /すべての共有を表示/);
});

test("管理トップの集計はプレビュー配列長ではなく独立countを使う", async () => {
  const source = await readFile("src/app/(app)/admin/page.tsx", "utf8");

  assert.match(source, /prisma\.user\.count\(\)/);
  assert.match(source, /prisma\.household\.count\(\{\s*where:\s*\{\s*isDemo:\s*false/);
  assert.match(source, /getActiveInvitationCount\(now\)/);
  assert.match(source, />\{userCount\}<\/p>/);
  assert.match(source, />\{householdCount\}<\/p>/);
  assert.doesNotMatch(source, />\{users\.length\}<\/p>/);
  assert.doesNotMatch(source, />\{households\.length\}<\/p>/);
});

test("招待検索候補と全招待有無は5件プレビューから独立して取得する", async () => {
  const source = await readFile("src/app/(app)/admin/page.tsx", "utf8");

  assert.match(source, /prisma\.household\.findMany\(\{[\s\S]*?select: \{ id: true, name: true \}/);
  assert.match(source, /findMatchingAdminInvitationHouseholdIds\([\s\S]*?invitationHouseholds/);
  assert.match(source, /options=\{invitationHouseholds\}/);
  assert.match(source, /prisma\.householdInvitation\.count\(\)/);
  assert.match(source, /hasAnyInvitations: invitationCount > 0/);
  assert.doesNotMatch(source, /hasAnyInvitations: households\.some/);
});

test("管理トップの問い合わせ概要は件数と既存フィルターへのリンクだけを表示する", async () => {
  const [pageSource, querySource] = await Promise.all([
    readFile("src/app/(app)/admin/page.tsx", "utf8"),
    readFile("src/lib/contact-inquiry-queries.ts", "utf8")
  ]);
  const overviewSource = querySource.slice(querySource.indexOf("export async function getAdminContactInquiryOverview"));

  assert.match(pageSource, /問い合わせ概要/);
  assert.match(pageSource, /inquiryOverview\.openCount/);
  assert.match(pageSource, /inquiryOverview\.overdueOpenCount/);
  assert.match(pageSource, /inquiryOverview\.inProgressCount/);
  assert.match(pageSource, /inquiryOverview\.waitingCount/);
  assert.match(pageSource, /すべての問い合わせを表示/);
  assert.match(pageSource, /href="\/admin\/inquiries\?status=unhandled"/);
  assert.match(pageSource, /href="\/admin\/inquiries\?status=inProgress"/);
  assert.match(pageSource, /href="\/admin\/inquiries\?status=waiting"/);
  assert.match(pageSource, /const hasInProgressInquiries = inquiryOverview\.inProgressCount > 0/);
  assert.match(pageSource, /const hasWaitingInquiries = inquiryOverview\.waitingCount > 0/);
  assert.match(pageSource, /inProgressInquiryCardClassName = hasInProgressInquiries[\s\S]*?border-sky-200[\s\S]*?border-slate-200/);
  assert.match(pageSource, /waitingInquiryCardClassName = hasWaitingInquiries[\s\S]*?border-violet-200[\s\S]*?border-slate-200/);
  assert.match(pageSource, /className=\{inProgressInquiryCardClassName\}/);
  assert.match(pageSource, /className=\{waitingInquiryCardClassName\}/);
  assert.doesNotMatch(pageSource, /inquiryOverview\.latest|問い合わせはまだありません。|ContactStatusBadge/);
  assert.doesNotMatch(overviewSource, /findMany|take: 5|latest|select:|orderBy:/);
  assert.match(overviewSource, /status: "OPEN"/);
  assert.match(overviewSource, /createdAt: \{ lte: overdueThreshold \}/);
  assert.match(overviewSource, /status: "IN_PROGRESS"/);
  assert.match(overviewSource, /status: "WAITING_FOR_USER"/);
});
