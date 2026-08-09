import { createHash, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { toDateInputValue } from "@/lib/date";
import { setTodayFeedingState } from "@/lib/feeding";
import type { HouseholdActivityCreateInput } from "@/lib/household-activity";
import {
  commitHouseholdMutation,
  type TransactionExecutor
} from "@/lib/realtime";
import { setTodayWaterReplacementState } from "@/lib/water-replacement";

export const DEVICE_CARE_ACTOR_NAME = "Picoボタン";
export const MAX_DEVICE_CARE_REQUEST_BYTES = 1024;

export const deviceCareRequestSchema = z
  .object({
    hamsterId: z.string().trim().min(1).max(128),
    careType: z.enum(["feeding", "waterReplacement"])
  })
  .strict();

export type DeviceCareRequest = z.infer<typeof deviceCareRequestSchema>;

export type DeviceCareConfiguration = {
  token: string;
  householdId: string;
};

type DeviceCareEnvironment = {
  DEVICE_CARE_API_TOKEN?: string;
  DEVICE_CARE_HOUSEHOLD_ID?: string;
};

export type DeviceCareErrorCode = "configurationUnavailable" | "targetNotFound" | "targetInactive";

export class DeviceCareError extends Error {
  constructor(readonly code: DeviceCareErrorCode) {
    super(code);
    this.name = "DeviceCareError";
  }
}

/**
 * デバイスAPIの必須設定を読み取り、十分な長さのtokenと固定Householdが揃う場合だけ返す。
 *
 * 設定不備時は認証を試みずAPIを停止するため、token本体は戻り値以外へ出力しない。
 */
export function getDeviceCareConfiguration(
  env: DeviceCareEnvironment = {
    DEVICE_CARE_API_TOKEN: process.env.DEVICE_CARE_API_TOKEN,
    DEVICE_CARE_HOUSEHOLD_ID: process.env.DEVICE_CARE_HOUSEHOLD_ID
  }
): DeviceCareConfiguration | null {
  const token = env.DEVICE_CARE_API_TOKEN?.trim() ?? "";
  const householdId = env.DEVICE_CARE_HOUSEHOLD_ID?.trim() ?? "";

  if (token.length < 32 || token.length > 512 || householdId.length === 0 || householdId.length > 128) {
    return null;
  }

  return { token, householdId };
}

/**
 * AuthorizationヘッダーのBearer tokenを、長さが一定のdigest同士で比較する。
 *
 * 元tokenをログや例外メッセージへ含めず、比較前の長さによる差も避ける。
 */
export function isValidDeviceCareAuthorization(
  authorization: string | null,
  expectedToken: string
) {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return false;

  const actualDigest = createHash("sha256").update(match[1], "utf8").digest();
  const expectedDigest = createHash("sha256").update(expectedToken, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

type DeviceCareMutationResult = {
  changed: boolean;
  recordDate: Date;
  hamsterName: string;
};

function createDeviceCareCommitInput(
  configuration: DeviceCareConfiguration,
  request: DeviceCareRequest,
  now: Date
) {
  const source = request.careType === "feeding" ? "feeding" : "waterReplacement";

  return {
    householdId: configuration.householdId,
    source,
    actorClientId: null,
    actorUserId: null,
    actorNameSnapshot: DEVICE_CARE_ACTOR_NAME,
    mutate: async (tx: Prisma.TransactionClient): Promise<DeviceCareMutationResult> => {
      const [household, hamster] = await Promise.all([
        tx.household.findUnique({
          where: { id: configuration.householdId },
          select: { careDayStartMinutes: true, isDemo: true }
        }),
        tx.hamster.findFirst({
          where: { id: request.hamsterId, householdId: configuration.householdId },
          select: { isActive: true, name: true }
        })
      ]);

      // demoと存在しないHouseholdは、クライアントではなくサーバー設定不備として扱う。
      if (!household || household.isDemo) {
        throw new DeviceCareError("configurationUnavailable");
      }
      if (!hamster) {
        throw new DeviceCareError("targetNotFound");
      }
      if (!hamster.isActive) {
        throw new DeviceCareError("targetInactive");
      }

      const mutation =
        request.careType === "feeding"
          ? await setTodayFeedingState(tx, {
              hamsterId: request.hamsterId,
              createdByUserId: null,
              state: "marked",
              now,
              careDayStartMinutes: household.careDayStartMinutes
            })
          : await setTodayWaterReplacementState(tx, {
              hamsterId: request.hamsterId,
              createdByUserId: null,
              state: "marked",
              now,
              careDayStartMinutes: household.careDayStartMinutes
            });

      return {
        changed: mutation.changed,
        recordDate: mutation.recordDate,
        hamsterName: hamster.name
      };
    },
    activity: (result: DeviceCareMutationResult): HouseholdActivityCreateInput | null =>
      result.changed
        ? {
            eventType:
              request.careType === "feeding" ? "FEEDING_MARKED" : "WATER_REPLACEMENT_MARKED",
            category: "CARE_RECORD",
            targetType: "HAMSTER",
            targetId: request.hamsterId,
            targetNameSnapshot: result.hamsterName,
            details: { recordDate: toDateInputValue(result.recordDate) }
          }
        : null
  } as const;
}

/**
 * 固定Householdの管理中ハムスターに対し、デバイスからの実施済み化だけを行う。
 *
 * 記録、操作履歴、Household revisionは既存Web操作と同じtransactionで確定する。
 * 重複操作で記録と履歴は増えないが、既存仕様どおりrevisionは進む。
 */
export async function markDeviceCare(
  configuration: DeviceCareConfiguration,
  request: DeviceCareRequest,
  now = new Date(),
  transactionExecutor?: TransactionExecutor
) {
  const input = createDeviceCareCommitInput(configuration, request, now);
  return transactionExecutor
    ? commitHouseholdMutation(input, transactionExecutor)
    : commitHouseholdMutation(input);
}
