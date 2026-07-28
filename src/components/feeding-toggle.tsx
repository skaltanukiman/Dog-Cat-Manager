"use client";

import { CheckCircle2, Circle, LoaderCircle, Utensils } from "lucide-react";
import { useFormStatus } from "react-dom";

import { formatTimeJst } from "@/lib/date";

type FeedingToggleAction = (formData: FormData) => void | Promise<void>;

function FeedingToggleButton({
  hamsterName,
  fedAt,
  disabledReason
}: {
  hamsterName: string;
  fedAt: string | null;
  disabledReason: string | null;
}) {
  const { pending } = useFormStatus();
  const isMarked = fedAt !== null;
  const disabled = pending || disabledReason !== null;
  const stateLabel = isMarked ? `${formatTimeJst(new Date(fedAt))}に実施済み` : "本日未実施";

  return (
    <button
      type="submit"
      aria-label={`${hamsterName}の食事：${stateLabel}。${isMarked ? "未実施に戻す" : "実施済みにする"}`}
      aria-pressed={isMarked}
      aria-disabled={disabled}
      disabled={disabled}
      title={disabledReason ?? (isMarked ? "押すと本日未実施に戻ります" : "押すと本日実施済みになります")}
      className={`flex min-h-11 w-full items-center justify-between gap-4 rounded-md border px-3 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65 ${
        isMarked
          ? "border-moss/30 bg-moss/10 hover:border-moss/50 hover:bg-moss/20"
          : "border-slate-200 bg-slate-50 hover:border-moss/40 hover:bg-white"
      }`}
    >
      <span className="flex items-center gap-2 font-medium text-slate-700">
        <Utensils className="h-4 w-4 text-persimmon" aria-hidden />
        食事
      </span>
      <span className={`inline-flex min-w-28 items-center justify-end gap-1.5 font-semibold ${isMarked ? "text-moss" : "text-slate-600"}`}>
        {pending ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            保存中...
          </>
        ) : isMarked ? (
          <>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {stateLabel}
          </>
        ) : (
          <>
            <Circle className="h-4 w-4" aria-hidden />
            {stateLabel}
          </>
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
          <FeedingToggleButton hamsterName={hamsterName} fedAt={fedAt} disabledReason={disabledReason} />
        </form>
      </dd>
    </div>
  );
}
