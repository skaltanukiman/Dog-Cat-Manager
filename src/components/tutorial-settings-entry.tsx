"use client";

import { CircleHelp } from "lucide-react";

import { SETTINGS_CARD_STANDARD_PADDING } from "@/components/settings-layout";
import { useTutorial } from "@/components/tutorial-provider";

export function TutorialSettingsEntry() {
  const { startReplay } = useTutorial();

  return (
    <section
      data-tutorial="settings-tutorial"
      className={`rounded-md border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_STANDARD_PADDING}`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CircleHelp className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <h3 className="text-base font-bold text-ink">使い方</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Dog & Cat Managerの基本的な使い方をもう一度確認できます。
          </p>
        </div>
        <button
          type="button"
          onClick={startReplay}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-md border border-brand bg-white px-4 py-2.5 text-sm font-bold text-brand hover:bg-brand-dark hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 md:w-28"
        >
          使い方を見る
        </button>
      </div>
    </section>
  );
}
