import Link from "next/link";
import { ArrowLeft, MessageCircleQuestion } from "lucide-react";

import { AdminContactInquiryList } from "@/components/contact-inquiry-list";
import { AutoSubmitFilterForm } from "@/components/auto-submit-filter-form";
import { PaginationLayout } from "@/components/pagination";
import {
  ADMIN_INQUIRY_FILTERS,
  buildAdminInquiryHref,
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  CONTACT_SEARCH_MAX_LENGTH,
  parseAdminInquiryQuery
} from "@/lib/contact-inquiry-core";
import { getAdminContactInquiryPage } from "@/lib/contact-inquiry-queries";
import { getRequiredAppAdminUser } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

const statusLabels: Record<(typeof ADMIN_INQUIRY_FILTERS)[number], string> = {
  all: "すべて",
  unhandled: "未対応",
  inProgress: "対応中",
  waiting: "回答待ち",
  resolved: "対応済み",
  closed: "終了"
};

export default async function AdminInquiriesPage({
  searchParams
}: {
  searchParams: Promise<{
    page?: string | string[];
    status?: string | string[];
    category?: string | string[];
    search?: string | string[];
  }>;
}) {
  const params = await searchParams;
  await getRequiredAppAdminUser();
  const query = parseAdminInquiryQuery(params);
  const { inquiries, pagination } = await getAdminContactInquiryPage(query);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-moss hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          管理トップへ戻る
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <MessageCircleQuestion className="h-6 w-6 text-moss" aria-hidden />
          <h2 className="text-xl font-bold text-ink">問い合わせ管理</h2>
        </div>
        <p className="mt-1 text-sm text-slate-600">利用者からの問い合わせを検索・確認し、返信や担当者設定を行います。</p>
      </div>

      <AutoSubmitFilterForm
        action="/admin/inquiries"
        className="grid min-w-0 gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[minmax(130px,0.7fr)_minmax(150px,0.8fr)_minmax(240px,1.5fr)_auto] lg:items-end"
      >
        <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
          状態
          <select name="status" defaultValue={query.status}>
            {ADMIN_INQUIRY_FILTERS.map((status) => (
              <option key={status} value={status}>{statusLabels[status]}</option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
          問い合わせ種類
          <select name="category" defaultValue={query.category}>
            <option value="all">すべて</option>
            {CONTACT_CATEGORIES.map((category) => (
              <option key={category} value={category}>{CONTACT_CATEGORY_LABELS[category]}</option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
          検索
          <input
            type="search"
            name="search"
            defaultValue={query.search}
            maxLength={CONTACT_SEARCH_MAX_LENGTH}
            placeholder="番号、件名、利用者名、メール"
            className="min-w-0"
          />
        </label>
        <input type="hidden" name="page" value="1" />
        <Link
          href="/admin/inquiries"
          scroll={false}
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:col-span-2 lg:col-span-1"
        >
          条件をクリア
        </Link>
      </AutoSubmitFilterForm>

      <PaginationLayout
        ariaLabel="問い合わせ管理一覧のページ移動"
        pagination={pagination}
        visibleCount={inquiries.length}
        emptyMessage="条件に一致する問い合わせはありません。"
        buildHref={(page) => buildAdminInquiryHref(query, page)}
      />
      <AdminContactInquiryList inquiries={inquiries} />
      {inquiries.length > 0 ? (
        <PaginationLayout
          ariaLabel="問い合わせ管理一覧のページ移動"
          pagination={pagination}
          visibleCount={inquiries.length}
          buildHref={(page) => buildAdminInquiryHref(query, page)}
        />
      ) : null}
    </div>
  );
}
