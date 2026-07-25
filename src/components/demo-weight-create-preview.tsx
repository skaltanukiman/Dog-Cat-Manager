import { Plus } from "lucide-react";

import {
  DEMO_PREVIEW_DISABLED_TITLE,
  DemoRegistrationPreviewNotice,
  demoPreviewButtonClass,
  demoPreviewControlClass,
  demoPreviewFieldClass
} from "@/components/demo-registration-preview";

export function DemoWeightCreatePreview({
  today,
  hamsterIsActive
}: {
  today: string;
  hamsterIsActive: boolean;
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-bold text-ink">体重登録</h3>
      <div className="mt-3">
        <DemoRegistrationPreviewNotice>
          {hamsterIsActive
            ? "この登録画面は機能紹介用のプレビューです。ログイン後に利用できます。"
            : "このハムスターは管理外です。登録画面は機能紹介用のプレビューとして表示しています。"}
        </DemoRegistrationPreviewNotice>
      </div>
      <div className="mt-4 grid gap-4">
        <label className={demoPreviewFieldClass}>
          日付
          <input
            type="date"
            value={today}
            disabled
            aria-disabled="true"
            title={DEMO_PREVIEW_DISABLED_TITLE}
            className={demoPreviewControlClass}
            readOnly
          />
        </label>
        <label className={demoPreviewFieldClass}>
          体重(g)
          <input
            type="number"
            min="1"
            max="500"
            step="0.1"
            placeholder="38.5"
            disabled
            aria-disabled="true"
            title={DEMO_PREVIEW_DISABLED_TITLE}
            className={demoPreviewControlClass}
          />
        </label>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={DEMO_PREVIEW_DISABLED_TITLE}
          className={demoPreviewButtonClass}
        >
          <Plus className="h-4 w-4" aria-hidden />
          登録
        </button>
      </div>
    </section>
  );
}
