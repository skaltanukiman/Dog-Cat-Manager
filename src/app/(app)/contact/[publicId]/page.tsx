import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { ContactMessageThread } from "@/components/contact-message-thread";
import { UserContactReplyForm } from "@/components/contact-reply-form";
import { ContactCategoryBadge, ContactStatusBadge } from "@/components/contact-status-badge";
import { StatusMessage } from "@/components/status-message";
import { getRequiredSessionUser } from "@/lib/auth-context";
import { getUserContactInquiryDetail } from "@/lib/contact-inquiry-queries";
import { formatDateTimeJst } from "@/lib/date";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContactDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const [{ publicId }, query] = await Promise.all([params, searchParams]);
  const user = await getRequiredSessionUser();
  const inquiry = await getUserContactInquiryDetail(user.id, publicId);
  if (!inquiry) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contact" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-moss hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          お問い合わせへ戻る
        </Link>
        <h2 className="mt-2 break-words text-xl font-bold text-ink [overflow-wrap:anywhere]">{inquiry.subject}</h2>
        <p className="mt-1 break-all text-sm font-semibold text-slate-500">{inquiry.publicId}</p>
      </div>

      <StatusMessage status={getParam(query.status)} errorId={getParam(query.errorId)} />

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold text-slate-500">状態</dt>
            <dd className="mt-1"><ContactStatusBadge status={inquiry.status} /></dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">問い合わせ種類</dt>
            <dd className="mt-1"><ContactCategoryBadge category={inquiry.category} /></dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">問い合わせ番号</dt>
            <dd className="mt-1 break-all font-semibold text-ink">{inquiry.publicId}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <dt className="text-xs font-semibold text-slate-500">件名</dt>
            <dd className="mt-1 break-words text-slate-700 [overflow-wrap:anywhere]">{inquiry.subject}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-slate-500">エラーID</dt>
            <dd className="mt-1 break-all text-slate-700">{inquiry.errorId || "未入力"}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-xs font-semibold text-slate-500">発生した画面</dt>
            <dd className="mt-1 break-all text-slate-700">{inquiry.sourcePath || "未入力"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">受付日時</dt>
            <dd className="mt-1 text-slate-700">{formatDateTimeJst(inquiry.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">最終更新日時</dt>
            <dd className="mt-1 text-slate-700">{formatDateTimeJst(inquiry.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3" aria-labelledby="contact-messages-title">
        <h3 id="contact-messages-title" className="text-base font-bold text-ink">メッセージ履歴</h3>
        <ContactMessageThread messages={inquiry.messages} />
      </section>

      {inquiry.status === "CLOSED" ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          この問い合わせは終了しています。追加の返信はできません。別の内容は新しい問い合わせとして送信してください。
        </div>
      ) : (
        <UserContactReplyForm publicId={inquiry.publicId} />
      )}
    </div>
  );
}
