"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

export type MemoryPetOption = {
  id: string;
  name: string;
  species: "DOG" | "CAT";
  isActive: boolean;
};

export function shouldInitiallyExpandPetMemory({
  petCount,
  isEditing
}: {
  petCount: number;
  isEditing: boolean;
}) {
  if (petCount <= 1 || isEditing) return false;
  return petCount <= 4;
}

export function getMemoryPetSelectionSummary({
  pets,
  selectedIds,
  representativeId
}: {
  pets: MemoryPetOption[];
  selectedIds: Iterable<string>;
  representativeId: string;
}) {
  const selectedIdSet = new Set(selectedIds);
  const selectedPets = pets.filter((pet) => selectedIdSet.has(pet.id));
  const effectiveRepresentativeId = selectedIdSet.has(representativeId)
    ? representativeId
    : selectedPets[0]?.id ?? null;
  const orderedPets = [
    ...selectedPets.filter((pet) => pet.id === effectiveRepresentativeId),
    ...selectedPets.filter((pet) => pet.id !== effectiveRepresentativeId)
  ];

  return {
    visiblePets: orderedPets.slice(0, 2),
    additionalCount: Math.max(orderedPets.length - 2, 0),
    selectedCount: orderedPets.length,
    effectiveRepresentativeId
  };
}

export function updateMemoryPetSelection(
  selectedIds: ReadonlySet<string>,
  petId: string,
  checked: boolean
) {
  const next = new Set(selectedIds);
  if (checked) next.add(petId);
  else next.delete(petId);
  return next;
}

/**
 * 1件の思い出に関連付けるPetを選択順付きで送信する。
 * 管理終了Petは新たに選べず、代表を外した場合は選択順の先頭を次の代表として表示する。
 */
export function MemoryPetSelector({
  pets,
  selectedIds,
  representativeId,
  lockRepresentative = false,
  isEditing = false,
  readOnly = false,
  hasError = false
}: {
  pets: MemoryPetOption[];
  selectedIds: string[];
  representativeId: string;
  lockRepresentative?: boolean;
  isEditing?: boolean;
  readOnly?: boolean;
  hasError?: boolean;
}) {
  const selectionRegionId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [selected, setSelected] = useState(() => {
    const validIds = new Set(pets.map((pet) => pet.id));
    const initialIds = new Set(selectedIds.filter((id) => validIds.has(id)));
    if (lockRepresentative && validIds.has(representativeId)) initialIds.add(representativeId);
    return initialIds;
  });
  const [isOpen, setIsOpen] = useState(() =>
    shouldInitiallyExpandPetMemory({ petCount: pets.length, isEditing })
  );

  useEffect(() => {
    if (hasError && detailsRef.current) detailsRef.current.open = true;
  }, [hasError]);

  if (pets.length === 1) {
    const pet = pets[0];
    return (
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold text-slate-700">対象Pet</legend>
        {!readOnly ? <input type="hidden" name="petIds" value={pet.id} /> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-brand bg-brand/5 px-3 py-2 text-sm font-semibold text-ink">
          <span className="min-w-0 break-words">{pet.name}（{pet.species === "DOG" ? "犬" : "猫"}）</span>
          <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">代表</span>
        </div>
      </fieldset>
    );
  }

  const summary = getMemoryPetSelectionSummary({ pets, selectedIds: selected, representativeId });

  return (
    <fieldset className="grid gap-2" aria-label="対象Pet（複数選択可）" aria-invalid={hasError || undefined}>
      <details
        ref={detailsRef}
        open={hasError || isOpen}
        onToggle={(event) => setIsOpen(event.currentTarget.open)}
        className={`group rounded-md border bg-slate-50 px-3 py-2 ${hasError ? "border-red-300" : "border-slate-200"}`}
      >
        <summary className="cursor-pointer list-none text-sm text-slate-700 select-none focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
          <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2">
            <span className="flex h-5 shrink-0 items-center">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-90" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 leading-5">
              <span className="font-semibold text-slate-700">対象Pet（複数選択可）</span>
              <span className="min-w-0 break-words text-slate-600" aria-live="polite">
                {summary.visiblePets.length > 0 ? (
                  summary.visiblePets.map((pet, index) => (
                    <Fragment key={pet.id}>
                      {index > 0 ? "、" : null}
                      <span className="font-semibold text-ink">
                        {pet.name}{pet.id === summary.effectiveRepresentativeId ? "（代表）" : null}
                      </span>
                    </Fragment>
                  ))
                ) : (
                  <span className="font-semibold text-red-700">未選択</span>
                )}
                {summary.additionalCount > 0 ? `、ほか${summary.additionalCount}匹` : null}
                <span className="whitespace-nowrap text-slate-500">・{summary.selectedCount}匹選択中</span>
              </span>
            </span>
          </span>
        </summary>
        <div id={selectionRegionId} className="mt-2 border-t border-slate-200 pt-3" aria-label="対象Petの選択一覧">
          <div className="grid max-h-64 gap-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-none sm:grid-cols-2 lg:grid-cols-3">
            {pets.map((pet, index) => {
              const isRepresentative = pet.id === summary.effectiveRepresentativeId;
              const isLockedRepresentative = lockRepresentative && pet.id === representativeId;
              const checked = isLockedRepresentative || selected.has(pet.id);
              const disabled = readOnly || !pet.isActive || isLockedRepresentative;
              const representativeLabelId = `${selectionRegionId}-representative-${pet.id}`;
              return (
                <label
                  key={pet.id}
                  className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                    checked
                      ? "border-brand bg-brand/5 font-semibold text-ink ring-1 ring-inset ring-brand/20"
                      : "border-slate-200 bg-white text-slate-700"
                  } ${!pet.isActive ? "opacity-60" : ""}`}
                >
                  {isLockedRepresentative ? <input type="hidden" name="petIds" value={pet.id} /> : null}
                  <input
                    type="checkbox"
                    name={!readOnly && !isLockedRepresentative ? "petIds" : undefined}
                    value={pet.id}
                    checked={checked}
                    disabled={disabled}
                    aria-disabled={disabled || undefined}
                    aria-describedby={isRepresentative ? representativeLabelId : undefined}
                    required={!readOnly && summary.selectedCount === 0 && index === 0}
                    onInvalid={() => {
                      if (detailsRef.current) detailsRef.current.open = true;
                    }}
                    onChange={(event) => {
                      setSelected((current) => updateMemoryPetSelection(current, pet.id, event.target.checked));
                    }}
                  />
                  <span className="min-w-0 flex-1 break-words">{pet.name}（{pet.species === "DOG" ? "犬" : "猫"}）</span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {isRepresentative ? <span id={representativeLabelId} className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">代表</span> : null}
                    {!pet.isActive ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">管理終了</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </details>
      <p className="text-xs leading-5 text-slate-500">
        {lockRepresentative
          ? "現在選択中のPetを代表として、同じ共有グループの管理中Petを追加できます。"
          : "管理中のPetを1匹以上選択してください。代表を外した場合は、選択中の先頭が新しい代表になります。"}
      </p>
    </fieldset>
  );
}
