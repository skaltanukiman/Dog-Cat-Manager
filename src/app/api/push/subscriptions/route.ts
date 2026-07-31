import { NextResponse } from "next/server";

import {
  getActivePushRouteUserId,
  parsePushSubscription,
  registerPushSubscription
} from "@/lib/push-subscriptions";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";
import { isSameOriginMutationRequest, requestBodyIsWithinLimit } from "@/lib/web-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readRequest(request: Request) {
  if (!isSameOriginMutationRequest(request) || !requestBodyIsWithinLimit(request)) return null;
  try {
    return parsePushSubscription((await request.json())?.subscription);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getActivePushRouteUserId();
    if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const subscription = await readRequest(request);
    if (!subscription) return NextResponse.json({ message: "Bad Request" }, { status: 400 });
    const result = await registerPushSubscription(
      userId,
      subscription,
      request.headers.get("user-agent")?.slice(0, 512) ?? null
    );
    if (result === "ownedByAnotherUser") {
      return NextResponse.json({ message: "Conflict" }, { status: 409 });
    }
    return NextResponse.json({ registered: true });
  } catch (error) {
    const errorId = logUnexpectedError(error, { operation: "pushSubscriptions.register" });
    return NextResponse.json({ message: "通知端末を登録できませんでした。", errorId }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await getActivePushRouteUserId();
    if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const subscription = await readRequest(request);
    if (!subscription) return NextResponse.json({ message: "Bad Request" }, { status: 400 });
    const deleted = await prisma.webPushSubscription.deleteMany({
      where: { userId, endpoint: subscription.endpoint }
    });
    return NextResponse.json({ removed: deleted.count > 0 });
  } catch (error) {
    const errorId = logUnexpectedError(error, { operation: "pushSubscriptions.remove" });
    return NextResponse.json({ message: "通知端末を解除できませんでした。", errorId }, { status: 500 });
  }
}
