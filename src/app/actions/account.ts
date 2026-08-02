"use server";

import { redirect } from "next/navigation";

import { deleteUserAccount } from "@/lib/account-delete";
import { ACCOUNT_AUDIT_EVENTS, writeAccountAuditLog } from "@/lib/audit-log";
import { clearDeletedAccountCookies, getRequiredSessionUser } from "@/lib/auth-context";
import { deleteHouseholdImageDirectoriesSafely } from "@/lib/household-delete-images";
import { getRealtimeActorId, publishHouseholdChangesSafely } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { handleServerActionError, logUnexpectedError } from "@/lib/server-errors";

const TRANSFER_FIELD_PREFIX = "transferToUserId:";

function parseTransferTargets(formData: FormData) {
  const transferTargets: Record<string, string> = {};

  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(TRANSFER_FIELD_PREFIX)) continue;
    const householdId = name.slice(TRANSFER_FIELD_PREFIX.length);
    if (!householdId || typeof value !== "string" || !value || transferTargets[householdId]) {
      return null;
    }
    transferTargets[householdId] = value;
  }

  return transferTargets;
}

async function clearCookiesAfterDeletion(userId: string) {
  try {
    await clearDeletedAccountCookies();
  } catch (error) {
    // DB上のUserとSessionは既に削除済みなので、Cookie失敗で削除処理を失敗扱いには戻さない。
    logUnexpectedError(error, {
      operation: "account.delete.clearCookies",
      context: { userId }
    });
  }
}

function redirectAccountDeleteFailure(status: string): never {
  redirect(`/settings/account/delete?status=${status}`);
}

/**
 * 確認画面の状態tokenを検証して、現在ユーザーのアカウント削除を実行するServer Action。
 *
 * DB commit後にだけHousehold画像、プロセス内通知、認証Cookieを後処理する。
 * これら補助処理の失敗で、確定済みのUser削除を取り消した扱いにはしない。
 */
export async function deleteCurrentUserAccount(formData: FormData) {
  try {
    const confirmationText = formData.get("confirmationText");
    const expectedStateToken = formData.get("expectedStateToken");
    const transferTargets = parseTransferTargets(formData);
    if (
      typeof confirmationText !== "string" ||
      typeof expectedStateToken !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedStateToken) ||
      !transferTargets
    ) {
      redirectAccountDeleteFailure("accountDeleteInvalid");
    }

    // Householdを自動作成しない認証経路で、削除対象IDを現在のDB Sessionから確定する。
    const user = await getRequiredSessionUser();
    const result = await deleteUserAccount({
      actorUserId: user.id,
      actorClientId: getRealtimeActorId(formData),
      confirmationText,
      expectedStateToken,
      transferTargets
    });

    if (result.status === "confirmationMismatch") {
      redirectAccountDeleteFailure("accountDeleteConfirmationMismatch");
    }
    if (result.status === "lastSuperAdmin") {
      redirectAccountDeleteFailure("accountDeleteLastSuperAdmin");
    }
    if (result.status === "transferRequired") {
      redirectAccountDeleteFailure("accountDeleteTransferRequired");
    }
    if (result.status === "invalidTransferTarget") {
      redirectAccountDeleteFailure("accountDeleteInvalidTransferTarget");
    }
    if (result.status === "transferTargetUnavailable") {
      redirectAccountDeleteFailure("accountDeleteTransferTargetUnavailable");
    }
    if (result.status === "stateChanged") {
      redirectAccountDeleteFailure("accountDeleteStateChanged");
    }
    if (result.status === "alreadyDeleted") {
      await clearCookiesAfterDeletion(user.id);
      redirect("/login?status=accountAlreadyDeleted");
    }

    // DB commit後に、実際に完全削除した単独Householdの画像だけを後処理する。
    await Promise.all(
      result.deletedHouseholdIds.map((householdId) => deleteHouseholdImageDirectoriesSafely(householdId))
    );
    publishHouseholdChangesSafely(result.changes);
    await clearCookiesAfterDeletion(user.id);

    writeAccountAuditLog(ACCOUNT_AUDIT_EVENTS.accountDeleted, {
      deletedUserId: user.id,
      deletedSoleHouseholdCount: String(result.deletedHouseholdIds.length),
      leftSharedHouseholdCount: String(result.leftHouseholdCount),
      transferredHouseholdCount: String(result.transferredHouseholdCount),
      result: "success"
    });
    revalidatePathsSafely(
      [
        { path: "/", type: "layout" },
        { path: "/settings" },
        { path: "/settings/account/delete" },
        { path: "/login" }
      ],
      "account.delete.revalidate",
      { userId: user.id }
    );
    redirect("/login?status=accountDeleted");
  } catch (error) {
    handleServerActionError(error, {
      operation: "account.delete",
      pathname: "/settings/account/delete"
    });
  }
}
