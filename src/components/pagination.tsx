import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { ScrollPreservingLink } from "@/components/scroll-preserving-link";
import { getPaginationItems } from "@/lib/pagination";

export type PaginationData = {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
};

type PaginationLayoutProps = {
  ariaLabel: string;
  pagination: PaginationData;
  visibleCount: number;
  buildHref: (page: number) => string;
  scroll?: boolean;
  preserveScroll?: boolean;
  emptyMessage?: string;
};

const focusClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

function PaginationLink({
  href,
  scroll,
  preserveScroll,
  className,
  ariaLabel,
  children
}: {
  href: string;
  scroll?: boolean;
  preserveScroll?: boolean;
  className: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return preserveScroll ? (
    <ScrollPreservingLink href={href} className={className} ariaLabel={ariaLabel}>
      {children}
    </ScrollPreservingLink>
  ) : (
    <Link href={href} scroll={scroll} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}

function PreviousControl({
  currentPage,
  buildHref,
  scroll,
  preserveScroll
}: Pick<PaginationLayoutProps, "buildHref" | "scroll" | "preserveScroll"> & { currentPage: number }) {
  const className = `inline-flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-md px-2.5 text-sm font-semibold ${focusClassName}`;

  return currentPage > 1 ? (
    <PaginationLink
      href={buildHref(currentPage - 1)}
      scroll={scroll}
      preserveScroll={preserveScroll}
      className={`${className} text-slate-700 hover:bg-slate-100`}
      ariaLabel="前のページ"
    >
      <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
      前へ
    </PaginationLink>
  ) : (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={`${className} cursor-not-allowed text-slate-400`}
    >
      <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
      前へ
    </button>
  );
}

function NextControl({
  currentPage,
  totalPages,
  buildHref,
  scroll,
  preserveScroll
}: Pick<PaginationLayoutProps, "buildHref" | "scroll" | "preserveScroll"> & {
  currentPage: number;
  totalPages: number;
}) {
  const className = `inline-flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-md px-2.5 text-sm font-semibold ${focusClassName}`;

  return currentPage < totalPages ? (
    <PaginationLink
      href={buildHref(currentPage + 1)}
      scroll={scroll}
      preserveScroll={preserveScroll}
      className={`${className} text-slate-700 hover:bg-slate-100`}
      ariaLabel="次のページ"
    >
      次へ
      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
    </PaginationLink>
  ) : (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={`${className} cursor-not-allowed text-slate-400`}
    >
      次へ
      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
    </button>
  );
}

export function PaginationLayout({
  ariaLabel,
  pagination,
  visibleCount,
  buildHref,
  scroll,
  preserveScroll,
  emptyMessage
}: PaginationLayoutProps) {
  const firstVisibleNumber =
    pagination.totalCount === 0 ? 0 : (pagination.currentPage - 1) * pagination.pageSize + 1;
  const lastVisibleNumber =
    pagination.totalCount === 0 ? 0 : (pagination.currentPage - 1) * pagination.pageSize + visibleCount;
  const pageItems = getPaginationItems(pagination.currentPage, pagination.totalPages);

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="min-w-0">
        {pagination.totalCount === 0 && emptyMessage ? (
          emptyMessage
        ) : (
          <>全{pagination.totalCount}件中 {firstVisibleNumber}～{lastVisibleNumber}件を表示</>
        )}
      </p>

      {pagination.totalCount > 0 ? (
        <nav aria-label={ariaLabel} className="min-w-0">
          <div className="grid min-w-0 grid-cols-3 items-center gap-1 sm:hidden">
            <PreviousControl
              currentPage={pagination.currentPage}
              buildHref={buildHref}
              scroll={scroll}
              preserveScroll={preserveScroll}
            />
            <span aria-current="page" className="px-1 text-center text-sm font-semibold text-slate-600">
              {pagination.currentPage} / {pagination.totalPages}
            </span>
            <NextControl
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              buildHref={buildHref}
              scroll={scroll}
              preserveScroll={preserveScroll}
            />
          </div>

          <div className="hidden items-center gap-0.5 sm:flex">
            <PreviousControl
              currentPage={pagination.currentPage}
              buildHref={buildHref}
              scroll={scroll}
              preserveScroll={preserveScroll}
            />
            {pageItems.map((item, index) =>
              item === "ellipsis" ? (
                <span
                  key={`ellipsis-${index}`}
                  className="inline-flex h-9 min-w-7 items-center justify-center px-1 text-slate-400"
                  aria-hidden="true"
                >
                  …
                </span>
              ) : item === pagination.currentPage ? (
                <span
                  key={item}
                  aria-current="page"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-md bg-brand px-2 text-sm font-bold text-white"
                >
                  {item}
                </span>
              ) : (
                <PaginationLink
                  key={item}
                  href={buildHref(item)}
                  scroll={scroll}
                  preserveScroll={preserveScroll}
                  ariaLabel={`${item}ページへ`}
                  className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-ink ${focusClassName}`}
                >
                  {item}
                </PaginationLink>
              )
            )}
            <NextControl
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              buildHref={buildHref}
              scroll={scroll}
              preserveScroll={preserveScroll}
            />
          </div>
        </nav>
      ) : null}
    </div>
  );
}
