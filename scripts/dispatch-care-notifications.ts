import { dispatchCareNotifications } from "@/lib/care-notification-dispatch";
import { closeServerLogger, getServerLogger, writeServerLog } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";

async function main() {
  const logger = getServerLogger();
  writeServerLog("info", {
    event: "care_notification_dispatch_started",
    message: "Petお世話通知の定期判定を開始しました。",
    operation: "careNotifications.dispatch"
  }, logger);
  try {
    const result = await dispatchCareNotifications();
    process.stdout.write(
      `Care notification dispatch completed. candidates=${result.candidateCount} sent=${result.sentCount} skipped=${result.skippedCount} retryable=${result.retryableCount}\n`
    );
  } catch (error) {
    const errorId = logUnexpectedError(error, { operation: "careNotifications.dispatch" }, logger);
    process.stderr.write(`Care notification dispatch failed. errorId=${errorId}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await closeServerLogger(logger);
  }
}

void main();
