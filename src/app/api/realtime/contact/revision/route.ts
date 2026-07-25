import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isPublicContactId } from "@/lib/contact-inquiry-core";
import { getContactRealtimeLookup } from "@/lib/contact-realtime-access";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const publicId = request.nextUrl.searchParams.get("publicId");

  try {
    const session = await auth();
    const viewer = session?.user;

    if (!viewer?.id) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    if (!isPublicContactId(publicId)) {
      return NextResponse.json({ message: "Bad Request" }, { status: 400 });
    }

    const where = getContactRealtimeLookup(publicId, viewer);
    if (!where) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

    const inquiry = await prisma.contactInquiry.findFirst({
      where,
      select: {
        realtimeRevision: true,
        realtimeActorClientId: true,
        realtimeActorUserId: true
      }
    });

    if (!inquiry) return NextResponse.json({ message: "Not Found" }, { status: 404 });

    return NextResponse.json({
      publicId,
      revision: inquiry.realtimeRevision.toString(),
      actorClientId: inquiry.realtimeActorClientId,
      actorUserId: inquiry.realtimeActorUserId
    });
  } catch (error) {
    const errorId = logUnexpectedError(error, {
      operation: "contactRealtime.revision.get",
      context: { publicId }
    });
    return NextResponse.json(
      { message: "同期情報を取得できませんでした。", errorId },
      { status: 500 }
    );
  }
}
