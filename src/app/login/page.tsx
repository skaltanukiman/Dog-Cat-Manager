import Link from "next/link";
import { Eye, LogIn } from "lucide-react";

import { signIn } from "@/auth";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeCallbackUrl(value: FormDataEntryValue | string | undefined | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

async function signInWithGoogle(formData: FormData) {
  "use server";

  await signIn("google", {
    redirectTo: safeCallbackUrl(formData.get("callbackUrl"))
  });
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
    status?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(getParam(params.callbackUrl));
  const hasAuthError = Boolean(getParam(params.error));
  const accountStatus = getParam(params.status);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center">
      <section className="w-full rounded-md border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-persimmon">Hamster Manager</p>
        <h2 className="mt-2 text-2xl font-bold text-ink">ログイン</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          ハムスター管理を利用するには Google アカウントでログインしてください。
        </p>
        {hasAuthError ? (
          <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Googleログインに失敗しました。時間をおいて再度お試しください。
          </p>
        ) : null}
        {accountStatus === "accountDeleted" ? (
          <div
            role="status"
            className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            <p className="font-semibold">
              アカウントの削除が完了しました。ご利用ありがとうございました。
            </p>
            <p className="mt-1 text-xs leading-5 text-emerald-700">
              同じGoogleアカウントで再度ログインした場合は、新しいアカウントとして開始されます。
            </p>
          </div>
        ) : null}
        {accountStatus === "accountAlreadyDeleted" ? (
          <p role="status" className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            このアカウントは既に削除されています。
          </p>
        ) : null}
        {accountStatus === "accountSuspended" ? (
          <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-semibold">このアカウントは現在利用を停止されています。</p>
            <p className="mt-1 text-xs leading-5">詳細については管理者へお問い合わせください。</p>
          </div>
        ) : null}

        <form action={signInWithGoogle} className="mt-6">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white hover:bg-moss/90"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Googleでログイン
          </button>
        </form>
        <div className="my-4 flex items-center gap-3 text-xs text-slate-500" aria-hidden>
          <span className="h-px flex-1 bg-slate-200" />
          または
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <Link
          href="/demo"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-moss bg-white px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white"
        >
          <Eye className="h-4 w-4" aria-hidden />
          サンプルを見てみる
        </Link>
        <p className="mt-3 text-center text-xs leading-5 text-slate-500">
          デモでは架空のサンプルデータを閲覧できます。登録・編集・削除はできません。
        </p>
      </section>
    </div>
  );
}
