import { MessageCircleQuestion } from "lucide-react";

import { ContactInquiryForm } from "@/components/contact-inquiry-form";
import { ContactInquiryList } from "@/components/contact-inquiry-list";
import { PaginationLayout } from "@/components/pagination";
import { StatusMessage } from "@/components/status-message";
import { getRequiredSessionUser } from "@/lib/auth-context";
import {
  normalizeContactPage,
  parseInitialErrorId,
  parseInitialSourcePath
} from "@/lib/contact-inquiry-core";
import { getUserContactInquiryPage } from "@/lib/contact-inquiry-queries";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContactPage({
  searchParams
}: {
  searchParams: Promise<{
    page?: string | string[];
    errorId?: string | string[];
    sourcePath?: string | string[];
    status?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const user = await getRequiredSessionUser();
  const { inquiries, pagination } = await getUserContactInquiryPage(
    user.id,
    normalizeContactPage(params.page)
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="h-6 w-6 text-moss" aria-hidden />
          <h2 className="text-xl font-bold text-ink">サポート・お問い合わせ</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          アプリの不具合、使い方、機能に関するご要望、アカウントに関するお問い合わせを送信できます。
        </p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      <ContactInquiryForm
        email={user.email ?? null}
        initialErrorId={parseInitialErrorId(params.errorId)}
        initialSourcePath={parseInitialSourcePath(params.sourcePath)}
      />

      <section className="space-y-3" aria-labelledby="contact-history-title">
        <div>
          <h3 id="contact-history-title" className="text-base font-bold text-ink">問い合わせ履歴</h3>
          <p className="mt-1 text-sm text-slate-600">あなたが送信した問い合わせだけを表示します。</p>
        </div>
        <PaginationLayout
          ariaLabel="問い合わせ履歴のページ移動"
          pagination={pagination}
          visibleCount={inquiries.length}
          emptyMessage="問い合わせ履歴はまだありません。"
          buildHref={(page) => (page > 1 ? `/contact?page=${page}` : "/contact")}
        />
        <ContactInquiryList inquiries={inquiries} />
        {inquiries.length > 0 ? (
          <PaginationLayout
            ariaLabel="問い合わせ履歴のページ移動"
            pagination={pagination}
            visibleCount={inquiries.length}
            buildHref={(page) => (page > 1 ? `/contact?page=${page}` : "/contact")}
          />
        ) : null}
      </section>
    </div>
  );
}
