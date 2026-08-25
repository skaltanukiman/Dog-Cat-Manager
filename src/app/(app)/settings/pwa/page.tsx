import { ChevronLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const IPHONE_PWA_STEPS = [
  {
    summary: "右下の「…」をタップ",
    src: "/help/pwa/iphone/step-1.png",
    alt: "手順1：画面右下の三点メニューをタップ",
    width: 851,
    height: 1849
  },
  {
    summary: "「共有」をタップ",
    src: "/help/pwa/iphone/step-2.png",
    alt: "手順2：ブラウザメニューから共有をタップ",
    width: 863,
    height: 1822
  },
  {
    summary: "「表示を増やす」をタップ",
    src: "/help/pwa/iphone/step-3.png",
    alt: "手順3：共有シートで表示を増やすをタップ",
    width: 864,
    height: 1821
  },
  {
    summary: "「ホーム画面に追加」をタップ",
    src: "/help/pwa/iphone/step-4.png",
    alt: "手順4：ホーム画面に追加をタップ",
    width: 863,
    height: 1822
  },
  {
    summary: "「Webアプリとして開く」をオンのまま「追加」をタップ",
    src: "/help/pwa/iphone/step-5.png",
    alt: "手順5：Webアプリとして開くをオンのまま追加をタップ",
    width: 863,
    height: 1822
  }
] as const;

export default function PwaInstallGuidePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-slate-600 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          設定に戻る
        </Link>
        <h2 className="mt-3 text-xl font-bold text-ink">iPhoneでホーム画面に追加</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Dog &amp; Cat Managerをホーム画面に追加すると、Webアプリとしてすばやく起動できます。
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          画面や項目名は、iOSやブラウザのバージョンによって異なる場合があります。
        </p>
      </div>

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-bold text-ink">操作概要</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700 marker:font-bold marker:text-brand">
          {IPHONE_PWA_STEPS.map((step) => (
            <li key={step.src}>{step.summary}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="pwa-guide-images-heading">
        <h3 id="pwa-guide-images-heading" className="text-base font-bold text-ink">
          画像で手順を確認
        </h3>
        <ol className="mt-4 space-y-8">
          {IPHONE_PWA_STEPS.map((step, index) => (
            <li key={step.src} className="mx-auto w-full max-w-xl list-none">
              <p className="mb-2 text-sm font-bold tracking-wide text-brand">
                STEP {index + 1} / {IPHONE_PWA_STEPS.length}
              </p>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {/* public配下も認証対象のため、利用者の認証付きリクエストで画像を直接取得する。 */}
                <Image
                  src={step.src}
                  alt={step.alt}
                  width={step.width}
                  height={step.height}
                  sizes="(max-width: 640px) calc(100vw - 2rem), 36rem"
                  className="block h-auto w-full"
                  priority={index === 0}
                  unoptimized
                />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="border-t border-slate-200 pt-5">
        <Link
          href="/settings"
          className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-md border border-brand bg-white px-4 py-2.5 text-sm font-bold text-brand hover:bg-brand-dark hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:w-auto"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          設定に戻る
        </Link>
      </div>
    </div>
  );
}
