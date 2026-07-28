"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

const messages: Record<string, string> = {
  created: "登録しました。",
  updated: "更新しました。",
  deleted: "削除しました。",
  saved: "保存しました。",
  profileUpdated: "表示名を更新しました。",
  householdNameUpdated: "共有グループ名を更新しました。",
  householdNameUnchanged: "共有グループ名に変更はありません。",
  unchanged: "変更はありません。",
  invalid: "入力内容を確認してください。",
  duplicate: "同じ日付の記録が既に存在します。",
  weightIncrement: "体重は0.1g単位で入力してください。",
  hamsterDuplicate: "同じ名前のハムスターが既に登録されています。",
  hamsterNameTooLong: "名前は15文字以内で入力してください。",
  profileNameTooLong: "表示名は50文字以内で入力してください。",
  householdNameTooLong: "共有グループ名は50文字以内で入力してください。",
  hamsterMemoTooLong: "メモは2000文字以内で入力してください。",
  hamsterImageTooLarge: "画像は10MB以内で選択してください。",
  hamsterImageUnsupported: "JPEG、PNG、WebP形式の画像を選択してください。",
  hamsterImageInvalid: "画像ファイルを読み込めませんでした。別の画像を選択してください。",
  recordCreated: "記録を登録しました。",
  recordUpdated: "記録を更新しました。",
  recordDeleted: "記録を削除しました。",
  invalidDate: "日付を確認してください。",
  invalidTime: "時刻を確認してください。",
  futureTime: "未来の時刻には記録できません。",
  feeInvalid: "診察費は0円以上の整数で入力してください。",
  recordImageTooLarge: "思い出の写真は10MB以内で選択してください。",
  recordImageUnsupported: "思い出の写真はJPEG、PNG、WebP形式を選択してください。",
  recordImageInvalid: "思い出の写真を読み込めませんでした。別の画像を選択してください。",
  dashboardLimitExceeded: "表示数を超えてハムスターを選択しています。",
  dashboardSelectionRequired: "表示対象のハムスター数を表示ボード数に合わせてください。",
  future: "未来日には記録できません。",
  locked: "管理外のハムスターは編集できません。管理中に戻してから操作してください。",
  invitationCreated: "招待リンクを作成しました。",
  invitationRevoked: "招待リンクを無効化しました。",
  joined: "共有に参加しました。",
  householdLeft: "共有グループから退出しました。",
  ownershipTransferredAndLeft: "所有権を移譲し、共有グループから退出しました。",
  householdDeletedAndSwitched:
    "共有グループとすべてのデータを削除しました。参加中の別の共有グループへ切り替えました。",
  householdDeletedAndCreated:
    "共有グループとすべてのデータを削除しました。新しい空の共有グループを作成しました。",
  memberRemoved: "メンバーの共有を解除しました。",
  roleUpdated: "権限を更新しました。",
  userSuspended: "ユーザーを利用停止しました。対象ユーザーの全セッションを無効化しました。",
  userRestored: "ユーザーの利用停止を解除しました。",
  userAccessTargetNotFound: "対象ユーザーが存在しません。最新の画面を確認してください。",
  cannotSuspendSelf: "自分自身は利用停止できません。",
  cannotSuspendLastSuperAdmin: "最後の利用中スーパー管理者は利用停止できません。",
  userAlreadySuspended: "対象ユーザーは既に利用停止されています。",
  userAlreadyActive: "対象ユーザーは既に利用中です。",
  userAccessStateChanged: "対象ユーザーの状態が変更されています。最新の画面を確認して、もう一度操作してください。",
  suspensionReasonInvalid: "利用停止理由は前後の空白を除いて3〜500文字で入力してください。",
  userRestoreNoteInvalid: "解除理由・備考は500文字以内で入力してください。",
  adminTargetInvalid: "対象ユーザーまたは権限を確認してください。",
  cannotRemoveSelf: "自分自身の共有は解除できません。",
  cannotRemoveLastOwner: "最後のオーナーは共有解除できません。",
  cannotLeaveSoleMember: "このグループにはほかのメンバーがいないため、この画面からは退出できません。",
  ownershipTransferRequired: "現在はこのグループで唯一のオーナーです。新しいオーナーを選択して、もう一度お試しください。",
  invalidTransferTarget: "自分自身を新しいオーナーには選択できません。",
  transferTargetUnavailable: "選択したメンバーは、この共有グループに所属していません。最新の状態を確認して、もう一度お試しください。",
  householdAlreadyLeft: "この共有グループからは既に退出しています。最新の状態を確認してください。",
  householdLeaveStateChanged: "共有グループの状態が変更されています。最新の状態を確認して、もう一度操作してください。",
  householdDeleteStateChanged: "共有グループの状態が変更されています。最新の状態を確認して、もう一度操作してください。",
  householdDeleteNameMismatch: "確認のため、現在の共有グループ名を正しく入力してください。",
  householdRoleStateInvalid:
    "共有グループの権限状態に問題があるため、削除手続きを続行できません。管理者へお問い合わせください。",
  householdStateChanged: "共有グループの状態が変更されています。最新の状態を確認して、もう一度操作してください。",
  cannotChangeOwnHouseholdRole: "自分自身の共有権限は変更できません。",
  cannotChangeOwnerRole: "オーナー権限はこの画面では変更できません。",
  cannotChangeOwnRole: "自分自身のアプリ全体権限は変更できません。",
  cannotRemoveLastSuperAdmin: "最後のスーパー管理者は降格できません。",
  accountDeleteInvalid: "入力内容を確認し、最新の画面からもう一度お試しください。",
  accountDeleteConfirmationMismatch: "確認文字列が一致していません。",
  accountDeleteTransferRequired: "所有権の移譲先をすべて選択してください。",
  accountDeleteInvalidTransferTarget: "自分自身を所有権の移譲先には選択できません。",
  accountDeleteTransferTargetUnavailable:
    "選択した移譲先は共有グループに所属していません。画面を再読み込みして最新の状態を確認してください。",
  accountDeleteStateChanged:
    "共有グループの状態が変更されています。画面を再読み込みして最新の状態を確認してください。",
  accountDeleteLastSuperAdmin: "最後のスーパー管理者のため、アカウントを削除できません。",
  forbidden: "この操作を実行する権限がありません。",
  viewerForbidden: "閲覧者はこの操作を実行できません。",
  invitationExpired: "招待リンクの有効期限が切れています。",
  invitationUsed: "この招待リンクは既に使用されています。",
  invitationAlreadyRevoked: "この招待リンクは既に無効化されています。",
  invitationRevokedAccess: "この招待リンクは無効になっています。招待した方に、新しい招待リンクの発行を依頼してください。",
  systemError: "処理中に予期しないエラーが発生しました。時間をおいて再度お試しください。"
};

const errorStatuses = new Set([
  "invalid",
  "duplicate",
  "weightIncrement",
  "hamsterDuplicate",
  "hamsterNameTooLong",
  "profileNameTooLong",
  "householdNameTooLong",
  "hamsterMemoTooLong",
  "hamsterImageTooLarge",
  "hamsterImageUnsupported",
  "hamsterImageInvalid",
  "invalidDate",
  "invalidTime",
  "futureTime",
  "feeInvalid",
  "recordImageTooLarge",
  "recordImageUnsupported",
  "recordImageInvalid",
  "dashboardLimitExceeded",
  "dashboardSelectionRequired",
  "future",
  "locked",
  "forbidden",
  "viewerForbidden",
  "adminTargetInvalid",
  "cannotRemoveSelf",
  "cannotRemoveLastOwner",
  "cannotLeaveSoleMember",
  "ownershipTransferRequired",
  "invalidTransferTarget",
  "transferTargetUnavailable",
  "householdAlreadyLeft",
  "householdLeaveStateChanged",
  "householdDeleteStateChanged",
  "householdDeleteNameMismatch",
  "householdRoleStateInvalid",
  "householdStateChanged",
  "cannotChangeOwnHouseholdRole",
  "cannotChangeOwnerRole",
  "cannotChangeOwnRole",
  "cannotRemoveLastSuperAdmin",
  "userAccessTargetNotFound",
  "cannotSuspendSelf",
  "cannotSuspendLastSuperAdmin",
  "userAlreadySuspended",
  "userAlreadyActive",
  "userAccessStateChanged",
  "suspensionReasonInvalid",
  "userRestoreNoteInvalid",
  "accountDeleteInvalid",
  "accountDeleteConfirmationMismatch",
  "accountDeleteTransferRequired",
  "accountDeleteInvalidTransferTarget",
  "accountDeleteTransferTargetUnavailable",
  "accountDeleteStateChanged",
  "accountDeleteLastSuperAdmin",
  "invitationExpired",
  "invitationUsed",
  "invitationAlreadyRevoked",
  "invitationRevokedAccess",
  "systemError"
]);

const AUTO_DISMISS_MS = 3500;
const LEAVE_ANIMATION_MS = 450;

function AnimatedStatusMessage({ status, message, errorId }: { status: string; message: string; errorId?: string }) {
  const [isVisible, setIsVisible] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);
  const isError = errorStatuses.has(status);
  const isInfo = status === "unchanged" || status === "householdNameUnchanged";
  const colorClass = isError
    ? "border-red-200 bg-red-50 text-red-700"
    : isInfo
      ? "border-slate-200 bg-slate-50 text-slate-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  useEffect(() => {
    if (isError) {
      return;
    }

    const leaveTimer = window.setTimeout(() => {
      setIsLeaving(true);
    }, AUTO_DISMISS_MS);
    const removeTimer = window.setTimeout(() => {
      setIsVisible(false);
    }, AUTO_DISMISS_MS + LEAVE_ANIMATION_MS);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
  }, [isError]);

  function handleClose() {
    setIsLeaving(true);
    window.setTimeout(() => {
      setIsVisible(false);
    }, LEAVE_ANIMATION_MS);
  }

  if (!isVisible) {
    return null;
  }

  return (
    <div
      role={isError ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 overflow-hidden rounded-md border px-4 py-3 text-sm transition-all duration-500 ease-out ${
        isLeaving ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100"
      } ${colorClass}`}
    >
      <div className="min-w-0 flex-1">
        <p>{message}</p>
        {status === "systemError" && errorId ? <p className="mt-1 break-all text-xs">エラーID: {errorId}</p> : null}
      </div>
      {isError ? (
        <button
          type="button"
          onClick={handleClose}
          aria-label="メッセージを閉じる"
          className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-current opacity-75 hover:bg-white/60 hover:opacity-100"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function AutoDismissSuccessMessage({ message }: { message: string }) {
  return <AnimatedStatusMessage status="success" message={message} />;
}

export function StatusMessage({ status, errorId }: { status?: string; errorId?: string }) {
  if (!status || !messages[status]) {
    return null;
  }

  const safeErrorId = errorId && /^[A-Za-z0-9-]{6,128}$/.test(errorId) ? errorId : undefined;
  return <AnimatedStatusMessage key={`${status}-${safeErrorId ?? ""}`} status={status} message={messages[status]} errorId={safeErrorId} />;
}
