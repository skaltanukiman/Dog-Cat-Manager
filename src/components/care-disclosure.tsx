"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/**
 * Care本文をDOMに残したまま高さを補間し、閉状態ではinertにして隠れたフォームへの操作を防ぐ。
 */
export function CareDisclosure({
  defaultOpen,
  header,
  headerClassName,
  children
}: {
  defaultOpen: boolean;
  header: ReactNode;
  headerClassName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const easing = "ease-[cubic-bezier(0.22,1,0.36,1)]";

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white/40">
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex min-h-16 w-full cursor-pointer items-start gap-3 border-l-4 px-4 py-3 text-left hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${headerClassName}`}
      >
        {header}
        <ChevronDown
          className={`mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform duration-[250ms] ${easing} motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-[250ms] ${easing} motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            id={contentId}
            inert={!open}
            aria-hidden={!open}
            className={`border-t border-slate-200 transition-[opacity,transform] duration-[250ms] ${easing} motion-reduce:transition-none ${open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"}`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
