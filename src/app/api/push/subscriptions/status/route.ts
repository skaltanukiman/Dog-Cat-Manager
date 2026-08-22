import { NextResponse } from "next/server";
import { z } from "zod";

import { getActivePushRouteUserId } from "@/lib/push-subscriptions";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";
import { isSameOriginMutationRequest, readJsonRequestWithinLimit } from "@/lib/web-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const statusSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => value.startsWith("https://"))
});

export async function POST(request: Request) {
  try {
    const userId = await getActivePushRouteUserId();
    if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutationRequest(request)) {
      return NextResponse.json({ message: "Bad Request" }, { status: 400 });
    }
    const body = await readJsonRequestWithinLimit(request);
    if (!body.ok) return NextResponse.json({ message: "Bad Request" }, { status: 400 });
    const parsed = statusSchema.safeParse(body.value);
    if (!parsed.success) return NextResponse.json({ message: "Bad Request" }, { status: 400 });
    const registered = await prisma.webPushSubscription.count({
      where: { userId, endpoint: parsed.data.endpoint }
    });
    return NextResponse.json({ registered: registered > 0 });
  } catch (error) {
    const errorId = logUnexpectedError(error, { operation: "pushSubscriptions.status" });
    return NextResponse.json({ message: "通知端末の状態を確認できませんでした。", errorId }, { status: 500 });
  }
}
