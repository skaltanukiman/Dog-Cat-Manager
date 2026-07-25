import type { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";

import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { toCsv } from "@/lib/csv";
import { isValidYearMonthInput, monthDateRange } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";
import {
  buildWeightCsvRows,
  parseWeightCsvExportOptions,
  WeightCsvExportValidationError
} from "@/lib/weight-csv-export";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const hamsterId = request.nextUrl.searchParams.get("hamsterId") || undefined;
  const month = request.nextUrl.searchParams.get("month") || undefined;

  try {
    const context = await getRequiredHouseholdContext();
    const exportOptions = parseWeightCsvExportOptions(request.nextUrl.searchParams);
    const where: Prisma.WeightRecordWhereInput = {
      hamster: {
        householdId: context.household.id
      }
    };

    // CSVエクスポートは画面と同じ絞り込み条件を受け取り、指定がなければ全ハムスター・全期間を対象にする。
    if (hamsterId) {
      where.hamsterId = hamsterId;
    }

    if (month && !isValidYearMonthInput(month)) {
      throw new WeightCsvExportValidationError("年月の指定が不正です。");
    }

    if (month) {
      const { start, end } = monthDateRange(month);
      where.recordDate = { gte: start, lt: end };
    }

    const records = await prisma.weightRecord.findMany({
      where,
      include: { hamster: true },
      orderBy: [{ recordDate: "asc" }, { createdAt: "asc" }]
    });

    const rows = buildWeightCsvRows(
      records,
      exportOptions.columns,
      exportOptions.timeZone,
      exportOptions.includeRequiredColumns
    );
    const fileParts = ["weight_records"];
    if (hamsterId) fileParts.push("filtered");
    if (month) fileParts.push(month);

    // Excelで日本語や日付列が扱いやすいよう、UTF-8 BOM付きのCSVとして返す。
    return new Response(`\uFEFF${toCsv(rows)}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileParts.join("_")}.csv"`
      }
    });
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof WeightCsvExportValidationError) {
      return new Response(error.message, {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    const errorId = logUnexpectedError(error, {
      operation: "weights.exportCsv",
      context: { hamsterId, month }
    });
    return new Response(`CSVの作成中にエラーが発生しました。\nエラーID: ${errorId}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
