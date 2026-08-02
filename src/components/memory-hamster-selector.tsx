"use client";

import { useState } from "react";

type HamsterOption = {
  id: string;
  name: string;
  isActive: boolean;
};

export function MemoryHamsterSelector({
  hamsters,
  selectedIds,
  representativeId,
  lockRepresentative = false
}: {
  hamsters: HamsterOption[];
  selectedIds: string[];
  representativeId: string;
  lockRepresentative?: boolean;
}) {
  const [selected, setSelected] = useState(() => {
    const validIds = new Set(hamsters.map((hamster) => hamster.id));
    return new Set(selectedIds.filter((id) => validIds.has(id)));
  });

  const selectedCount = selected.size;

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold text-slate-700">対象ハムスター（複数選択可）</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {hamsters.map((hamster, index) => {
          const isRepresentative = hamster.id === representativeId;
          const isLockedRepresentative = lockRepresentative && isRepresentative;
          const checked = isLockedRepresentative || selected.has(hamster.id);
          return (
            <label
              key={hamster.id}
              className={`flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                checked
                  ? "border-moss bg-moss/5 font-semibold text-ink ring-1 ring-inset ring-moss/20"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {isLockedRepresentative ? (
                <>
                  <input type="hidden" name="hamsterIds" value={hamster.id} />
                  <input type="checkbox" checked disabled aria-describedby={`memory-representative-${hamster.id}`} />
                </>
              ) : (
                <input
                  type="checkbox"
                  name="hamsterIds"
                  value={hamster.id}
                  checked={checked}
                  required={selectedCount === 0 && index === 0}
                  onChange={(event) => {
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(hamster.id);
                      else next.delete(hamster.id);
                      return next;
                    });
                  }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{hamster.name}</span>
              {isRepresentative ? (
                <span id={`memory-representative-${hamster.id}`} className="shrink-0 rounded-full bg-moss/10 px-2 py-0.5 text-[11px] font-bold text-moss">
                  代表
                </span>
              ) : null}
              {!hamster.isActive ? <span className="shrink-0 text-[11px] font-medium text-slate-500">管理外</span> : null}
            </label>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-slate-500">
        {lockRepresentative
          ? "現在選択中のハムスターを代表として、同じグループのハムスターを追加できます。"
          : "1匹以上を選択してください。代表を外した場合は、選択中の先頭が新しい代表になります。"}
      </p>
    </fieldset>
  );
}
