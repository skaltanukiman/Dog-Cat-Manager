import { getContactInquiryAutoCloseAt } from "@/lib/contact-inquiry-core";
import { formatDateTimeJst } from "@/lib/date";

/** 対応済みの間も返信可能であることと、JSTの自動終了目安を案内する。 */
export function ContactInquiryAutoCloseNotice({ resolvedAt }: { resolvedAt: Date | null }) {
  const autoCloseAt = resolvedAt ? getContactInquiryAutoCloseAt(resolvedAt) : null;

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
      <p className="font-semibold text-ink">この問い合わせは対応済みです。</p>
      <p className="mt-1">
        追加の返信がない場合、対応済みになってから7日後に自動的に終了します。
      </p>
      {autoCloseAt ? (
        <p className="mt-1">
          {formatDateTimeJst(autoCloseAt)}以降、次回の自動処理で終了予定です。
        </p>
      ) : null}
    </div>
  );
}
