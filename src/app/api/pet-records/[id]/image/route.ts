import { getHouseholdContextForRoute } from "@/lib/auth-context";
import { canServePetRecordImage, readPetRecordImage } from "@/lib/pet-record-image";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notFound() {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store" }
  });
}

/**
 * 現在のHouseholdに属するPetの思い出画像を非公開で配信する。
 *
 * 権限外、不存在、DB参照の欠損、物理ファイルの欠損は同じ404として扱い、
 * 他Householdの記録や画像保存先の内部状態をレスポンスへ漏らさない。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getHouseholdContextForRoute();
  if (!context) {
    return new Response(null, {
      status: 401,
      headers: { "Cache-Control": "private, no-store" }
    });
  }

  const { id } = await params;
  const record = await prisma.petRecord.findFirst({
    where: {
      id,
      recordType: "MEMORY",
      pet: { householdId: context.household.id }
    },
    select: {
      pet: { select: { householdId: true } },
      memoryDetail: {
        select: {
          images: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { fileName: true }
          }
        }
      }
    }
  });
  const fileName = record?.memoryDetail?.images[0]?.fileName ?? null;

  if (
    !record ||
    !canServePetRecordImage({
      currentHouseholdId: context.household.id,
      petHouseholdId: record.pet.householdId,
      fileName
    })
  ) {
    return notFound();
  }

  try {
    const image = await readPetRecordImage(context.household.id, fileName!);
    return new Response(image, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(image.byteLength),
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return notFound();
  }
}
