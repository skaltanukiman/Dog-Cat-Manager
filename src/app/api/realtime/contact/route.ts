import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { isPublicContactId } from "@/lib/contact-inquiry-core";
import { getContactRealtimeLookup } from "@/lib/contact-realtime-access";
import { subscribeContactInquiryChanges } from "@/lib/contact-realtime";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 閲覧権限を確認した問い合わせについて、同一Node.jsプロセス内の変更をSSE配信する。
 *
 * public IDだけではアクセスを許可せず、利用者本人または管理者の条件でDB照合する。
 * durableな配送は保証しないため、クライアントはrevision pollingを併用する。
 */
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
      select: { id: true }
    });

    if (!inquiry) return NextResponse.json({ message: "Not Found" }, { status: 404 });

    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let isClosed = false;

        function enqueue(payload: string) {
          if (isClosed) return;

          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            isClosed = true;
            cleanup();
          }
        }

        enqueue(encodeSse("ready", { publicId }));

        const unsubscribe = subscribeContactInquiryChanges((event) => {
          if (event.publicId !== publicId) return;
          enqueue(encodeSse("contact-change", event));
        });

        const heartbeat = setInterval(() => {
          enqueue(": heartbeat\n\n");
        }, 25_000);

        cleanup = () => {
          isClosed = true;
          clearInterval(heartbeat);
          unsubscribe();
        };

        request.signal.addEventListener("abort", cleanup, { once: true });
      },
      cancel() {
        cleanup();
      }
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    const errorId = logUnexpectedError(error, {
      operation: "contactRealtime.sse.connect",
      context: { publicId }
    });
    return NextResponse.json(
      { message: "リアルタイム接続を開始できませんでした。", errorId },
      { status: 500 }
    );
  }
}
