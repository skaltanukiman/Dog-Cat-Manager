"use client";

import { ChevronDown } from "lucide-react";
import { Fragment, useId, useState } from "react";

export type MemoryHamsterOption = {
  id: string;
  name: string;
  isActive: boolean;
};

export function shouldInitiallyExpand({
  hamsterCount,
  isEditing
}: {
  hamsterCount: number;
  isEditing: boolean;
}) {
  if (hamsterCount <= 1) return false;
  if (isEditing) return false;
  return hamsterCount <= 4;
}

export function getMemoryHamsterSelectionSummary({
  hamsters,
  selectedIds,
  representativeId
}: {
  hamsters: MemoryHamsterOption[];
  selectedIds: Iterable<string>;
  representativeId: string;
}) {
  const selectedIdSet = new Set(selectedIds);
  const selectedHamsters = hamsters.filter((hamster) => selectedIdSet.has(hamster.id));
  const effectiveRepresentativeId = selectedIdSet.has(representativeId)
    ? representativeId
    : selectedHamsters[0]?.id ?? null;
  const orderedHamsters = [
    ...selectedHamsters.filter((hamster) => hamster.id === effectiveRepresentativeId),
    ...selectedHamsters.filter((hamster) => hamster.id !== effectiveRepresentativeId)
  ];

  return {
    visibleHamsters: orderedHamsters.slice(0, 2),
    additionalCount: Math.max(orderedHamsters.length - 2, 0),
    selectedCount: orderedHamsters.length,
    effectiveRepresentativeId
  };
}

export function updateMemoryHamsterSelection(
  selectedIds: ReadonlySet<string>,
  hamsterId: string,
  checked: boolean
) {
  const next = new Set(selectedIds);
  if (checked) next.add(hamsterId);
  else next.delete(hamsterId);
  return next;
}

export function MemoryHamsterSelector({
  hamsters,
  selectedIds,
  representativeId,
  lockRepresentative = false,
  isEditing = false,
  readOnly = false,
  hasError = false
}: {
  hamsters: MemoryHamsterOption[];
  selectedIds: string[];
  representativeId: string;
  lockRepresentative?: boolean;
  isEditing?: boolean;
  readOnly?: boolean;
  hasError?: boolean;
}) {
  const selectionRegionId = useId();
  const [selected, setSelected] = useState(() => {
    const validIds = new Set(hamsters.map((hamster) => hamster.id));
    const initialIds = new Set(selectedIds.filter((id) => validIds.has(id)));
    if (lockRepresentative && validIds.has(representativeId)) initialIds.add(representativeId);
    return initialIds;
  });
  const [isExpanded, setIsExpanded] = useState(() =>
    shouldInitiallyExpand({ hamsterCount: hamsters.length, isEditing })
  );

  if (hamsters.length === 1) {
    const hamster = hamsters[0];
    return (
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold text-slate-700">対象ハムスター</legend>
        {!readOnly ? <input type="hidden" name="hamsterIds" value={hamster.id} /> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-moss bg-moss/5 px-3 py-2 text-sm font-semibold text-ink">
          <span className="min-w-0 break-words">{hamster.name}</span>
          <span className="shrink-0 rounded-full bg-moss/10 px-2 py-0.5 text-[11px] font-bold text-moss">
            代表
          </span>
          {!hamster.isActive ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              管理外
            </span>
          ) : null}
        </div>
      </fieldset>
    );
  }

  const expanded = hasError || isExpanded;
  const summary = getMemoryHamsterSelectionSummary({ hamsters, selectedIds: selected, representativeId });

  return (
    <fieldset className="grid gap-2" aria-invalid={hasError || undefined}>
      <legend className="text-sm font-semibold text-slate-700">対象ハムスター（複数選択可）</legend>
      <div className={`rounded-lg border p-3 ${hasError ? "border-red-300 bg-red-50/50" : "border-slate-200 bg-slate-50/60"}`}>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 break-words text-sm leading-6 text-slate-700" aria-live="polite">
            {summary.visibleHamsters.length > 0 ? (
              summary.visibleHamsters.map((hamster, index) => (
                <Fragment key={hamster.id}>
                  {index > 0 ? "、" : null}
                  <span className="font-semibold text-ink">{hamster.name}</span>
                  {hamster.id === summary.effectiveRepresentativeId ? (
                    <span className="ml-1 inline-flex rounded-full bg-moss/10 px-2 py-0.5 align-middle text-[11px] font-bold leading-5 text-moss">
                      代表
                    </span>
                  ) : null}
                </Fragment>
              ))
            ) : (
              <span className="font-semibold text-red-700">未選択</span>
            )}
            {summary.additionalCount > 0 ? `、ほか${summary.additionalCount}匹` : null}
            <span className="whitespace-nowrap text-slate-500">・{summary.selectedCount}匹選択中</span>
          </p>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={selectionRegionId}
            data-preview-toggle={readOnly ? "true" : undefined}
            onClick={() => setIsExpanded((current) => !current)}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1 self-start rounded-md border border-moss bg-white px-3 text-sm font-semibold text-moss transition hover:bg-moss/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 sm:self-auto"
          >
            {expanded ? "閉じる" : "変更"}
            <ChevronDown
              className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
        </div>

        <div
          id={selectionRegionId}
          className={`${expanded ? "mt-3" : "hidden"}`}
          aria-label="対象ハムスターの選択一覧"
        >
          <div className="grid max-h-64 gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-none sm:grid-cols-2 lg:grid-cols-3">
            {hamsters.map((hamster, index) => {
              const isRepresentative = hamster.id === summary.effectiveRepresentativeId;
              const isLockedRepresentative = lockRepresentative && hamster.id === representativeId;
              const checked = isLockedRepresentative || selected.has(hamster.id);
              const representativeLabelId = `${selectionRegionId}-representative-${hamster.id}`;
              return (
                <label
                  key={hamster.id}
                  className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                    checked
                      ? "border-moss bg-moss/5 font-semibold text-ink ring-1 ring-inset ring-moss/20"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {isLockedRepresentative ? (
                    <>
                      {!readOnly ? <input type="hidden" name="hamsterIds" value={hamster.id} /> : null}
                      <input
                        type="checkbox"
                        checked
                        disabled
                        aria-disabled="true"
                        aria-describedby={representativeLabelId}
                        readOnly
                      />
                    </>
                  ) : (
                    <input
                      type="checkbox"
                      name={readOnly ? undefined : "hamsterIds"}
                      value={hamster.id}
                      checked={checked}
                      disabled={readOnly}
                      aria-disabled={readOnly || undefined}
                      required={!readOnly && summary.selectedCount === 0 && index === 0}
                      onInvalid={() => setIsExpanded(true)}
                      onChange={(event) => {
                        setSelected((current) =>
                          updateMemoryHamsterSelection(current, hamster.id, event.target.checked)
                        );
                      }}
                    />
                  )}
                  <span className="min-w-0 flex-1 break-words">{hamster.name}</span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {isRepresentative ? (
                      <span id={representativeLabelId} className="rounded-full bg-moss/10 px-2 py-0.5 text-[11px] font-bold text-moss">
                        代表
                      </span>
                    ) : null}
                    {!hamster.isActive ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        管理外
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
          {hamsters.length >= 5 ? (
            <p className="mt-2 text-xs leading-5 text-slate-500 sm:hidden">一覧内を上下にスクロールして選択できます。</p>
          ) : null}
        </div>
      </div>
      <p className="text-xs leading-5 text-slate-500">
        {lockRepresentative
          ? "現在選択中のハムスターを代表として、同じグループのハムスターを追加できます。"
          : "1匹以上を選択してください。代表を外した場合は、選択中の先頭が新しい代表になります。"}
      </p>
    </fieldset>
  );
}
