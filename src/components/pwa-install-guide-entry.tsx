import { Smartphone } from "lucide-react";
import Link from "next/link";

import { SETTINGS_CARD_STANDARD_PADDING } from "@/components/settings-layout";

export function PwaInstallGuideEntry() {
  return (
    <section className={`rounded-md border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_STANDARD_PADDING}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <h3 className="text-base font-bold text-ink">ホーム画面に追加</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            iPhoneでDog &amp; Cat Managerをアプリのように使う手順を確認できます。
          </p>
        </div>
        <Link
          href="/settings/pwa"
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-md border border-brand bg-white px-4 py-2.5 text-sm font-bold text-brand hover:bg-brand-dark hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 md:w-28"
        >
          手順を見る
        </Link>
      </div>
    </section>
  );
}
