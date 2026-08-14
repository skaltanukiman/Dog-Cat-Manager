import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { redirect, unstable_rethrow } from "next/navigation";
import type { Logger } from "winston";

import { writeServerLog } from "@/lib/logger";

type LogContextValue = string | number | boolean | null | undefined;

export type UnexpectedErrorLogOptions = {
  operation: string;
  context?: Record<string, LogContextValue>;
};

const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 8000;
const ALLOWED_CONTEXT_KEYS = new Set([
  "userId",
  "targetUserId",
  "householdId",
  "petId",
  "memberId",
  "petWeightRecordId",
  "recordId",
  "requestId",
  "source",
  "revision",
  "revalidatePath",
  "month",
  "targetCount"
]);

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[truncated]`;
}

function redactSecrets(value: string) {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, "$1[REDACTED]$2")
    .replace(/([?&](?:token|secret|password|api[_-]?key|access[_-]?token|refresh[_-]?token)=)[^&#\s]*/gi, "$1[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(/(cookie\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/((?:token|secret|password|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function safeText(value: string, maxLength: number) {
  return truncate(redactSecrets(value), maxLength);
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;

    return {
      name: error.name,
      code,
      message: safeText(error.message, MAX_MESSAGE_LENGTH),
      stack: error.stack ? safeText(error.stack, MAX_STACK_LENGTH) : undefined
    };
  }

  return {
    name: typeof error,
    message: safeText(String(error), MAX_MESSAGE_LENGTH)
  };
}

function sanitizeContext(context: Record<string, LogContextValue> | undefined) {
  if (!context) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(context)
      .filter(([key]) => ALLOWED_CONTEXT_KEYS.has(key))
      .map(([key, value]) => [key, typeof value === "string" ? safeText(value, 256) : value])
  );
}

export function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function logUnexpectedError(error: unknown, options: UnexpectedErrorLogOptions, logger?: Logger) {
  const errorId = randomUUID();
  const payload = {
    event: "unexpected_error",
    message: "想定外例外が発生しました。",
    errorId,
    operation: options.operation,
    context: sanitizeContext(options.context),
    error: serializeError(error)
  };

  writeServerLog("error", payload, logger);
  return errorId;
}

export function createSystemErrorUrl(pathname: string, errorId: string, currentParams?: URLSearchParams) {
  const params = new URLSearchParams(currentParams);
  params.set("status", "systemError");
  params.set("errorId", errorId);
  return `${pathname}?${params.toString()}`;
}

/**
 * Server Actionの想定外例外を安全に記録し、追跡ID付きのエラー画面へredirectする。
 *
 * Next.jsの`redirect`など制御フロー用例外は変換せず再throwするため、Action全体の
 * `catch`から呼び出せる。この関数は正常復帰しない。
 */
export function handleServerActionError(
  error: unknown,
  options: UnexpectedErrorLogOptions & {
    pathname: string;
    searchParams?: URLSearchParams;
    logger?: Logger;
  }
): never {
  unstable_rethrow(error);
  const errorId = logUnexpectedError(error, options, options.logger);
  redirect(createSystemErrorUrl(options.pathname, errorId, options.searchParams));
}
