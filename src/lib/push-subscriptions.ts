import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isPrismaUniqueConstraintError } from "@/lib/server-errors";
import { pushSubscriptionSchema } from "@/lib/web-push";

export async function getActivePushRouteUserId() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accessStatus: true }
  });
  return user?.accessStatus === "ACTIVE" ? userId : null;
}

export function parsePushSubscription(input: unknown) {
  const result = pushSubscriptionSchema.safeParse(input);
  return result.success ? result.data : null;
}

export async function registerPushSubscription(
  userId: string,
  subscription: NonNullable<ReturnType<typeof parsePushSubscription>>,
  userAgent: string | null
) {
  // endpointは端末側の購読識別子。既存所有者を上書きすると別ユーザーへ通知が届くため付け替えない。
  const existing = await prisma.webPushSubscription.findUnique({
    where: { endpoint: subscription.endpoint },
    select: { id: true, userId: true }
  });
  if (existing && existing.userId !== userId) return "ownedByAnotherUser" as const;
  if (existing) {
    await prisma.webPushSubscription.updateMany({
      where: { id: existing.id, userId },
      data: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent
      }
    });
    return "registered" as const;
  }
  try {
    await prisma.webPushSubscription.create({
      data: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent
      }
    });
    return "registered" as const;
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error;
    // 事前確認後に別リクエストが作成した競合だけを再読込し、同じユーザーなら冪等成功とする。
    const raced = await prisma.webPushSubscription.findUnique({
      where: { endpoint: subscription.endpoint },
      select: { userId: true }
    });
    return raced?.userId === userId ? ("registered" as const) : ("ownedByAnotherUser" as const);
  }
}
