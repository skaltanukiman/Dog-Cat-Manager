import { ImagePlus, LockKeyhole } from "lucide-react";

export const DEMO_PREVIEW_DISABLED_TITLE = "サンプル閲覧モードでは利用できません";

export const demoPreviewFieldClass =
  "grid gap-1 text-sm font-medium text-slate-700";

export const demoPreviewControlClass =
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600 disabled:opacity-100";

export const demoPreviewButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-100";

export function DemoRegistrationPreviewNotice({
  children = "この登録画面は機能紹介用のプレビューです。サンプル閲覧モードのため操作できません。ログイン後に利用できます。"
}: {
  children?: React.ReactNode;
}) {
  return (
    <p className="flex gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm leading-5 text-sky-800">
      <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function DemoImageInputPreview({
  kind
}: {
  kind: "profile" | "memory";
}) {
  const profile = kind === "profile";

  return (
    <fieldset
      aria-disabled="true"
      className="min-w-0 rounded-md border border-slate-200 bg-slate-50 p-3"
    >
      <legend className="px-1 text-sm font-semibold text-slate-700">
        {profile
          ? "プロフィール画像（任意）"
          : "画像（JPEG / PNG / WebP、元画像10MBまで）"}
      </legend>
      <div
        className={
          profile
            ? "flex min-w-0 flex-col gap-3 md:flex-row md:items-center"
            : "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center"
        }
      >
        <div
          className={
            profile
              ? "flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-slate-400"
              : "grid h-36 w-full shrink-0 place-items-center rounded-md border border-dashed border-slate-300 bg-white text-slate-400 sm:w-48"
          }
        >
          <ImagePlus className="h-7 w-7" aria-hidden />
          {profile ? null : (
            <span className="px-3 text-center text-xs text-slate-500">
              画像プレビュー
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled
            aria-disabled="true"
            title={DEMO_PREVIEW_DISABLED_TITLE}
            className={`block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-300 file:px-3 file:py-2 file:font-semibold file:text-slate-700 ${demoPreviewControlClass}`}
          />
          <p className="text-xs leading-5 text-slate-500">
            {profile
              ? "通常利用時はJPEG、PNG、WebP形式のプロフィール画像を選択できます。"
              : "通常利用時は思い出に画像を1枚添付できます。"}
          </p>
        </div>
      </div>
    </fieldset>
  );
}
