import { getHouseholdContextForRoute } from "@/lib/auth-context";
import { canServePetImage, readPetImage } from "@/lib/pet-image";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getHouseholdContextForRoute();
  if (!context) {
    return new Response(null, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  const { id } = await params;
  const pet = await prisma.pet.findFirst({
    where: { id, householdId: context.household.id },
    select: { householdId: true, profileImageFileName: true }
  });

  if (
    !pet ||
    !canServePetImage({
      currentHouseholdId: context.household.id,
      petHouseholdId: pet.householdId,
      fileName: pet.profileImageFileName
    })
  ) {
    return notFound();
  }

  try {
    const image = await readPetImage(context.household.id, pet.profileImageFileName!);
    return new Response(image, {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(image.byteLength),
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    // 物理ファイルの有無や読込失敗を権限外と区別せず、内部状態をレスポンスへ出さない。
    return notFound();
  }
}
