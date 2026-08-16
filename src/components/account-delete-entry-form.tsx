import { Trash2 } from "lucide-react";

import { SETTINGS_CARD_STANDARD_PADDING } from "@/components/settings-layout";

export function AccountDeleteEntryForm() {
  return (
    <section
      className={`rounded-md border border-red-200 bg-white shadow-sm ${SETTINGS_CARD_STANDARD_PADDING}`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-ink">アカウントの削除</h3>
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
              取り消しできない操作
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            アカウントを削除すると、単独で管理しているグループのデータも削除されます。共有中のグループのデータは残ります。
          </p>
        </div>
        <form
          action="/settings/account/delete"
          method="get"
          className="w-full shrink-0 md:w-auto"
        >
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 md:w-auto"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            削除内容を確認する
          </button>
        </form>
      </div>
    </section>
  );
}
