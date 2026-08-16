import Link from "next/link";
import { MessageCircleQuestion } from "lucide-react";

import { SETTINGS_CARD_STANDARD_PADDING } from "@/components/settings-layout";

export function ContactSupportEntry() {
  return (
    <section className={`rounded-md border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_STANDARD_PADDING}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <h3 className="text-base font-bold text-ink">サポート・お問い合わせ</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            アプリの不具合、使い方、機能のご要望について管理者へ問い合わせることができます。
          </p>
        </div>
        <Link
          href="/contact"
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-md border border-brand bg-white px-4 py-2.5 text-sm font-bold text-brand hover:bg-brand-dark hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 md:w-auto"
        >
          お問い合わせを開く
        </Link>
      </div>
    </section>
  );
}
