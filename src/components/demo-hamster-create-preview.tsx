import { Plus } from "lucide-react";

import {
  DEMO_PREVIEW_DISABLED_TITLE,
  DemoImageInputPreview,
  DemoRegistrationPreviewNotice,
  demoPreviewButtonClass,
  demoPreviewControlClass,
  demoPreviewFieldClass
} from "@/components/demo-registration-preview";

export function DemoHamsterCreatePreview({ today }: { today: string }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-bold text-ink">新規登録</h3>
      <div className="mt-3">
        <DemoRegistrationPreviewNotice />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(150px,200px)_160px_160px_1fr_auto]">
        <label className={demoPreviewFieldClass}>
          名前
          <input
            placeholder="例: もなか"
            maxLength={15}
            readOnly
            aria-readonly="true"
            title={DEMO_PREVIEW_DISABLED_TITLE}
            className={demoPreviewControlClass}
          />
        </label>
        <label className={demoPreviewFieldClass}>
          誕生日
          <input
            type="date"
            max={today}
            disabled
            aria-disabled="true"
            title={DEMO_PREVIEW_DISABLED_TITLE}
            className={demoPreviewControlClass}
          />
        </label>
        <label className={demoPreviewFieldClass}>
          お迎え日
          <input
            type="date"
            max={today}
            disabled
            aria-disabled="true"
            title={DEMO_PREVIEW_DISABLED_TITLE}
            className={demoPreviewControlClass}
          />
        </label>
        <label className={demoPreviewFieldClass}>
          メモ
          <input
            placeholder="性格、注意点など"
            maxLength={2000}
            readOnly
            aria-readonly="true"
            title={DEMO_PREVIEW_DISABLED_TITLE}
            className={demoPreviewControlClass}
          />
        </label>
        <div className="min-w-0 lg:col-span-5 lg:row-start-2">
          <DemoImageInputPreview kind="profile" />
        </div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={DEMO_PREVIEW_DISABLED_TITLE}
          className={`${demoPreviewButtonClass} h-10 w-full self-end lg:col-start-5 lg:row-start-1 lg:w-auto`}
        >
          <Plus className="h-4 w-4" aria-hidden />
          登録
        </button>
      </div>
    </section>
  );
}
