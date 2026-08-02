import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { subscribeHouseholdChanges } from "@/lib/realtime";
import { logUnexpectedError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 認証済みのHouseholdメンバーへ、同一Node.jsプロセス内の変更をSSE配信する。
 *
 * durableな配送は保証しないため、クライアントはrevision APIのpollingを常時併用する。
 * 切断時はheartbeat timerとプロセス内購読を必ず解除する。
 */
export async function GET(request: NextRequest) {
  const householdId = request.nextUrl.searchParams.get("householdId");
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    if (!householdId) return NextResponse.json({ message: "Bad Request" }, { status: 400 });

    const membership = await prisma.householdMember.findUnique({
      where: {
        householdId_userId: {
          householdId,
          userId
        }
      },
      select: { id: true }
    });

    if (!membership) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let isClosed = false;

        function enqueue(payload: string) {
          if (isClosed) {
            return;
          }

          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            isClosed = true;
            cleanup();
          }
        }

        enqueue(encodeSse("ready", { householdId }));

        const unsubscribe = subscribeHouseholdChanges((event) => {
          if (event.householdId !== householdId) {
            return;
          }

          enqueue(encodeSse("household-change", event));
        });

        // 更新がない間も中継プロキシに接続を閉じられないよう、コメント行を定期送信する。
        const heartbeat = setInterval(() => {
          enqueue(": heartbeat\n\n");
        }, 25000);

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
      operation: "realtime.sse.connect",
      context: { householdId }
    });
    return NextResponse.json({ message: "同期接続を開始できませんでした。", errorId }, { status: 500 });
  }
}
