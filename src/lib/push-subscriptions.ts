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

/** endpointの既存所有者を付け替えず、同一ユーザーの再登録だけを冪等更新する。 */
export async function registerPushSubscription(
  userId: string,
  subscription: NonNullable<ReturnType<typeof parsePushSubscription>>,
  userAgent: string | null
) {
  const existing = await prisma.webPushSubscription.findUnique({
    where: { endpoint: subscription.endpoint },
    select: { id: true, userId: true }
  });
  if (existing && existing.userId !== userId) return "ownedByAnotherUser" as const;
  if (existing) {
    await prisma.webPushSubscription.updateMany({
      where: { id: existing.id, userId },
      data: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent }
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
    const raced = await prisma.webPushSubscription.findUnique({
      where: { endpoint: subscription.endpoint },
      select: { userId: true }
    });
    return raced?.userId === userId ? "registered" as const : "ownedByAnotherUser" as const;
  }
}
