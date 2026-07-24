import type { ContactCategory, ContactStatus } from "@/lib/contact-inquiry-core";
import {
  CONTACT_CATEGORY_LABELS,
  CONTACT_STATUS_LABELS
} from "@/lib/contact-inquiry-core";

const statusClasses: Record<ContactStatus, string> = {
  OPEN: "border-amber-200 bg-amber-50 text-amber-800",
  IN_PROGRESS: "border-sky-200 bg-sky-50 text-sky-800",
  WAITING_FOR_USER: "border-violet-200 bg-violet-50 text-violet-800",
  RESOLVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CLOSED: "border-slate-200 bg-slate-100 text-slate-700"
};

const compactStatusLabels: Record<ContactStatus, string> = {
  OPEN: "\u53d7\u4ed8\u6e08\u307f",
  IN_PROGRESS: "\u78ba\u8a8d\u4e2d",
  WAITING_FOR_USER: "\u56de\u7b54\u5f85\u3061",
  RESOLVED: "\u5bfe\u5fdc\u6e08\u307f",
  CLOSED: "\u7d42\u4e86"
};

type ContactStatusBadgeProps = {
  status: ContactStatus;
  compact?: boolean;
};

export function ContactStatusBadge({ status, compact = false }: ContactStatusBadgeProps) {
  const label = compact ? compactStatusLabels[status] : CONTACT_STATUS_LABELS[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${compact ? "whitespace-nowrap " : ""}${statusClasses[status]}`}
      aria-label={compact ? CONTACT_STATUS_LABELS[status] : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

export function ContactCategoryBadge({ category }: { category: ContactCategory }) {
  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
      {CONTACT_CATEGORY_LABELS[category]}
    </span>
  );
}
