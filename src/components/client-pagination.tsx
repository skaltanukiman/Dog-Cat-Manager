"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { getPaginationItems } from "@/lib/pagination";

type ClientPaginationProps = {
  ariaLabel: string;
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  visibleCount: number;
  onPageChange: (page: number) => void;
};

const focusClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

export function ClientPagination({
  ariaLabel,
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  visibleCount,
  onPageChange
}: ClientPaginationProps) {
  const firstVisibleNumber = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisibleNumber = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + visibleCount;
  const pageItems = getPaginationItems(currentPage, totalPages);
  const previousDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  const navigationClassName = `inline-flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-md px-2.5 text-sm font-semibold ${focusClassName}`;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="min-w-0">
        全{totalCount}件中 {firstVisibleNumber}～{lastVisibleNumber}件を表示
      </p>

      {totalCount > 0 ? (
        <nav aria-label={ariaLabel} className="min-w-0">
          <div className="grid min-w-0 grid-cols-3 items-center gap-1 sm:hidden">
            <button
              type="button"
              disabled={previousDisabled}
              aria-disabled={previousDisabled}
              onClick={() => onPageChange(currentPage - 1)}
              className={`${navigationClassName} ${
                previousDisabled ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
              前へ
            </button>
            <span aria-current="page" className="px-1 text-center text-sm font-semibold text-slate-600">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={nextDisabled}
              aria-disabled={nextDisabled}
              onClick={() => onPageChange(currentPage + 1)}
              className={`${navigationClassName} ${
                nextDisabled ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              次へ
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
            </button>
          </div>

          <div className="hidden items-center gap-0.5 sm:flex">
            <button
              type="button"
              disabled={previousDisabled}
              aria-disabled={previousDisabled}
              onClick={() => onPageChange(currentPage - 1)}
              className={`${navigationClassName} ${
                previousDisabled ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
              前へ
            </button>
            {pageItems.map((item, index) =>
              item === "ellipsis" ? (
                <span
                  key={`ellipsis-${index}`}
                  className="inline-flex h-9 min-w-7 items-center justify-center px-1 text-slate-400"
                  aria-hidden="true"
                >
                  …
                </span>
              ) : item === currentPage ? (
                <span
                  key={item}
                  aria-current="page"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-md bg-brand px-2 text-sm font-bold text-white"
                >
                  {item}
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPageChange(item)}
                  aria-label={`${item}ページへ`}
                  className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-ink ${focusClassName}`}
                >
                  {item}
                </button>
              )
            )}
            <button
              type="button"
              disabled={nextDisabled}
              aria-disabled={nextDisabled}
              onClick={() => onPageChange(currentPage + 1)}
              className={`${navigationClassName} ${
                nextDisabled ? "cursor-not-allowed text-slate-400" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              次へ
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
