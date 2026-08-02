"use server";

import { redirect } from "next/navigation";
import type { ZodIssue } from "zod";

import { belongsToCurrentHousehold } from "@/lib/authorization";
import { getRequiredHouseholdMutationContext } from "@/lib/auth-context";
import { activityActorName, createHouseholdActivity } from "@/lib/household-activity";
import { isFutureDateInput, isValidDateInput, isValidYearMonthInput, parseDateInput, toDateInputValue } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import {
  commitHouseholdMutation,
  getRealtimeActorId,
  publishHouseholdChangeSafely,
  updateHouseholdRevision
} from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import {
  createWeightRecordSchema,
  deleteWeightRecordsSchema,
  deleteWeightRecordSchema,
  updateWeightRecordSchema
} from "@/lib/schemas";
import { parseAppWeightCsvImport } from "@/lib/weight-csv-app-import";
import { parseWeightCsvImport, type WeightCsvImportIssue } from "@/lib/weight-csv-import";
import { handleServerActionError, isPrismaUniqueConstraintError, logUnexpectedError } from "@/lib/server-errors";
import { getWeightCsvFileSizeError } from "@/lib/weight-rules";

const WEIGHT_SORT_TARGETS = new Set(["registered", "date", "weight"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);

type WeightHistoryFilter = {
  filter?: string;
  month?: string;
  page?: number;
  sort?: string;
  direction?: string;
  includeInactive?: string;
  chartFrom?: string;
  chartTo?: string;
};

function weightValidationStatus(issues: ZodIssue[]) {
  const weightIssues = issues.filter((issue) => issue.path[0] === "weightG");

  return weightIssues.length > 0 && weightIssues.every((issue) => issue.message === "weightIncrement")
    ? "weightIncrement"
    : "invalid";
}

export type WeightCsvImportState = {
  hasResult: boolean;
  successCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: WeightCsvImportIssue[];
  message: string;
  errorType: "validation" | "system" | null;
  errorId?: string;
};

function weightCsvImportState({
  successCount = 0,
  updatedCount = 0,
  skippedCount = 0,
  errors = [],
  message,
  errorType,
  errorId
}: {
  successCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  errors?: WeightCsvImportIssue[];
  message: string;
  errorType?: "validation" | "system" | null;
  errorId?: string;
}): WeightCsvImportState {
  return {
    hasResult: true,
    successCount,
    updatedCount,
    skippedCount,
    errorCount: errors.length,
    errors,
    message,
    errorType: errorType ?? (errors.length > 0 ? "validation" : null),
    errorId
  };
}

function getWeightHistoryFilter(formData: FormData) {
  const filter = formData.get("filter");
  const month = formData.get("month");
  const page = formData.get("page");
  const sort = formData.get("sort");
  const direction = formData.get("direction");
  const includeInactive = formData.get("includeInactive");
  const chartFrom = formData.get("chartFrom");
  const chartTo = formData.get("chartTo");
  const pageNumber = typeof page === "string" && /^\d+$/.test(page) ? Number(page) : undefined;
  const historyFilter: WeightHistoryFilter = {};

  if (filter === "month") {
    historyFilter.filter = "month";

    if (typeof month === "string" && isValidYearMonthInput(month)) {
      historyFilter.month = month;
    }
  }

  if (pageNumber && pageNumber > 1) {
    historyFilter.page = pageNumber;
  }

  if (typeof sort === "string" && WEIGHT_SORT_TARGETS.has(sort)) {
    historyFilter.sort = sort;
  }

  if (typeof direction === "string" && SORT_DIRECTIONS.has(direction)) {
    historyFilter.direction = direction;
  }

  if (includeInactive === "1") {
    historyFilter.includeInactive = "1";
  }

  if (typeof chartFrom === "string" && isValidDateInput(chartFrom)) {
    historyFilter.chartFrom = chartFrom;
  }

  if (typeof chartTo === "string" && isValidDateInput(chartTo)) {
    historyFilter.chartTo = chartTo;
  }

  return historyFilter;
}

function weightRedirect(hamsterId: string, status: string, historyFilter: WeightHistoryFilter = {}) {
  const params = new URLSearchParams({
    hamsterId,
    status
  });

  if (historyFilter.filter) {
    params.set("filter", historyFilter.filter);
  }

  if (historyFilter.month) {
    params.set("month", historyFilter.month);
  }

  if (historyFilter.page && historyFilter.page > 1) {
    params.set("page", String(historyFilter.page));
  }

  if (historyFilter.sort) {
    params.set("sort", historyFilter.sort);
  }

  if (historyFilter.direction) {
    params.set("direction", historyFilter.direction);
  }

  if (historyFilter.includeInactive) {
    params.set("includeInactive", historyFilter.includeInactive);
  }

  if (historyFilter.chartFrom) {
    params.set("chartFrom", historyFilter.chartFrom);
  }

  if (historyFilter.chartTo) {
    params.set("chartTo", historyFilter.chartTo);
  }

  redirect(`/weights?${params.toString()}`);
}

async function ensureHamsterIsActive(hamsterId: string, householdId: string, historyFilter: WeightHistoryFilter = {}) {
  const hamster = await prisma.hamster.findUnique({
    where: { id: hamsterId },
    select: { householdId: true, isActive: true, name: true }
  });

  if (!hamster) {
    redirect("/weights?status=invalid");
  }

  // 体重登録はhamsterIdだけで届くため、所属家庭を照合して横取り更新を防ぐ。
  if (!belongsToCurrentHousehold(hamster.householdId, householdId)) {
    redirect("/weights?status=invalid");
  }

  if (!hamster.isActive) {
    weightRedirect(hamsterId, "locked", historyFilter);
  }
  return hamster;
}

async function getEditableWeightRecord(
  recordId: string,
  hamsterId: string,
  householdId: string,
  historyFilter: WeightHistoryFilter = {}
) {
  const record = await prisma.weightRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      hamsterId: true,
      recordDate: true,
      weightG: true,
      hamster: {
        select: {
          householdId: true,
          isActive: true,
          name: true
        }
      }
    }
  });

  if (!record || record.hamsterId !== hamsterId || !belongsToCurrentHousehold(record.hamster.householdId, householdId)) {
    redirect("/weights?status=invalid");
  }

  // 管理外のハムスターに紐づく履歴は、復活するまで編集・削除を受け付けない。
  if (!record.hamster.isActive) {
    weightRedirect(record.hamsterId, "locked", historyFilter);
  }

  return record;
}

export async function createWeightRecord(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/weights");
    const result = createWeightRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) redirect(`/weights?status=${weightValidationStatus(result.error.issues)}`);

    const historyFilter = getWeightHistoryFilter(formData);
    if (isFutureDateInput(result.data.recordDate)) weightRedirect(result.data.hamsterId, "future", historyFilter);
    const hamster = await ensureHamsterIsActive(result.data.hamsterId, context.household.id, historyFilter);

    const recordDate = parseDateInput(result.data.recordDate);
    const existingRecord = await prisma.weightRecord.findUnique({
      where: { hamsterId_recordDate: { hamsterId: result.data.hamsterId, recordDate } },
      select: { id: true }
    });
    if (existingRecord) weightRedirect(result.data.hamsterId, "duplicate", historyFilter);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "weight",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      mutate: (tx) =>
        tx.weightRecord.create({
          data: { hamsterId: result.data.hamsterId, recordDate, weightG: result.data.weightG }
        }),
      activity: (record) => ({
        eventType: "WEIGHT_CREATED",
        category: "CARE_RECORD",
        targetType: "WEIGHT_RECORD",
        targetId: record.id,
        targetNameSnapshot: hamster.name,
        details: { recordDate: result.data.recordDate, weightG: result.data.weightG }
      })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/" }, { path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "weights.create.revalidate", {
      householdId: context.household.id,
      hamsterId: result.data.hamsterId
    });
    weightRedirect(result.data.hamsterId, "saved", {
      filter: historyFilter.filter,
      month: historyFilter.month,
      sort: "registered",
      direction: "desc",
      includeInactive: historyFilter.includeInactive,
      chartFrom: historyFilter.chartFrom,
      chartTo: historyFilter.chartTo
    });
  } catch (error) {
    const hamsterId = formData.get("hamsterId");
    if (isPrismaUniqueConstraintError(error) && typeof hamsterId === "string") {
      weightRedirect(hamsterId, "duplicate", getWeightHistoryFilter(formData));
    }
    const params = new URLSearchParams();
    if (typeof hamsterId === "string") params.set("hamsterId", hamsterId);
    handleServerActionError(error, { operation: "weights.create", pathname: "/weights", searchParams: params });
  }
}

export async function updateWeightRecord(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/weights");
    const result = updateWeightRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) redirect(`/weights?status=${weightValidationStatus(result.error.issues)}`);

    const historyFilter = getWeightHistoryFilter(formData);
    if (isFutureDateInput(result.data.recordDate)) weightRedirect(result.data.hamsterId, "future", historyFilter);

    const record = await getEditableWeightRecord(result.data.id, result.data.hamsterId, context.household.id, historyFilter);
    const recordDate = parseDateInput(result.data.recordDate);
    if (toDateInputValue(record.recordDate) === result.data.recordDate && record.weightG === result.data.weightG) {
      weightRedirect(result.data.hamsterId, "unchanged", historyFilter);
    }

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "weight",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      activity: {
        eventType: "WEIGHT_UPDATED",
        category: "CARE_RECORD",
        targetType: "WEIGHT_RECORD",
        targetId: record.id,
        targetNameSnapshot: record.hamster.name,
        details: {
          previousWeightG: record.weightG,
          newWeightG: result.data.weightG,
          previousRecordDate: toDateInputValue(record.recordDate),
          newRecordDate: result.data.recordDate
        }
      },
      mutate: (tx) =>
        tx.weightRecord.update({
          where: { id: result.data.id },
          data: { recordDate, weightG: result.data.weightG }
        })
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/" }, { path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "weights.update.revalidate", {
      householdId: context.household.id,
      hamsterId: result.data.hamsterId
    });
    weightRedirect(result.data.hamsterId, "updated", historyFilter);
  } catch (error) {
    const hamsterId = formData.get("hamsterId");
    if (isPrismaUniqueConstraintError(error) && typeof hamsterId === "string") {
      weightRedirect(hamsterId, "duplicate", getWeightHistoryFilter(formData));
    }
    const params = new URLSearchParams();
    if (typeof hamsterId === "string") params.set("hamsterId", hamsterId);
    handleServerActionError(error, { operation: "weights.update", pathname: "/weights", searchParams: params });
  }
}

export async function deleteWeightRecord(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/weights");
    const result = deleteWeightRecordSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) redirect("/weights?status=invalid");
    const historyFilter = getWeightHistoryFilter(formData);
    const record = await getEditableWeightRecord(result.data.id, result.data.hamsterId, context.household.id, historyFilter);

    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "weight",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      activity: {
        eventType: "WEIGHT_DELETED",
        category: "CARE_RECORD",
        targetType: "WEIGHT_RECORD",
        targetId: record.id,
        targetNameSnapshot: record.hamster.name,
        details: { recordDate: toDateInputValue(record.recordDate), weightG: record.weightG }
      },
      mutate: async (tx) => {
        const deleted = await tx.weightRecord.deleteMany({
          where: { id: result.data.id, hamsterId: result.data.hamsterId }
        });
        if (deleted.count !== 1) redirect("/weights?status=invalid");
      }
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/" }, { path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "weights.delete.revalidate", {
      householdId: context.household.id,
      hamsterId: result.data.hamsterId
    });
    weightRedirect(result.data.hamsterId, "deleted", historyFilter);
  } catch (error) {
    const hamsterId = formData.get("hamsterId");
    const params = new URLSearchParams();
    if (typeof hamsterId === "string") params.set("hamsterId", hamsterId);
    handleServerActionError(error, { operation: "weights.delete", pathname: "/weights", searchParams: params });
  }
}

export async function deleteWeightRecords(formData: FormData) {
  try {
    const context = await getRequiredHouseholdMutationContext("/weights");
    const result = deleteWeightRecordsSchema.safeParse({
      ids: formData.getAll("ids"),
      hamsterId: formData.get("hamsterId")
    });
    if (!result.success) redirect("/weights?status=invalid");

    const historyFilter = getWeightHistoryFilter(formData);
    const hamster = await ensureHamsterIsActive(result.data.hamsterId, context.household.id, historyFilter);
    const { change } = await commitHouseholdMutation({
      householdId: context.household.id,
      source: "weight",
      actorClientId: getRealtimeActorId(formData),
      actorUserId: context.user.id,
      actorNameSnapshot: activityActorName(context.user),
      activity: {
        eventType: "WEIGHTS_BULK_DELETED",
        category: "CARE_RECORD",
        targetType: "HAMSTER",
        targetId: result.data.hamsterId,
        targetNameSnapshot: hamster.name,
        details: { count: result.data.ids.length }
      },
      mutate: async (tx) => {
        const deleted = await tx.weightRecord.deleteMany({
          where: { id: { in: result.data.ids }, hamsterId: result.data.hamsterId }
        });
        // 一部だけ対象外・削除済みなら全体をロールバックし、選択件数との不一致を残さない。
        if (deleted.count !== result.data.ids.length) redirect("/weights?status=invalid");
      }
    });
    publishHouseholdChangeSafely(change);
    revalidatePathsSafely([{ path: "/" }, { path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "weights.deleteMany.revalidate", {
      householdId: context.household.id,
      hamsterId: result.data.hamsterId,
      targetCount: result.data.ids.length
    });
    weightRedirect(result.data.hamsterId, "deleted", historyFilter);
  } catch (error) {
    const hamsterId = formData.get("hamsterId");
    const params = new URLSearchParams();
    if (typeof hamsterId === "string") params.set("hamsterId", hamsterId);
    handleServerActionError(error, { operation: "weights.deleteMany", pathname: "/weights", searchParams: params });
  }
}

/**
 * 外部体重計形式のCSVから、登録可能な行だけを新規取込するServer Action。
 *
 * 行ごとの検証エラーは他の有効行を妨げず、DB既存行とCSV内重複はskipとして集計する。
 * 作成が1件以上ある場合だけ操作履歴とrevisionを更新する。
 */
export async function importGasWeightRecordsCsv(
  _previousState: WeightCsvImportState,
  formData: FormData
): Promise<WeightCsvImportState> {
  let householdId: string | undefined;
  try {
    const context = await getRequiredHouseholdMutationContext("/weights/import/gas");
    householdId = context.household.id;
    const csvFile = formData.get("csvFile");
    if (!(csvFile instanceof File) || csvFile.size === 0) {
      return weightCsvImportState({
        errors: [{ lineNumber: 0, message: "CSVファイルを選択してください。" }],
        message: "CSVインポートに失敗しました。"
      });
    }
    const fileSizeError = getWeightCsvFileSizeError(csvFile.size);
    if (fileSizeError) {
      return weightCsvImportState({
        errors: [{ lineNumber: 0, message: fileSizeError }],
        message: "CSVインポートに失敗しました。"
      });
    }

    const parsed = parseWeightCsvImport(await csvFile.text());
    const errors: WeightCsvImportIssue[] = [...parsed.errors];
    if (parsed.rows.length === 0) {
      return weightCsvImportState({
        errors,
        message: errors.length > 0 ? "登録できる行がありませんでした。" : "CSVに登録対象の行がありませんでした。"
      });
    }

    const hamsters = await prisma.hamster.findMany({
      where: { householdId: context.household.id },
      select: { id: true, name: true, isActive: true }
    });
    const hamsterByName = new Map(hamsters.map((hamster) => [hamster.name, hamster]));
    const importCandidates: Array<{
      hamsterId: string;
      recordDate: Date;
      recordDateInput: string;
      weightG: number;
    }> = [];
    for (const row of parsed.rows) {
      const hamster = hamsterByName.get(row.hamsterName);
      if (!hamster) {
        errors.push({ lineNumber: row.lineNumber, message: `ハムスター「${row.hamsterName}」が登録されていません。` });
      } else if (!hamster.isActive) {
        errors.push({ lineNumber: row.lineNumber, message: `ハムスター「${row.hamsterName}」は管理外のため登録できません。` });
      } else {
        importCandidates.push({
          hamsterId: hamster.id,
          recordDate: row.recordDate,
          recordDateInput: row.recordDateInput,
          weightG: row.weightG
        });
      }
    }
    if (importCandidates.length === 0) {
      return weightCsvImportState({ errors, message: "登録できる行がありませんでした。" });
    }

    const actorClientId = getRealtimeActorId(formData);
    const transactionResult = await prisma.$transaction(async (tx) => {
      const hamsterIds = [...new Set(importCandidates.map((row) => row.hamsterId))];
      const recordDates = [...new Set(importCandidates.map((row) => row.recordDateInput))].map(parseDateInput);
      const existingRecords = await tx.weightRecord.findMany({
        where: { hamsterId: { in: hamsterIds }, recordDate: { in: recordDates } },
        select: { hamsterId: true, recordDate: true }
      });
      // DB既存行とCSV内重複を同じキーで除外し、同じ個体・測定日の一意性を保つ。
      const existingKeys = new Set(
        existingRecords.map((record) => `${record.hamsterId}:${toDateInputValue(record.recordDate)}`)
      );
      const csvKeys = new Set<string>();
      const createRows: Array<{ hamsterId: string; recordDate: Date; weightG: number }> = [];
      let skippedCount = 0;
      for (const row of importCandidates) {
        const key = `${row.hamsterId}:${row.recordDateInput}`;
        if (existingKeys.has(key) || csvKeys.has(key)) {
          skippedCount++;
        } else {
          csvKeys.add(key);
          createRows.push({ hamsterId: row.hamsterId, recordDate: row.recordDate, weightG: row.weightG });
        }
      }
      const created =
        createRows.length > 0
          ? await tx.weightRecord.createMany({ data: createRows, skipDuplicates: true })
          : { count: 0 };
      skippedCount += createRows.length - created.count;
      const change =
        created.count > 0
          ? await (async () => {
              await createHouseholdActivity(tx, {
                householdId: context.household.id,
                actorUserId: context.user.id,
                actorNameSnapshot: activityActorName(context.user),
                eventType: "WEIGHT_CSV_GAS_IMPORTED",
                category: "CARE_RECORD",
                targetType: "WEIGHT_IMPORT",
                details: { createdCount: created.count, updatedCount: 0, skippedCount }
              });
              return updateHouseholdRevision(tx, context.household.id, "weight", actorClientId, context.user.id);
            })()
          : null;
      return { successCount: created.count, skippedCount, change };
    });

    if (transactionResult.change) publishHouseholdChangeSafely(transactionResult.change);
    revalidatePathsSafely([{ path: "/" }, { path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "weights.importCsv.revalidate", {
      householdId: context.household.id
    });
    return weightCsvImportState({
      successCount: transactionResult.successCount,
      skippedCount: transactionResult.skippedCount,
      errors,
      message: "CSVインポートが完了しました。"
    });
  } catch (error) {
    const errorId = logUnexpectedError(error, {
      operation: "weights.importGasCsv",
      context: { householdId }
    });
    return weightCsvImportState({
      errors: [{ lineNumber: 0, message: "システムエラーのためCSVを取り込めませんでした。" }],
      message: "CSVインポートに失敗しました。",
      errorType: "system",
      errorId
    });
  }
}

/**
 * アプリ出力形式のCSVを、新規追加と既存更新を含む一括編集として適用するServer Action。
 *
 * 1行でも不正・競合があれば部分適用せず全件を差し戻す。全検証通過後に変更行と
 * 操作履歴、revisionを同一transactionで確定する。
 */
export async function importAppWeightRecordsCsv(
  _previousState: WeightCsvImportState,
  formData: FormData
): Promise<WeightCsvImportState> {
  let householdId: string | undefined;
  try {
    const context = await getRequiredHouseholdMutationContext("/weights/import/app");
    householdId = context.household.id;
    const csvFile = formData.get("csvFile");
    if (!(csvFile instanceof File) || csvFile.size === 0) {
      return weightCsvImportState({
        errors: [{ lineNumber: 0, message: "CSVファイルを選択してください。" }],
        message: "CSV一括編集に失敗しました。"
      });
    }
    const fileSizeError = getWeightCsvFileSizeError(csvFile.size);
    if (fileSizeError) {
      return weightCsvImportState({
        errors: [{ lineNumber: 0, message: fileSizeError }],
        message: "CSV一括編集に失敗しました。"
      });
    }

    const parsed = parseAppWeightCsvImport(await csvFile.text());
    const errors: WeightCsvImportIssue[] = [...parsed.errors];
    // アプリ版は一括編集用途のため、1行でも不正なら部分適用せず全件を差し戻す。
    if (parsed.rows.length === 0 || errors.length > 0) {
      return weightCsvImportState({
        errors,
        message:
          errors.length > 0
            ? "CSVのエラーを修正してから再度インポートしてください。"
            : "CSVに一括編集対象の行がありませんでした。"
      });
    }

    const hamsters = await prisma.hamster.findMany({
      where: { householdId: context.household.id },
      select: { id: true, name: true, isActive: true }
    });
    const hamsterByName = new Map(hamsters.map((hamster) => [hamster.name, hamster]));
    const requestedRecordIds = [...new Set(parsed.rows.map((row) => row.recordId).filter(Boolean))];
    const existingRecords = await prisma.weightRecord.findMany({
      where: { id: { in: requestedRecordIds }, hamster: { householdId: context.household.id } },
      select: {
        id: true,
        hamsterId: true,
        recordDate: true,
        weightG: true,
        hamster: { select: { isActive: true } }
      }
    });
    const existingById = new Map(existingRecords.map((record) => [record.id, record]));
    const seenRecordIds = new Set<string>();
    const seenDestinationKeys = new Set<string>();
    const candidates: Array<{
      lineNumber: number;
      recordId: string;
      hamsterId: string;
      recordDate: Date;
      recordDateInput: string;
      weightG: number;
    }> = [];

    for (const row of parsed.rows) {
      if (row.recordId && seenRecordIds.has(row.recordId)) {
        errors.push({ lineNumber: row.lineNumber, message: `record_id「${row.recordId}」がCSV内で重複しています。` });
        continue;
      }
      if (row.recordId) seenRecordIds.add(row.recordId);

      const hamster = hamsterByName.get(row.hamsterName);
      if (!hamster) {
        errors.push({ lineNumber: row.lineNumber, message: `ハムスター「${row.hamsterName}」が登録されていません。` });
        continue;
      }
      if (!hamster.isActive) {
        errors.push({ lineNumber: row.lineNumber, message: `ハムスター「${row.hamsterName}」は管理外のため編集できません。` });
        continue;
      }

      const existingRecord = row.recordId ? existingById.get(row.recordId) : undefined;
      if (row.recordId && !existingRecord) {
        errors.push({
          lineNumber: row.lineNumber,
          message: `record_id「${row.recordId}」の記録が現在のHouseholdに存在しません。`
        });
        continue;
      }
      if (existingRecord && !existingRecord.hamster.isActive) {
        errors.push({ lineNumber: row.lineNumber, message: "管理外ハムスターの既存記録は編集できません。" });
        continue;
      }

      const destinationKey = `${hamster.id}:${row.recordDateInput}`;
      if (seenDestinationKeys.has(destinationKey)) {
        errors.push({
          lineNumber: row.lineNumber,
          message: `ハムスター「${row.hamsterName}」の${row.recordDateInput}がCSV内で重複しています。`
        });
        continue;
      }
      seenDestinationKeys.add(destinationKey);
      candidates.push({
        lineNumber: row.lineNumber,
        recordId: row.recordId,
        hamsterId: hamster.id,
        recordDate: row.recordDate,
        recordDateInput: row.recordDateInput,
        weightG: row.weightG
      });
    }

    if (errors.length > 0) {
      return weightCsvImportState({ errors, message: "CSVのエラーを修正してから再度インポートしてください。" });
    }

    const destinationHamsterIds = [...new Set(candidates.map((row) => row.hamsterId))];
    const destinationDates = [...new Set(candidates.map((row) => row.recordDateInput))].map(parseDateInput);
    const occupiedRecords = await prisma.weightRecord.findMany({
      where: {
        hamsterId: { in: destinationHamsterIds },
        recordDate: { in: destinationDates },
        hamster: { householdId: context.household.id }
      },
      select: { id: true, hamsterId: true, recordDate: true }
    });
    const occupiedByKey = new Map(
      occupiedRecords.map((record) => [`${record.hamsterId}:${toDateInputValue(record.recordDate)}`, record.id])
    );
    for (const row of candidates) {
      const occupiedRecordId = occupiedByKey.get(`${row.hamsterId}:${row.recordDateInput}`);
      if (occupiedRecordId && occupiedRecordId !== row.recordId) {
        errors.push({
          lineNumber: row.lineNumber,
          message: "変更先のハムスター・測定日には別の体重記録があります。"
        });
      }
    }
    if (errors.length > 0) {
      return weightCsvImportState({ errors, message: "CSVのエラーを修正してから再度インポートしてください。" });
    }

    const createRows = candidates.filter((row) => !row.recordId);
    const updateRows = candidates.filter((row) => {
      if (!row.recordId) return false;
      const existing = existingById.get(row.recordId);
      return (
        existing !== undefined &&
        (existing.hamsterId !== row.hamsterId ||
          toDateInputValue(existing.recordDate) !== row.recordDateInput ||
          existing.weightG !== row.weightG)
      );
    });
    const skippedCount = candidates.length - createRows.length - updateRows.length;
    const actorClientId = getRealtimeActorId(formData);
    const transactionResult = await prisma.$transaction(async (tx) => {
      for (const row of updateRows) {
        await tx.weightRecord.update({
          where: { id: row.recordId },
          data: { hamsterId: row.hamsterId, recordDate: row.recordDate, weightG: row.weightG }
        });
      }
      const created =
        createRows.length > 0
          ? await tx.weightRecord.createMany({
              data: createRows.map((row) => ({
                hamsterId: row.hamsterId,
                recordDate: row.recordDate,
                weightG: row.weightG
              }))
            })
          : { count: 0 };
      const changeCount = created.count + updateRows.length;
      const change =
        changeCount > 0
          ? await (async () => {
              await createHouseholdActivity(tx, {
                householdId: context.household.id,
                actorUserId: context.user.id,
                actorNameSnapshot: activityActorName(context.user),
                eventType: "WEIGHT_CSV_APP_IMPORTED",
                category: "CARE_RECORD",
                targetType: "WEIGHT_IMPORT",
                details: { createdCount: created.count, updatedCount: updateRows.length, skippedCount }
              });
              return updateHouseholdRevision(tx, context.household.id, "weight", actorClientId, context.user.id);
            })()
          : null;
      return { createdCount: created.count, updatedCount: updateRows.length, change };
    });

    if (transactionResult.change) publishHouseholdChangeSafely(transactionResult.change);
    revalidatePathsSafely([{ path: "/" }, { path: "/weights" }, { path: "/settings/members" }, { path: "/settings/members/activity" }], "weights.importAppCsv.revalidate", {
      householdId: context.household.id
    });
    return weightCsvImportState({
      successCount: transactionResult.createdCount,
      updatedCount: transactionResult.updatedCount,
      skippedCount,
      message:
        transactionResult.createdCount + transactionResult.updatedCount > 0
          ? "アプリ版CSVの一括編集が完了しました。"
          : "CSVの内容に変更はありませんでした。"
    });
  } catch (error) {
    const errorId = logUnexpectedError(error, {
      operation: "weights.importAppCsv",
      context: { householdId }
    });
    return weightCsvImportState({
      errors: [{ lineNumber: 0, message: "システムエラーのためCSVを取り込めませんでした。" }],
      message: "CSV一括編集に失敗しました。",
      errorType: "system",
      errorId
    });
  }
}
