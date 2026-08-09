import assert from "node:assert/strict";
import test from "node:test";
import type { ContactInquiryStatus, Prisma } from "@prisma/client";

import { getContactInquiryOverdueThreshold } from "../src/lib/contact-inquiry-core";
import { getAdminContactInquiryOverview } from "../src/lib/contact-inquiry-queries";

type OverviewInquiry = {
  status: ContactInquiryStatus;
  createdAt: Date;
};

function getOverview(inquiries: OverviewInquiry[], now: Date) {
  return getAdminContactInquiryOverview(now, {
    count: async ({ where }: Prisma.ContactInquiryCountArgs) => {
      const status = where?.status as ContactInquiryStatus | undefined;
      const createdAt = where?.createdAt as { lte?: Date } | undefined;
      return inquiries.filter(
        (inquiry) =>
          inquiry.status === status && (!createdAt?.lte || inquiry.createdAt <= createdAt.lte)
      ).length;
    }
  });
}

const now = new Date("2026-08-09T00:00:00Z");

test("問い合わせ期限超過の閾値は現在時刻のちょうど24時間前", () => {
  assert.equal(getContactInquiryOverdueThreshold(now).toISOString(), "2026-08-08T00:00:00.000Z");
});

test("問い合わせ概要はOPENが0件の場合、期限超過も0件にする", async () => {
  const overview = await getOverview(
    [
      { status: "IN_PROGRESS", createdAt: new Date("2026-08-07T00:00:00Z") },
      { status: "WAITING_FOR_USER", createdAt: new Date("2026-08-07T00:00:00Z") }
    ],
    now
  );

  assert.deepEqual(overview, {
    openCount: 0,
    overdueOpenCount: 0,
    inProgressCount: 1,
    waitingCount: 1
  });
});

test("問い合わせ概要は作成から24時間未満のOPENを期限超過に含めない", async () => {
  const overview = await getOverview(
    [{ status: "OPEN", createdAt: new Date("2026-08-08T00:00:01Z") }],
    now
  );

  assert.equal(overview.openCount, 1);
  assert.equal(overview.overdueOpenCount, 0);
});

test("問い合わせ概要は作成から24時間以上のOPENを期限超過に含める", async () => {
  const overview = await getOverview(
    [
      { status: "OPEN", createdAt: new Date("2026-08-08T00:00:00Z") },
      { status: "OPEN", createdAt: new Date("2026-08-08T00:00:01Z") }
    ],
    now
  );

  assert.equal(overview.openCount, 2);
  assert.equal(overview.overdueOpenCount, 1);
});

test("問い合わせ概要は古い確認中・回答待ちを期限超過に含めない", async () => {
  const overview = await getOverview(
    [
      { status: "IN_PROGRESS", createdAt: new Date("2026-08-07T00:00:00Z") },
      { status: "WAITING_FOR_USER", createdAt: new Date("2026-08-07T00:00:00Z") }
    ],
    now
  );

  assert.equal(overview.overdueOpenCount, 0);
  assert.equal(overview.inProgressCount, 1);
  assert.equal(overview.waitingCount, 1);
});
