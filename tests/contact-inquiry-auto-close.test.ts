import assert from "node:assert/strict";
import test from "node:test";
import type { ContactInquiryStatus } from "@prisma/client";

import {
  closeExpiredResolvedContactInquiries,
  contactInquiryAutoCloseWhere,
  type ContactInquiryAutoCloseClient
} from "../src/lib/contact-inquiry-auto-close";
import {
  CONTACT_INQUIRY_AUTO_CLOSE_MS,
  getContactInquiryAutoCloseThreshold,
  isContactInquiryAutoCloseEligible
} from "../src/lib/contact-inquiry-core";

type Inquiry = {
  id: string;
  status: ContactInquiryStatus;
  resolvedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date;
  realtimeRevision: number;
  realtimeActorClientId: string | null;
  realtimeActorUserId: string | null;
};

const NOW = new Date("2026-08-16T05:30:00.000Z");

function inquiry(
  id: string,
  status: ContactInquiryStatus,
  resolvedAt: Date | null
): Inquiry {
  return {
    id,
    status,
    resolvedAt,
    closedAt: null,
    updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    realtimeRevision: 4,
    realtimeActorClientId: "previous-client",
    realtimeActorUserId: "previous-user"
  };
}

function createClient(
  inquiries: Inquiry[],
  options: { afterCount?: () => void } = {}
) {
  let updateCalls = 0;
  const matches = (item: Inquiry, threshold: Date) =>
    item.status === "RESOLVED" &&
    item.resolvedAt !== null &&
    item.resolvedAt.getTime() <= threshold.getTime();

  const client: ContactInquiryAutoCloseClient = {
    count: async ({ where }) => {
      const threshold = (where.resolvedAt as { lte: Date }).lte;
      const count = inquiries.filter((item) => matches(item, threshold)).length;
      options.afterCount?.();
      return count;
    },
    updateMany: async ({ where, data }) => {
      updateCalls += 1;
      const threshold = (where.resolvedAt as { lte: Date }).lte;
      const targets = inquiries.filter((item) => matches(item, threshold));
      for (const item of targets) {
        item.status = data.status as ContactInquiryStatus;
        item.closedAt = data.closedAt as Date;
        item.updatedAt = data.updatedAt as Date;
        item.realtimeRevision += 1;
        item.realtimeActorClientId = data.realtimeActorClientId as null;
        item.realtimeActorUserId = data.realtimeActorUserId as null;
      }
      return { count: targets.length };
    }
  };

  return { client, getUpdateCalls: () => updateCalls };
}

test("問い合わせ自動終了の閾値は現在時刻のちょうど7日前", () => {
  assert.equal(CONTACT_INQUIRY_AUTO_CLOSE_MS, 7 * 24 * 60 * 60 * 1000);
  assert.deepEqual(
    getContactInquiryAutoCloseThreshold(NOW),
    new Date("2026-08-09T05:30:00.000Z")
  );
  assert.deepEqual(contactInquiryAutoCloseWhere(NOW), {
    status: "RESOLVED",
    resolvedAt: { lte: new Date("2026-08-09T05:30:00.000Z") }
  });
});

test("自動終了対象はRESOLVEDかつresolvedAtが7日以上前の場合だけ", () => {
  const cases: Array<{
    label: string;
    item: Pick<Inquiry, "status" | "resolvedAt">;
    expected: boolean;
  }> = [
    {
      label: "6日23時間59分",
      item: { status: "RESOLVED", resolvedAt: new Date("2026-08-09T05:31:00.000Z") },
      expected: false
    },
    {
      label: "ちょうど7日",
      item: { status: "RESOLVED", resolvedAt: new Date("2026-08-09T05:30:00.000Z") },
      expected: true
    },
    {
      label: "7日超過",
      item: { status: "RESOLVED", resolvedAt: new Date("2026-08-09T05:29:59.000Z") },
      expected: true
    },
    {
      label: "IN_PROGRESS",
      item: { status: "IN_PROGRESS", resolvedAt: new Date("2026-08-01T00:00:00.000Z") },
      expected: false
    },
    {
      label: "WAITING_FOR_USER",
      item: { status: "WAITING_FOR_USER", resolvedAt: new Date("2026-08-01T00:00:00.000Z") },
      expected: false
    },
    {
      label: "CLOSED",
      item: { status: "CLOSED", resolvedAt: new Date("2026-08-01T00:00:00.000Z") },
      expected: false
    },
    {
      label: "resolvedAtなし",
      item: { status: "RESOLVED", resolvedAt: null },
      expected: false
    }
  ];

  for (const current of cases) {
    assert.equal(isContactInquiryAutoCloseEligible(current.item, NOW), current.expected, current.label);
  }
});

test("期限を過ぎた対応済み問い合わせを終了し、時刻・revision・actorを更新する", async () => {
  const records = [
    inquiry("before", "RESOLVED", new Date("2026-08-09T05:30:01.000Z")),
    inquiry("boundary", "RESOLVED", new Date("2026-08-09T05:30:00.000Z")),
    inquiry("expired", "RESOLVED", new Date("2026-08-08T05:30:00.000Z")),
    inquiry("inconsistent", "RESOLVED", null)
  ];
  const { client } = createClient(records);

  const result = await closeExpiredResolvedContactInquiries(client, NOW);

  assert.equal(result.targetCount, 2);
  assert.equal(result.closedCount, 2);
  for (const item of records.filter(({ id }) => ["boundary", "expired"].includes(id))) {
    assert.equal(item.status, "CLOSED");
    assert.deepEqual(item.closedAt, NOW);
    assert.deepEqual(item.updatedAt, NOW);
    assert.equal(item.realtimeRevision, 5);
    assert.equal(item.realtimeActorClientId, null);
    assert.equal(item.realtimeActorUserId, null);
  }
  assert.equal(records[0].status, "RESOLVED");
  assert.equal(records[3].status, "RESOLVED");
});

test("件数確認後に状態が変わった問い合わせは更新時の条件再確認で終了しない", async () => {
  const record = inquiry("race", "RESOLVED", new Date("2026-08-01T00:00:00.000Z"));
  const { client } = createClient([record], {
    afterCount: () => {
      record.status = "IN_PROGRESS";
      record.resolvedAt = null;
    }
  });

  const result = await closeExpiredResolvedContactInquiries(client, NOW);

  assert.equal(result.targetCount, 1);
  assert.equal(result.closedCount, 0);
  assert.equal(record.status, "IN_PROGRESS");
  assert.equal(record.closedAt, null);
  assert.equal(record.realtimeRevision, 4);
});

test("dry-runは対象件数だけ取得し更新しない", async () => {
  const record = inquiry("dry-run", "RESOLVED", new Date("2026-08-01T00:00:00.000Z"));
  const { client, getUpdateCalls } = createClient([record]);

  const result = await closeExpiredResolvedContactInquiries(client, NOW, { dryRun: true });

  assert.equal(result.targetCount, 1);
  assert.equal(result.closedCount, 0);
  assert.equal(getUpdateCalls(), 0);
  assert.equal(record.status, "RESOLVED");
});
