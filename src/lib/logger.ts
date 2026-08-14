import { accessSync, constants, mkdirSync } from "node:fs";
import { once } from "node:events";

import { createLogger, format, transports, type Logger } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import type TransportStream from "winston-transport";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type ServerLogFields = {
  event: string;
  message?: string;
  operation?: string;
  errorId?: string;
  context?: Record<string, unknown>;
  error?: Record<string, unknown>;
};

export type ServerLoggerOptions = {
  level?: string;
  logDir?: string;
  retentionDays?: number;
  maxFileSizeMb?: number;
  consoleTransport?: TransportStream;
  disableFile?: boolean;
};

const DEFAULT_LOG_DIR = "/app/logs";
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_MAX_FILE_SIZE_MB = 20;
const MAX_RETENTION_DAYS = 365;
const MAX_FILE_SIZE_MB = 1024;
const FILE_ERROR_WARNING_INTERVAL_MS = 60_000;
const closedLoggers = new WeakSet<Logger>();

type LoggerGlobal = typeof globalThis & {
  __dogCatServerLogger?: Logger;
};

function parseLogLevel(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  const fallback: LogLevel = process.env.NODE_ENV === "production" ? "info" : "debug";
  return normalized && LOG_LEVELS.includes(normalized as LogLevel) ? (normalized as LogLevel) : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}

function directStderrWarning(event: string, message: string) {
  try {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        event,
        message
      })}\n`
    );
  } catch {
    // 標準エラー自体が利用できない場合でも、ログ障害をアプリ本体へ伝播させない。
  }
}

function createConsoleTransport() {
  return new transports.Console({
    level: "debug",
    stderrLevels: ["warn", "error"]
  });
}

function addRotatingFileTransport(
  logger: Logger,
  { level, logDir, retentionDays, maxFileSizeMb }: Required<Pick<ServerLoggerOptions, "level" | "logDir" | "retentionDays" | "maxFileSizeMb">>
) {
  try {
    mkdirSync(logDir, { recursive: true, mode: 0o750 });
    accessSync(logDir, constants.W_OK);

    const fileTransport = new DailyRotateFile({
      level,
      dirname: logDir,
      filename: "application-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      utc: true,
      zippedArchive: false,
      maxSize: `${maxFileSizeMb}m`,
      maxFiles: `${retentionDays}d`,
      auditFile: `${logDir}/.application-audit.json`,
      options: { flags: "a", mode: 0o640 }
    });
    let lastWarningAt = 0;
    fileTransport.on("error", () => {
      const now = Date.now();
      if (now - lastWarningAt >= FILE_ERROR_WARNING_INTERVAL_MS) {
        lastWarningAt = now;
        directStderrWarning("logger_file_write_failed", "ログファイルへ書き込めないため標準出力のみを使用します。");
      }
      // 壊れたtransportを残すと書き込みごとに失敗するため、標準出力だけで継続する。
      logger.remove(fileTransport);
      fileTransport.close?.();
    });
    logger.add(fileTransport);
  } catch {
    directStderrWarning("logger_file_initialization_failed", "ログファイルを初期化できないため標準出力のみを使用します。");
  }
}

export function createServerLogger(options: ServerLoggerOptions = {}) {
  const rawLevel = options.level ?? process.env.LOG_LEVEL;
  const rawRetentionDays = options.retentionDays ?? parsePositiveInteger(process.env.LOG_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS);
  const rawMaxFileSizeMb =
    options.maxFileSizeMb ?? parsePositiveInteger(process.env.LOG_MAX_FILE_SIZE_MB, DEFAULT_MAX_FILE_SIZE_MB, MAX_FILE_SIZE_MB);
  const level = parseLogLevel(rawLevel);
  const logDir = options.logDir?.trim() || process.env.LOG_DIR?.trim() || DEFAULT_LOG_DIR;
  const retentionDays =
    Number.isSafeInteger(rawRetentionDays) && rawRetentionDays >= 1 && rawRetentionDays <= MAX_RETENTION_DAYS
      ? rawRetentionDays
      : DEFAULT_RETENTION_DAYS;
  const maxFileSizeMb =
    Number.isSafeInteger(rawMaxFileSizeMb) && rawMaxFileSizeMb >= 1 && rawMaxFileSizeMb <= MAX_FILE_SIZE_MB
      ? rawMaxFileSizeMb
      : DEFAULT_MAX_FILE_SIZE_MB;
  const logger = createLogger({
    level,
    format: format.combine(format.timestamp(), format.json()),
    transports: [options.consoleTransport ?? createConsoleTransport()]
  });

  logger.on("error", () => {
    directStderrWarning("logger_internal_error", "共通ロガーでエラーが発生しました。標準エラーを確認してください。");
  });

  if (!options.disableFile) {
    addRotatingFileTransport(logger, { level, logDir, retentionDays, maxFileSizeMb });
  }

  if (rawLevel && !LOG_LEVELS.includes(rawLevel.trim().toLowerCase() as LogLevel)) {
    writeServerLog("warn", {
      event: "logger_invalid_log_level",
      message: `LOG_LEVELが不正なため${level}を使用します。`
    }, logger);
  }
  if (process.env.LOG_RETENTION_DAYS && retentionDays === DEFAULT_RETENTION_DAYS && process.env.LOG_RETENTION_DAYS !== String(DEFAULT_RETENTION_DAYS)) {
    writeServerLog("warn", {
      event: "logger_invalid_retention_days",
      message: `LOG_RETENTION_DAYSが不正なため${DEFAULT_RETENTION_DAYS}日を使用します。`
    }, logger);
  }
  if (process.env.LOG_MAX_FILE_SIZE_MB && maxFileSizeMb === DEFAULT_MAX_FILE_SIZE_MB && process.env.LOG_MAX_FILE_SIZE_MB !== String(DEFAULT_MAX_FILE_SIZE_MB)) {
    writeServerLog("warn", {
      event: "logger_invalid_max_file_size",
      message: `LOG_MAX_FILE_SIZE_MBが不正なため${DEFAULT_MAX_FILE_SIZE_MB}MBを使用します。`
    }, logger);
  }

  return logger;
}

export function getServerLogger() {
  const globalForLogger = globalThis as LoggerGlobal;
  // 開発時の再評価や同一プロセス内の呼び出しでtransportを重複登録しない。
  if (!globalForLogger.__dogCatServerLogger) {
    globalForLogger.__dogCatServerLogger = createServerLogger();
  }
  return globalForLogger.__dogCatServerLogger;
}

export function writeServerLog(level: LogLevel, fields: ServerLogFields, logger: Logger = getServerLogger()) {
  try {
    logger.log({
      level,
      message: fields.message ?? fields.event,
      ...fields
    });
  } catch {
    directStderrWarning("logger_write_failed", "共通ロガーへ書き込めませんでした。");
  }
}

export async function closeServerLogger(logger: Logger) {
  if (closedLoggers.has(logger)) return;
  const rotatingTransports = logger.transports.filter(
    (transport): transport is DailyRotateFile => transport instanceof DailyRotateFile
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.all(
    rotatingTransports.map(
      (transport) =>
        new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 2000);
          timeout.unref();
          transport.once("finish", () => {
            clearTimeout(timeout);
            resolve();
          });
          transport.close?.();
        })
    )
  );
  logger.clear();
  const finished = once(logger, "finish");
  logger.end();
  await finished;
  logger.close();
  closedLoggers.add(logger);
}
