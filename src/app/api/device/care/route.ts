import { NextResponse } from "next/server";

import {
  DeviceCareError,
  MAX_DEVICE_CARE_REQUEST_BYTES,
  deviceCareRequestSchema,
  getDeviceCareConfiguration,
  isValidDeviceCareAuthorization,
  markDeviceCare
} from "@/lib/device-care";
import { toDateInputValue } from "@/lib/date";
import { publishHouseholdChangeSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { logUnexpectedError } from "@/lib/server-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers }
  });
}

function requestContentLengthIsWithinLimit(request: Request) {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) return true;
  const length = Number(rawLength);
  return Number.isSafeInteger(length) && length >= 0 && length <= MAX_DEVICE_CARE_REQUEST_BYTES;
}

async function readRequestBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return { error: "unsupportedMediaType" as const };
  if (!requestContentLengthIsWithinLimit(request)) return { error: "payloadTooLarge" as const };

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_DEVICE_CARE_REQUEST_BYTES) {
      return { error: "payloadTooLarge" as const };
    }
    const parsed = deviceCareRequestSchema.safeParse(JSON.parse(text));
    return parsed.success ? { data: parsed.data } : { error: "badRequest" as const };
  } catch {
    return { error: "badRequest" as const };
  }
}

/**
 * Pico専用tokenで認証し、固定Householdの食事または水替えを実施済みにする。
 *
 * Auth.js公開例外の経路のためBearer認証を必須とし、取消操作は入力形式自体で許可しない。
 */
export async function POST(request: Request) {
  const configuration = getDeviceCareConfiguration();
  if (!configuration) {
    return jsonResponse({ error: "service_unavailable" }, 503);
  }

  if (!isValidDeviceCareAuthorization(request.headers.get("authorization"), configuration.token)) {
    return jsonResponse(
      { error: "unauthorized" },
      401,
      { "WWW-Authenticate": "Bearer" }
    );
  }

  const body = await readRequestBody(request);
  if ("error" in body) {
    if (body.error === "unsupportedMediaType") {
      return jsonResponse({ error: "unsupported_media_type" }, 415);
    }
    if (body.error === "payloadTooLarge") {
      return jsonResponse({ error: "payload_too_large" }, 413);
    }
    return jsonResponse({ error: "bad_request" }, 400);
  }

  try {
    const { result, change } = await markDeviceCare(configuration, body.data);

    publishHouseholdChangeSafely(change);
    revalidatePathsSafely(
      [
        { path: "/" },
        { path: "/settings/members" },
        { path: "/settings/members/activity" }
      ],
      "deviceCare.mark.revalidate",
      {
        householdId: configuration.householdId,
        hamsterId: body.data.hamsterId
      }
    );

    return jsonResponse({
      ok: true,
      status: "marked",
      careType: body.data.careType,
      hamsterId: body.data.hamsterId,
      recordDate: toDateInputValue(result.recordDate),
      changed: result.changed
    });
  } catch (error) {
    if (error instanceof DeviceCareError) {
      if (error.code === "configurationUnavailable") {
        return jsonResponse({ error: "service_unavailable" }, 503);
      }
      if (error.code === "targetNotFound") {
        return jsonResponse({ error: "target_not_found" }, 404);
      }
      return jsonResponse({ error: "target_inactive" }, 409);
    }

    const errorId = logUnexpectedError(error, {
      operation: "deviceCare.mark",
      context: {
        householdId: configuration.householdId,
        hamsterId: body.data.hamsterId,
        source: body.data.careType
      }
    });
    return jsonResponse({ error: "internal_server_error", errorId }, 500);
  }
}
