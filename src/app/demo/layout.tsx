import type { Metadata } from "next";
import Link from "next/link";
import { Info, LogIn } from "lucide-react";

import { DemoNav } from "@/components/demo-nav";
import { PUBLIC_DEMO_DIFFERENCE_NOTICE } from "@/lib/public-demo";

export const metadata: Metadata = {
  title: "サンプル閲覧 | Hamster Manager",
  robots: {
    index: false,
    follow: false
  }
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-persimmon">Hamster Manager</p>
              <h1 className="mt-1 text-xl font-bold text-ink sm:text-2xl">サンプル閲覧モード</h1>
              <div className="mt-2 text-xs leading-5 text-slate-600 sm:text-sm">
                <p>この画面のデータはサンプルです。</p>
                <p>登録・編集・削除はできません。</p>
                <div className="mt-2 flex max-w-3xl gap-2 rounded-md border-l-4 border-moss bg-moss/5 px-3 py-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-moss" aria-hidden />
                  <p>
                    <span className="font-semibold text-slate-700">デモ表示について：</span>
                    {PUBLIC_DEMO_DIFFERENCE_NOTICE}
                  </p>
                </div>
              </div>
            </div>
            <Link
              href="/login"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-moss bg-white px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white sm:w-auto"
            >
              <LogIn className="h-4 w-4" aria-hidden />
              ログインして利用する
            </Link>
          </div>
          <DemoNav />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
