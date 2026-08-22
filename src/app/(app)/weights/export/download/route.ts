import { NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { getRequiredHouseholdContext } from "@/lib/auth-context";
import {
  createPetWeightCsvRecordWhere,
  getPetWeightCsvFilename,
  parsePetWeightCsvExportOptions,
  PetWeightCsvExportValidationError,
  toPetWeightCsv
} from "@/lib/pet-weight-csv-export";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedPetId = request.nextUrl.searchParams.get("petId") || undefined;
  const requestedMonth = request.nextUrl.searchParams.get("month") || undefined;

  try {
    const context = await getRequiredHouseholdContext();
    const { petId, month, format } = parsePetWeightCsvExportOptions(request.nextUrl.searchParams);
    if (petId) {
      // Household外のIDも同じ結果にして、存在有無や所属を推測できないようにする。
      const pet = await prisma.pet.findFirst({
        where: { id: petId, householdId: context.household.id },
        select: { id: true }
      });
      if (!pet) throw new PetWeightCsvExportValidationError("指定したPetが見つかりません。");
    }

    const where = createPetWeightCsvRecordWhere(context.household.id, petId, month);

    const records = await prisma.petWeightRecord.findMany({
      where,
      include: { pet: { select: { id: true, name: true, species: true } } },
      orderBy: [{ recordDate: "asc" }, { petId: "asc" }, { id: "asc" }]
    });

    return new Response(toPetWeightCsv(records, format), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${getPetWeightCsvFilename(month, format)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof PetWeightCsvExportValidationError) {
      return new Response(error.message, {
        status: 400,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    const errorId = logUnexpectedError(error, {
      operation: "petWeights.exportCsv",
      context: { petId: requestedPetId, month: requestedMonth }
    });
    return new Response(`CSVの作成中にエラーが発生しました。\nエラーID: ${errorId}`, {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
}
