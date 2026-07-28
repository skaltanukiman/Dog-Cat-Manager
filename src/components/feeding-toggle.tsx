"use client";

import { LoaderCircle, Utensils } from "lucide-react";
import { useFormStatus } from "react-dom";

import { formatTimeJst } from "@/lib/date";

type FeedingToggleAction = (formData: FormData) => void | Promise<void>;

function FeedingToggleButton({
  hamsterName,
  fedAt,
  disabledReason,
  shouldDimWhenDisabled
}: {
  hamsterName: string;
  fedAt: string | null;
  disabledReason: string | null;
  shouldDimWhenDisabled: boolean;
}) {
  const { pending } = useFormStatus();
  const isMarked = fedAt !== null;
  const disabled = pending || disabledReason !== null;
  const hoverClass = disabled ? "" : "hover:bg-slate-100";
  const stateLabel = isMarked ? "実施済み" : "未実施";
  const stateDescription = isMarked ? `${formatTimeJst(new Date(fedAt))}に実施済みです` : "未実施です";
  const actionDescription = isMarked ? "押すと未実施に戻します" : "押すと実施済みにします";

  return (
    <button
      type="submit"
      aria-label={`${hamsterName}の食事は${stateDescription}。${actionDescription}`}
      aria-pressed={isMarked}
      aria-disabled={disabled}
      disabled={disabled}
      title={disabledReason ?? `${stateDescription}。${actionDescription}`}
      className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-4 rounded-md bg-slate-50 px-3 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 disabled:cursor-not-allowed ${hoverClass} ${
        shouldDimWhenDisabled ? "disabled:opacity-65" : ""
      }`}
    >
      <span className="flex items-center gap-2 font-medium text-slate-700">
        <Utensils className="h-4 w-4 text-persimmon" aria-hidden />
        食事
      </span>
      <span
        className={`inline-flex h-8 min-w-28 items-center justify-end rounded-md border border-slate-200 bg-white px-2.5 text-right text-sm font-semibold shadow-sm ${
          isMarked ? "text-moss" : "text-slate-500"
        }`}
      >
        {pending ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            保存中...
          </>
        ) : (
          stateLabel
        )}
      </span>
    </button>
  );
}

export function FeedingToggle({
  hamsterId,
  hamsterName,
  fedAt,
  canEdit = true,
  isActive = true,
  readOnly = false,
  action
}: {
  hamsterId: string;
  hamsterName: string;
  fedAt: string | null;
  canEdit?: boolean;
  isActive?: boolean;
  readOnly?: boolean;
  action?: FeedingToggleAction;
}) {
  const disabledReason = readOnly
    ? "サンプル閲覧モードでは変更できません"
    : !isActive
      ? "管理外のハムスターは変更できません"
      : !canEdit
        ? "閲覧者は食事状態を変更できません"
        : action
          ? null
          : "食事状態を変更できません";

  return (
    <div>
      <dt className="sr-only">食事</dt>
      <dd>
        <form action={readOnly ? undefined : action}>
          <input type="hidden" name="hamsterId" value={hamsterId} />
          <input type="hidden" name="state" value={fedAt ? "unmarked" : "marked"} />
          <FeedingToggleButton
            hamsterName={hamsterName}
            fedAt={fedAt}
            disabledReason={disabledReason}
            shouldDimWhenDisabled={isActive}
          />
        </form>
      </dd>
    </div>
  );
}
