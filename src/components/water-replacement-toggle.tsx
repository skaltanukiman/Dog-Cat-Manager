"use client";

import { Droplets, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

import { formatTimeJst } from "@/lib/date";

type WaterReplacementToggleAction = (formData: FormData) => void | Promise<void>;

function WaterReplacementToggleButton({
  hamsterName,
  replacedAt,
  disabledReason,
  shouldDimWhenDisabled
}: {
  hamsterName: string;
  replacedAt: string | null;
  disabledReason: string | null;
  shouldDimWhenDisabled: boolean;
}) {
  const { pending } = useFormStatus();
  const isMarked = replacedAt !== null;
  const disabled = pending || disabledReason !== null;
  const hoverClass = disabled ? "" : "hover:bg-slate-100";
  const stateLabel = isMarked ? "交換済み" : "未交換";
  const stateDescription = isMarked ? `${formatTimeJst(new Date(replacedAt))}に交換済みです` : "未交換です";
  const actionDescription = isMarked ? "押すと未交換に戻します" : "押すと交換済みにします";

  return (
    <button
      type="submit"
      aria-label={`${hamsterName}の水替えは${stateDescription}。${actionDescription}`}
      aria-pressed={isMarked}
      aria-disabled={disabled}
      disabled={disabled}
      title={disabledReason ?? `${stateDescription}。${actionDescription}`}
      className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-4 rounded-md bg-slate-50 px-3 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 disabled:cursor-not-allowed ${hoverClass} ${
        shouldDimWhenDisabled ? "disabled:opacity-65" : ""
      }`}
    >
      <span className="flex items-center gap-2 font-medium text-slate-700">
        <Droplets className="h-4 w-4 text-sky-600" aria-hidden />
        水替え
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

export function WaterReplacementToggle({
  hamsterId,
  hamsterName,
  replacedAt,
  canEdit = true,
  isActive = true,
  readOnly = false,
  action
}: {
  hamsterId: string;
  hamsterName: string;
  replacedAt: string | null;
  canEdit?: boolean;
  isActive?: boolean;
  readOnly?: boolean;
  action?: WaterReplacementToggleAction;
}) {
  const disabledReason = readOnly
    ? "サンプル閲覧モードでは変更できません"
    : !isActive
      ? "管理外のハムスターは変更できません"
      : !canEdit
        ? "閲覧者は水替え状態を変更できません"
        : action
          ? null
          : "水替え状態を変更できません";

  return (
    <div>
      <dt className="sr-only">水替え</dt>
      <dd>
        <form action={readOnly ? undefined : action}>
          <input type="hidden" name="hamsterId" value={hamsterId} />
          <input type="hidden" name="state" value={replacedAt ? "unmarked" : "marked"} />
          <WaterReplacementToggleButton
            hamsterName={hamsterName}
            replacedAt={replacedAt}
            disabledReason={disabledReason}
            shouldDimWhenDisabled={!readOnly && isActive}
          />
        </form>
      </dd>
    </div>
  );
}
