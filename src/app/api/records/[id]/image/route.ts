import { getHouseholdContextForRoute } from "@/lib/auth-context";
import { canServeRecordImage, readRecordImage } from "@/lib/record-image";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * 現在のHouseholdから参照できる思い出の先頭画像だけを非公開配信する。
 *
 * DB上の関連と保存先をともに検証し、権限外・欠損・読込失敗は同じ404にして
 * 内部状態を開示しない。レスポンスは共有cacheへ保存させない。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getHouseholdContextForRoute();
  if (!context) {
    return new Response(null, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const { id } = await params;
  const record = await prisma.hamsterRecord.findFirst({
    where: {
      id,
      recordType: "MEMORY",
      memoryDetail: {
        is: { hamsters: { some: { hamster: { householdId: context.household.id } } } }
      }
    },
    select: {
      memoryDetail: {
        select: {
          images: { orderBy: { sortOrder: "asc" }, take: 1, select: { fileName: true } },
          hamsters: {
            orderBy: [{ sortOrder: "asc" }, { hamsterId: "asc" }],
            take: 1,
            select: { hamster: { select: { householdId: true } } }
          }
        }
      }
    }
  });
  const fileName = record?.memoryDetail?.images[0]?.fileName ?? null;
  const hamsterHouseholdId = record?.memoryDetail?.hamsters[0]?.hamster.householdId ?? null;
  if (
    !record ||
    !canServeRecordImage({
      currentHouseholdId: context.household.id,
      hamsterHouseholdId,
      fileName
    })
  ) {
    return notFound();
  }

  try {
    const image = await readRecordImage(context.household.id, fileName!);
    return new Response(image, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(image.byteLength),
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    // 物理ファイルの有無や読込失敗を権限外と区別せず、保存先の内部状態をレスポンスへ出さない。
    return notFound();
  }
}
