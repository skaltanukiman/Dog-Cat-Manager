import type { HouseholdActivityEvent, PetRecordType, Prisma } from "@prisma/client";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ZodIssue } from "zod";

import { canEditHouseholdSharedData } from "@/lib/authorization";
import { toDateInputValue } from "@/lib/date";
import {
  normalizePetRecordDateFilter,
  normalizePetRecordKeyword,
  normalizePetRecordPage,
  normalizePetRecordScope,
  normalizePetRecordTypeFilter,
  petRecordsUrl
} from "@/lib/pet-records";
import { publishHouseholdChangeSafely, type CommittedHouseholdChange } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { logUnexpectedError } from "@/lib/server-errors";

export class PetRecordMutationForbiddenError extends Error {}
export class PetRecordNotFoundError extends Error {}
export class PetRecordHouseholdBoundaryError extends Error {}
export class InactivePetRecordMutationError extends Error {}
export class PetRecordConflictError extends Error {}

export type PetRecordCreateActionResult =
  | { success: true }
  | {
      success: false;
      errorMessage: string;
      errorId?: string;
      field?: "petIds";
    };

export type SavedMemoryTagDeleteActionResult =
  | { success: true; deletedCount: number }
  | { success: false; errorMessage: string; errorId?: string };

export type PetRecordCreateErrorStatus =
  | "invalid"
  | "invalidDate"
  | "invalidTime"
  | "future"
  | "futureTime"
  | "feeInvalid"
  | "viewerForbidden"
  | "petInvalid"
  | "householdInvalid"
  | "locked"
  | "imageTooLarge"
  | "imageUnsupported"
  | "imageInvalid";

const CREATE_ERROR_MESSAGES: Record<PetRecordCreateErrorStatus, string> = {
  invalid: "入力内容を確認してください。",
  invalidDate: "日付を確認してください。",
  invalidTime: "時刻を確認してください。",
  future: "未来日には記録できません。",
  futureTime: "未来の時刻には記録できません。",
  feeInvalid: "診察費は0円以上の整数で入力してください。",
  viewerForbidden: "閲覧者は記録を変更できません。",
  petInvalid: "対象のPetを確認してください。",
  householdInvalid: "対象の共有グループを確認してください。",
  locked: "管理終了したPetの記録は変更できません。管理中に戻してから操作してください。",
  imageTooLarge: "思い出の写真は10MB以内で選択してください。",
  imageUnsupported: "思い出の写真はJPEG、PNG、WebP形式を選択してください。",
  imageInvalid: "思い出の写真を処理できませんでした。別の画像を選択してください。"
};

export function petRecordCreateError(
  status: PetRecordCreateErrorStatus,
  field?: "petIds"
): PetRecordCreateActionResult {
  return {
    success: false,
    errorMessage: CREATE_ERROR_MESSAGES[status],
    ...(field ? { field } : {})
  };
}

export function petRecordValidationStatus(issues: ZodIssue[]): PetRecordCreateErrorStatus {
  if (issues.some((issue) => issue.path[0] === "consultationFee")) return "feeInvalid";
  if (
    issues.some(
      (issue) => issue.path[0] === "recordDate" || issue.path[0] === "nextVisitDate" || issue.path[0] === "nextDueDate"
    )
  ) {
    return "invalidDate";
  }
  if (issues.some((issue) => issue.path[0] === "recordTime")) return "invalidTime";
  return "invalid";
}

export function knownPetRecordCreateError(error: unknown, field?: "petIds"): PetRecordCreateActionResult | null {
  if (error instanceof PetRecordMutationForbiddenError) return petRecordCreateError("viewerForbidden");
  if (error instanceof InactivePetRecordMutationError) return petRecordCreateError("locked", field);
  if (error instanceof PetRecordHouseholdBoundaryError) return petRecordCreateError("householdInvalid", field);
  if (error instanceof PetRecordNotFoundError) return petRecordCreateError("petInvalid", field);
  return null;
}

export function unexpectedPetRecordCreateError(
  error: unknown,
  operation: string,
  petId: FormDataEntryValue | null
): PetRecordCreateActionResult {
  unstable_rethrow(error);
  const errorId = logUnexpectedError(error, {
    operation,
    context: { petId: typeof petId === "string" ? petId : undefined }
  });
  return {
    success: false,
    errorMessage: "処理に失敗しました。時間を空けて再度お試しください。",
    errorId
  };
}

export function parsePetHealthRecordForm(formData: FormData) {
  return { ...Object.fromEntries(formData), symptoms: formData.getAll("symptoms") };
}

export function parsePetMemoryRecordForm(formData: FormData) {
  return { ...Object.fromEntries(formData), petIds: formData.getAll("petIds") };
}

/**
 * Mutation後の戻り先を`/records`へ固定し、画面から渡された一覧条件だけを正規化して復元する。
 * hidden入力は改変され得るため、そのままredirect先やクエリ文字列として採用しない。
 */
export function petRecordReturnUrl(
  petId: string | null | undefined,
  status?: string,
  formData?: FormData,
  errorId?: string
) {
  const scopeValue = formData?.get("viewScope") ?? formData?.get("scope");
  const returnPetIdValue = formData?.get("returnPetId");
  const includeInactiveValue = formData?.get("includeInactive");
  const returnTypeValue = formData?.get("returnType");
  const returnFromValue = formData?.get("returnFrom");
  const returnToValue = formData?.get("returnTo");
  const returnKeywordValue = formData?.get("returnKeyword");
  const returnFavoriteValue = formData?.get("returnFavorite");
  const returnPageValue = formData?.get("returnPage");
  const returnPetId =
    typeof returnPetIdValue === "string" && returnPetIdValue.trim() ? returnPetIdValue.trim() : petId;
  const returnType = normalizePetRecordTypeFilter(
    typeof returnTypeValue === "string" ? returnTypeValue : undefined
  );
  return petRecordsUrl({
    scope: normalizePetRecordScope(typeof scopeValue === "string" ? scopeValue : undefined),
    includeScope: true,
    petId: returnPetId,
    includeInactive: includeInactiveValue === "1" || includeInactiveValue === "true" || includeInactiveValue === "on",
    type: returnType,
    from: normalizePetRecordDateFilter(typeof returnFromValue === "string" ? returnFromValue : undefined),
    to: normalizePetRecordDateFilter(typeof returnToValue === "string" ? returnToValue : undefined),
    keyword: normalizePetRecordKeyword(
      typeof returnKeywordValue === "string" ? returnKeywordValue : undefined
    ),
    favoriteOnly:
      (returnType === "all" || returnType === "memory") &&
      (returnFavoriteValue === "1" || returnFavoriteValue === "true" || returnFavoriteValue === "on"),
    page: normalizePetRecordPage(typeof returnPageValue === "string" ? returnPageValue : undefined),
    status,
    errorId
  });
}

export function petRecordReturnSearchParams(petId: string | null | undefined, formData: FormData) {
  return new URL(petRecordReturnUrl(petId, undefined, formData), "http://localhost").searchParams;
}

export function redirectKnownPetRecordMutationError(
  error: unknown,
  petId: string | null | undefined,
  formData: FormData
): void {
  if (error instanceof PetRecordMutationForbiddenError) {
    redirect(petRecordReturnUrl(petId, "viewerForbidden", formData));
  }
  if (error instanceof InactivePetRecordMutationError) {
    redirect(petRecordReturnUrl(petId, "petRecordLocked", formData));
  }
  if (error instanceof PetRecordConflictError) {
    redirect(petRecordReturnUrl(petId, "petRecordConflict", formData));
  }
  if (error instanceof PetRecordHouseholdBoundaryError) {
    redirect(petRecordReturnUrl(petId, "petRecordHouseholdInvalid", formData));
  }
  if (error instanceof PetRecordNotFoundError) {
    redirect(petRecordReturnUrl(petId, "petRecordPetInvalid", formData));
  }
}

/** 画面表示後の権限変更とDemo状態を、業務更新と同じtransactionで再検証する。 */
export async function assertCurrentPetRecordMutationPermission(
  tx: Prisma.TransactionClient,
  householdId: string,
  userId: string
) {
  const membership = await tx.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
    select: { role: true, household: { select: { isDemo: true } } }
  });
  if (!membership || !canEditHouseholdSharedData(membership.role) || membership.household.isDemo) {
    throw new PetRecordMutationForbiddenError();
  }
}

/** 全IDが現在Householdの管理中Petであることを、並び順を保持したまま確認する。 */
export async function getActiveMutationPets(
  tx: Prisma.TransactionClient,
  petIds: readonly string[],
  householdId: string
) {
  const uniquePetIds = [...new Set(petIds)];
  const pets = await tx.pet.findMany({
    where: { id: { in: uniquePetIds }, householdId },
    select: { id: true, name: true, isActive: true }
  });
  if (pets.length !== uniquePetIds.length) throw new PetRecordHouseholdBoundaryError();
  if (pets.some((pet) => !pet.isActive)) throw new InactivePetRecordMutationError();
  const byId = new Map(pets.map((pet) => [pet.id, pet]));
  return uniquePetIds.map((petId) => byId.get(petId)!);
}

/** フォーム表示時のupdatedAtと現在値を照合し、種類偽装と古い画面からの更新を拒否する。 */
export async function assertExpectedPetRecordVersion(
  tx: Prisma.TransactionClient,
  recordId: string,
  expectedUpdatedAt: Date,
  householdId: string,
  expectedType: PetRecordType
) {
  const record = await tx.petRecord.findFirst({
    where: { id: recordId, recordType: expectedType, pet: { householdId } },
    select: { updatedAt: true }
  });
  if (!record) throw new PetRecordNotFoundError();
  if (record.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new PetRecordConflictError();
}

export const PET_RECORD_ACTIVITY_METADATA: Record<
  PetRecordType,
  {
    targetType: string;
    created: HouseholdActivityEvent;
    updated: HouseholdActivityEvent;
    deleted: HouseholdActivityEvent;
  }
> = {
  HEALTH: {
    targetType: "PET_HEALTH_RECORD",
    created: "PET_HEALTH_RECORD_CREATED",
    updated: "PET_HEALTH_RECORD_UPDATED",
    deleted: "PET_HEALTH_RECORD_DELETED"
  },
  MEDICAL: {
    targetType: "PET_MEDICAL_RECORD",
    created: "PET_MEDICAL_RECORD_CREATED",
    updated: "PET_MEDICAL_RECORD_UPDATED",
    deleted: "PET_MEDICAL_RECORD_DELETED"
  },
  MEDICATION: {
    targetType: "PET_MEDICATION_RECORD",
    created: "PET_MEDICATION_RECORD_CREATED",
    updated: "PET_MEDICATION_RECORD_UPDATED",
    deleted: "PET_MEDICATION_RECORD_DELETED"
  },
  VACCINATION: {
    targetType: "PET_VACCINATION_RECORD",
    created: "PET_VACCINATION_RECORD_CREATED",
    updated: "PET_VACCINATION_RECORD_UPDATED",
    deleted: "PET_VACCINATION_RECORD_DELETED"
  },
  MEMORY: {
    targetType: "PET_MEMORY_RECORD",
    created: "PET_MEMORY_RECORD_CREATED",
    updated: "PET_MEMORY_RECORD_UPDATED",
    deleted: "PET_MEMORY_RECORD_DELETED"
  }
};

/** 健康・医療本文を複製せず、利用者向け履歴には記録日だけを渡す。 */
export function petRecordActivity(
  operation: "created" | "updated" | "deleted",
  record: { id: string; recordType: PetRecordType; recordDate: Date; pet: { name: string } }
) {
  const metadata = PET_RECORD_ACTIVITY_METADATA[record.recordType];
  return {
    eventType: metadata[operation],
    category: "CARE_RECORD" as const,
    targetType: metadata.targetType,
    targetId: record.id,
    targetNameSnapshot: record.pet.name,
    details: { recordDate: toDateInputValue(record.recordDate) }
  };
}

export function publishAndRevalidatePetRecord(
  change: CommittedHouseholdChange,
  householdId: string,
  operation: string,
  recordId?: string
) {
  publishHouseholdChangeSafely(change);
  revalidatePathsSafely(
    [{ path: "/records" }, { path: "/settings/members" }, { path: "/settings/members/activity" }],
    `${operation}.revalidate`,
    { householdId, recordId }
  );
}
