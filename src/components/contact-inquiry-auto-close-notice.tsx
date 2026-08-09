import { getContactInquiryAutoCloseAt } from "@/lib/contact-inquiry-core";
import { formatDateTimeJst } from "@/lib/date";

/** 管理者側の対応完了後も利用者が返信できることと、JSTの自動終了目安を案内する。 */
export function ContactInquiryAutoCloseNotice({ resolvedAt }: { resolvedAt: Date | null }) {
  const autoCloseAt = resolvedAt ? getContactInquiryAutoCloseAt(resolvedAt) : null;

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
      <p className="font-semibold text-ink">このお問い合わせへの対応は完了しています。</p>
      <p className="mt-1">
        追加で確認したいことがある場合は、このまま返信できます。
      </p>
      {autoCloseAt ? (
        <p className="mt-1">
          返信がない場合は、{formatDateTimeJst(autoCloseAt)}以降の自動処理でこのお問い合わせを終了します。
        </p>
      ) : null}
    </div>
  );
}
