import Link from "next/link";
import { Plus } from "lucide-react";

export function EmptyState({ title, href, actionLabel }: { title: string; href: string; actionLabel: string }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
      <p className="text-base font-semibold text-slate-800">{title}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {actionLabel}
      </Link>
    </div>
  );
}

