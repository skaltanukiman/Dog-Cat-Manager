"use client";

import Link from "next/link";
import { ChevronDown, Download } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function PetWeightDataManagementMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative sm:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label={isOpen ? "CSVメニューを閉じる" : "CSVメニューを開く"}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium text-brand transition-colors hover:text-brand-dark active:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        <span>CSV</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : "rotate-0"}`}
          aria-hidden
        />
      </button>

      <div
        id={menuId}
        role="menu"
        aria-label="体重データ管理"
        aria-hidden={!isOpen}
        className={`absolute right-0 z-20 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-1.5 shadow-md shadow-slate-900/10 transition-[opacity,transform] duration-200 ${
          isOpen ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <Link
          href="/weights/export"
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
          onClick={() => setIsOpen(false)}
          className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Download className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>CSVエクスポート</span>
        </Link>
      </div>
    </div>
  );
}
