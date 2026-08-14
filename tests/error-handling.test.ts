import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Writable } from "node:stream";
import { transports } from "winston";

import { UnexpectedErrorPanel } from "../src/components/unexpected-error-panel";
import { closeServerLogger, createServerLogger } from "../src/lib/logger";
import {
  commitHouseholdMutation,
  publishHouseholdChangeSafely,
  type TransactionExecutor
} from "../src/lib/realtime";
import {
  createSystemErrorUrl,
  isPrismaUniqueConstraintError,
  logUnexpectedError
} from "../src/lib/server-errors";

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("database detail", {
    code,
    clientVersion: "6.1.0",
    meta: { target: ["unique_key"] }
  });
}

function findButton(node: ReactNode): ReactElement<{ onClick?: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return null;
  if (node.type === "button") return node;
  return findButton(node.props.children);
}

test("P2002だけを一意制約違反として分類する", () => {
  assert.equal(isPrismaUniqueConstraintError(prismaKnownError("P2002")), true);
  assert.equal(isPrismaUniqueConstraintError(prismaKnownError("P2025")), false);
  assert.equal(isPrismaUniqueConstraintError(new Error("P2002")), false);
});

test("想定外例外はエラーID付きでログ出力され、機密情報を伏せる", async () => {
  let logged = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logged += chunk.toString();
      callback();
    }
  });
  const logger = createServerLogger({
    disableFile: true,
    consoleTransport: new transports.Stream({ stream })
  });
  try {
    const errorId = logUnexpectedError(
      new Error("connect postgresql://user:super-secret@db:5432/app token=invitation-secret"),
      { operation: "test.operation", context: { householdId: "household-1" } },
      logger
    );
    await closeServerLogger(logger);
    assert.match(errorId, /^[a-f0-9-]{36}$/);
    assert.match(logged, new RegExp(errorId));
    assert.match(logged, /test\.operation/);
    assert.match(logged, /household-1/);
    assert.doesNotMatch(logged, /super-secret|invitation-secret/);
    assert.match(logged, /\[REDACTED\]/);
  } finally {
    if (!logger.writableFinished) await closeServerLogger(logger);
  }
});

test("利用者向けURLに内部例外情報を含めない", () => {
  const url = createSystemErrorUrl("/weights", "safe-error-id");
  assert.equal(url, "/weights?status=systemError&errorId=safe-error-id");
  assert.doesNotMatch(url, /database|stack|secret/i);
});

test("revision更新が失敗した場合は同じトランザクションのデータ更新も確定しない", async () => {
  let persistedValue = 0;
  const transactionExecutor: TransactionExecutor = async (operation) => {
    const snapshot = persistedValue;
    const tx = {
      household: {
        update: async () => {
          throw new Error("revision update failed");
        }
      }
    } as unknown as Parameters<typeof operation>[0];
    try {
      return await operation(tx);
    } catch (error) {
      persistedValue = snapshot;
      throw error;
    }
  };

  await assert.rejects(
    commitHouseholdMutation(
      {
        householdId: "household-1",
        source: "petWeight",
        mutate: async () => {
          persistedValue = 1;
        }
      },
      transactionExecutor
    ),
    /revision update failed/
  );
  assert.equal(persistedValue, 0);
});

test("SSE配信失敗は保存成功後の処理を失敗に変えない", () => {
  const result = publishHouseholdChangeSafely(
    {
      householdId: "household-1",
      source: "petWeight",
      actorClientId: null,
      actorUserId: "user-1",
      revision: "2"
    },
    () => {
      throw new Error("SSE failed");
    },
    () => "00000000-0000-4000-8000-000000000000"
  );
  assert.equal(result, false);
});

test("共通エラー画面は安全なIDと再試行操作を提供する", () => {
  let retryCount = 0;
  const element = UnexpectedErrorPanel({ errorId: "error-id-123", onRetry: () => retryCount++ });
  const html = renderToStaticMarkup(element);
  assert.match(html, /予期しないエラーが発生しました/);
  assert.match(html, /error-id-123/);
  assert.match(html, /ダッシュボードへ戻る/);
  const retryButton = findButton(element);
  assert.ok(retryButton?.props.onClick);
  retryButton.props.onClick();
  assert.equal(retryCount, 1);
});
