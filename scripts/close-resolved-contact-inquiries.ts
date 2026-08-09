import { closeExpiredResolvedContactInquiries } from "@/lib/contact-inquiry-auto-close";
import { CONTACT_INQUIRY_AUTO_CLOSE_MS } from "@/lib/contact-inquiry-core";
import { closeServerLogger, getServerLogger, writeServerLog } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { logUnexpectedError } from "@/lib/server-errors";

async function main() {
  const logger = getServerLogger();
  const dryRun = process.argv.includes("--dry-run");

  try {
    const result = await closeExpiredResolvedContactInquiries(
      {
        count: (args) => prisma.contactInquiry.count(args),
        updateMany: (args) => prisma.contactInquiry.updateMany(args)
      },
      new Date(),
      { dryRun }
    );

    writeServerLog(
      "info",
      {
        event: dryRun
          ? "contact_inquiry_auto_close_previewed"
          : "contact_inquiry_auto_close_completed",
        message: dryRun
          ? "対応済み問い合わせの自動終了対象を確認しました。"
          : "対応済み問い合わせの自動終了が完了しました。",
        operation: "contactInquiries.autoClose",
        context: {
          dryRun,
          retentionDays: CONTACT_INQUIRY_AUTO_CLOSE_MS / (24 * 60 * 60 * 1000),
          threshold: result.threshold.toISOString(),
          targetCount: result.targetCount,
          closedCount: result.closedCount
        }
      },
      logger
    );
    process.stdout.write(`Contact inquiry auto-close target=${result.targetCount}\n`);
    process.stdout.write(
      dryRun
        ? "Contact inquiry auto-close dry run completed. closed=0\n"
        : `Contact inquiry auto-close completed. closed=${result.closedCount}\n`
    );
  } catch (error) {
    const errorId = logUnexpectedError(
      error,
      { operation: "contactInquiries.autoClose" },
      logger
    );
    process.stderr.write(`Contact inquiry auto-close failed. errorId=${errorId}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await closeServerLogger(logger);
  }
}

void main();
