import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

import { redirect } from "next/navigation";
import { transports } from "winston";

import { closeServerLogger, createServerLogger, writeServerLog } from "../src/lib/logger";
import { handleServerActionError, logUnexpectedError } from "../src/lib/server-errors";

function captureStream() {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    }
  });
  return { stream, read: () => output };
}

function parseJsonLines(value: string) {
  return value
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("同じerrorIdを標準出力相当と日付付きJSON Linesファイルへ記録する", async () => {
  const root = mkdtempSync(join(tmpdir(), "dog-cat-logger-"));
  const logDir = join(root, "logs");
  const capture = captureStream();
  const logger = createServerLogger({
    level: "debug",
    logDir,
    retentionDays: 14,
    maxFileSizeMb: 20,
    consoleTransport: new transports.Stream({ stream: capture.stream })
  });
  const error = new Error(
    [
      "Database failed postgresql://user:db-password@db:5432/app",
      "password=value",
      "token: invitation-token",
      "Authorization: Bearer bearer-token",
      "Cookie: session=secret-cookie",
      "https://example.com/path?token=query-token&secret=query-secret"
    ].join(" ")
  );
  error.stack = `Error: ${"stack-value ".repeat(1000)}`;

  try {
    const errorId = logUnexpectedError(
      error,
      {
        operation: "logger.integration",
        context: {
          householdId: "household-1",
          requestId: "request-1",
          userEmail: "do-not-log@example.com",
          token: "do-not-log-token"
        }
      },
      logger
    );
    await closeServerLogger(logger);

    const consoleLines = parseJsonLines(capture.read());
    assert.equal(consoleLines.length, 1);
    const logFile = readdirSync(logDir).find((name) => /^application-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.log$/.test(name));
    assert.ok(logFile);
    const fileLines = parseJsonLines(readFileSync(join(logDir, logFile), "utf8"));
    assert.equal(fileLines.length, 1);

    for (const line of [consoleLines[0], fileLines[0]]) {
      assert.equal(line.level, "error");
      assert.equal(line.event, "unexpected_error");
      assert.equal(line.operation, "logger.integration");
      assert.equal(line.errorId, errorId);
      assert.ok(!Number.isNaN(Date.parse(String(line.timestamp))));
      const context = line.context as Record<string, unknown>;
      assert.deepEqual(context, { householdId: "household-1", requestId: "request-1" });
      const loggedError = line.error as Record<string, unknown>;
      assert.equal(loggedError.name, "Error");
      assert.equal(typeof loggedError.message, "string");
      assert.equal(typeof loggedError.stack, "string");
      assert.ok(String(loggedError.message).length <= 2014);
      assert.ok(String(loggedError.stack).length <= 8014);
    }

    const combined = `${capture.read()}\n${readFileSync(join(logDir, logFile), "utf8")}`;
    assert.doesNotMatch(
      combined,
      /db-password|password=value|invitation-token|bearer-token|secret-cookie|query-token|query-secret|do-not-log@example\.com|do-not-log-token/
    );
    assert.match(combined, /\[REDACTED\]/);
  } finally {
    if (!logger.writableFinished) await closeServerLogger(logger);
    rmSync(root, { recursive: true, force: true });
  }
});

test("ログディレクトリ初期化失敗時も標準出力へフォールバックして処理を継続する", async () => {
  const root = mkdtempSync(join(tmpdir(), "dog-cat-logger-failure-"));
  const blockedPath = join(root, "not-a-directory");
  writeFileSync(blockedPath, "blocked", "utf8");
  const capture = captureStream();
  let fallbackOutput = "";
  const originalWrite = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    fallbackOutput += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  const logger = createServerLogger({
    logDir: blockedPath,
    consoleTransport: new transports.Stream({ stream: capture.stream })
  });
  try {
    assert.doesNotThrow(() =>
      writeServerLog("error", { event: "fallback_test", message: "フォールバック確認" }, logger)
    );
    await closeServerLogger(logger);
    assert.match(fallbackOutput, /logger_file_initialization_failed/);
    assert.equal(parseJsonLines(capture.read())[0].event, "fallback_test");
  } finally {
    process.stderr.write = originalWrite;
    if (!logger.writableFinished) await closeServerLogger(logger);
    rmSync(root, { recursive: true, force: true });
  }
});

test("Next.jsのredirect制御例外を通常障害として記録しない", async () => {
  const capture = captureStream();
  const logger = createServerLogger({
    disableFile: true,
    consoleTransport: new transports.Stream({ stream: capture.stream })
  });
  let redirectError: unknown;
  try {
    redirect("/target");
  } catch (error) {
    redirectError = error;
  }
  try {
    assert.throws(
      () =>
        handleServerActionError(redirectError, {
          operation: "logger.redirect",
          pathname: "/fallback",
          logger
        }),
      (error) => error === redirectError
    );
    await closeServerLogger(logger);
    assert.equal(capture.read(), "");
  } finally {
    if (!logger.writableFinished) await closeServerLogger(logger);
  }
});

test("logsディレクトリはGit管理対象外である", () => {
  const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
  assert.match(gitignore, /(?:^|\n)logs\/(?:\r?\n|$)/);
  assert.match(gitignore, /(?:^|\n)\*\.log(?:\r?\n|$)/);
});
