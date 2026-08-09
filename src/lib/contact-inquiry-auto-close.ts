import type { Prisma } from "@prisma/client";

import { getContactInquiryAutoCloseThreshold } from "@/lib/contact-inquiry-core";

type AutoCloseWhere = Prisma.ContactInquiryWhereInput;

export type ContactInquiryAutoCloseClient = {
  count(args: { where: AutoCloseWhere }): Promise<number>;
  updateMany(args: {
    where: AutoCloseWhere;
    data: Prisma.ContactInquiryUpdateManyMutationInput;
  }): Promise<{ count: number }>;
};

/** 件数確認と更新で共有する、対応済み時刻基準の自動終了条件を返す。 */
export function contactInquiryAutoCloseWhere(now = new Date()): AutoCloseWhere {
  return {
    status: "RESOLVED",
    resolvedAt: { lte: getContactInquiryAutoCloseThreshold(now) }
  };
}

/**
 * 7日以上返信のない対応済み問い合わせを終了する。
 *
 * 件数確認後の競合に備え、更新時にも状態とresolvedAtを同じwhereで再確認する。
 * 自動処理は利用者・管理者の操作ではないためactorを保存せず、revisionの増分だけで
 * 既存の問い合わせrevisionポーリングへ変更を通知する。
 */
export async function closeExpiredResolvedContactInquiries(
  client: ContactInquiryAutoCloseClient,
  now = new Date(),
  options: { dryRun?: boolean } = {}
) {
  const threshold = getContactInquiryAutoCloseThreshold(now);
  const where = contactInquiryAutoCloseWhere(now);
  const targetCount = await client.count({ where });

  if (options.dryRun) {
    return { threshold, targetCount, closedCount: 0 };
  }

  const { count: closedCount } = await client.updateMany({
    where,
    data: {
      status: "CLOSED",
      closedAt: now,
      updatedAt: now,
      realtimeRevision: { increment: 1 },
      realtimeActorClientId: null,
      realtimeActorUserId: null
    }
  });

  return { threshold, targetCount, closedCount };
}
