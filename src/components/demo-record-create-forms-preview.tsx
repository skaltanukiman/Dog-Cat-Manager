"use client";

import { HeartPulse, ImagePlus, Stethoscope } from "lucide-react";
import { useState } from "react";

import {
  DEMO_PREVIEW_DISABLED_TITLE,
  DemoImageInputPreview,
  DemoRegistrationPreviewNotice,
  demoPreviewButtonClass,
  demoPreviewControlClass,
  demoPreviewFieldClass
} from "@/components/demo-registration-preview";
import {
  HEALTH_AMOUNT_CONDITIONS,
  HEALTH_EXCRETION_CONDITIONS,
  HEALTH_OVERALL_CONDITIONS,
  HEALTH_SYMPTOMS
} from "@/lib/record-schemas";
import {
  HEALTH_AMOUNT_LABELS,
  HEALTH_EXCRETION_LABELS,
  HEALTH_OVERALL_LABELS,
  HEALTH_SYMPTOM_LABELS
} from "@/lib/records";

export type DemoRecordPreviewKind = "health" | "medical" | "memory";

export const DEMO_RECORD_PREVIEW_TABS: ReadonlyArray<{
  value: DemoRecordPreviewKind;
  shortLabel: string;
  label: string;
}> = [
  { value: "health", shortLabel: "体調", label: "体調を記録" },
  { value: "medical", shortLabel: "通院", label: "通院を記録" },
  { value: "memory", shortLabel: "思い出", label: "思い出を追加" }
];

const tabIcons = {
  health: HeartPulse,
  medical: Stethoscope,
  memory: ImagePlus
} satisfies Record<DemoRecordPreviewKind, typeof HeartPulse>;

function DisabledInput({
  type = "text",
  placeholder,
  value,
  className = ""
}: {
  type?: "text" | "date" | "time" | "number";
  placeholder?: string;
  value?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      disabled
      aria-disabled="true"
      title={DEMO_PREVIEW_DISABLED_TITLE}
      className={`${demoPreviewControlClass} ${className}`}
      readOnly
    />
  );
}

function DisabledTextarea({ placeholder }: { placeholder?: string }) {
  return (
    <textarea
      placeholder={placeholder}
      disabled
      aria-disabled="true"
      title={DEMO_PREVIEW_DISABLED_TITLE}
      className={demoPreviewControlClass}
    />
  );
}

function DisabledSelect({
  children,
  value
}: {
  children: React.ReactNode;
  value: string;
}) {
  return (
    <select
      value={value}
      disabled
      aria-disabled="true"
      title={DEMO_PREVIEW_DISABLED_TITLE}
      className={demoPreviewControlClass}
    >
      {children}
    </select>
  );
}

function PreviewSaveButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={DEMO_PREVIEW_DISABLED_TITLE}
      className={`${demoPreviewButtonClass} h-11 px-5 sm:w-fit`}
    >
      {children}
    </button>
  );
}

function HealthPreview({ today }: { today: string }) {
  return (
    <div
      id="demo-record-preview-health"
      role="tabpanel"
      aria-labelledby="demo-record-preview-tab-health"
      className="mt-5 grid gap-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className={`${demoPreviewFieldClass} sm:w-56`}>
          記録日
          <DisabledInput type="date" value={today} />
        </label>
        <label className={`${demoPreviewFieldClass} sm:w-40`}>
          記録時刻
          <DisabledInput type="time" value="09:00" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className={demoPreviewFieldClass}>
          総合状態
          <DisabledSelect value="GOOD">
            {HEALTH_OVERALL_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {HEALTH_OVERALL_LABELS[value]}
              </option>
            ))}
          </DisabledSelect>
        </label>
        <label className={demoPreviewFieldClass}>
          食欲
          <DisabledSelect value="NORMAL">
            {HEALTH_AMOUNT_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {HEALTH_AMOUNT_LABELS[value]}
              </option>
            ))}
          </DisabledSelect>
        </label>
        <label className={demoPreviewFieldClass}>
          活動量
          <DisabledSelect value="NORMAL">
            {HEALTH_AMOUNT_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {HEALTH_AMOUNT_LABELS[value]}
              </option>
            ))}
          </DisabledSelect>
        </label>
        <label className={demoPreviewFieldClass}>
          便
          <DisabledSelect value="NORMAL">
            {HEALTH_EXCRETION_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {HEALTH_EXCRETION_LABELS[value]}
              </option>
            ))}
          </DisabledSelect>
        </label>
        <label className={demoPreviewFieldClass}>
          尿
          <DisabledSelect value="NORMAL">
            {HEALTH_EXCRETION_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {HEALTH_EXCRETION_LABELS[value]}
              </option>
            ))}
          </DisabledSelect>
        </label>
      </div>
      <fieldset className="grid gap-2" aria-disabled="true">
        <legend className="text-sm font-semibold text-slate-700">
          気になる症状（複数選択可）
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {HEALTH_SYMPTOMS.map((symptom) => (
            <label
              key={symptom}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
            >
              <input
                type="checkbox"
                disabled
                aria-disabled="true"
                title={DEMO_PREVIEW_DISABLED_TITLE}
              />
              {HEALTH_SYMPTOM_LABELS[symptom]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={demoPreviewFieldClass}>
        メモ
        <DisabledTextarea placeholder="その他の症状や気になったことを入力" />
      </label>
      <PreviewSaveButton>体調記録を保存</PreviewSaveButton>
    </div>
  );
}

function MedicalPreview({ today }: { today: string }) {
  return (
    <div
      id="demo-record-preview-medical"
      role="tabpanel"
      aria-labelledby="demo-record-preview-tab-medical"
      className="mt-5 grid gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={demoPreviewFieldClass}>
          通院日
          <DisabledInput type="date" value={today} />
        </label>
        <label className={demoPreviewFieldClass}>
          動物病院名（任意）
          <DisabledInput placeholder="例: ひだまり動物病院" />
        </label>
      </div>
      <label className={demoPreviewFieldClass}>
        通院理由・症状
        <DisabledTextarea />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={demoPreviewFieldClass}>
          診断内容
          <DisabledTextarea />
        </label>
        <label className={demoPreviewFieldClass}>
          検査内容
          <DisabledTextarea />
        </label>
        <label className={demoPreviewFieldClass}>
          処置・治療内容
          <DisabledTextarea />
        </label>
        <label className={demoPreviewFieldClass}>
          処方薬
          <DisabledTextarea />
        </label>
        <label className={demoPreviewFieldClass}>
          投薬方法
          <DisabledTextarea />
        </label>
        <label className={demoPreviewFieldClass}>
          メモ
          <DisabledTextarea />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={demoPreviewFieldClass}>
          次回通院予定日（任意）
          <DisabledInput type="date" />
        </label>
        <label className={demoPreviewFieldClass}>
          診察費（円・整数）
          <DisabledInput type="number" placeholder="3500" />
        </label>
      </div>
      <PreviewSaveButton>通院記録を保存</PreviewSaveButton>
    </div>
  );
}

function MemoryPreview({ today }: { today: string }) {
  return (
    <div
      id="demo-record-preview-memory"
      role="tabpanel"
      aria-labelledby="demo-record-preview-tab-memory"
      className="mt-5 grid gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className={demoPreviewFieldClass}>
          記録日
          <DisabledInput type="date" value={today} />
        </label>
        <label className={demoPreviewFieldClass}>
          タイトル
          <DisabledInput placeholder="初めて手の上で寝てくれた" />
        </label>
      </div>
      <label className={demoPreviewFieldClass}>
        内容
        <DisabledTextarea placeholder="その日の出来事や表情を記録できます" />
      </label>
      <label className={demoPreviewFieldClass}>
        タグ
        <DisabledInput placeholder="例: おやつ、部屋んぽ" />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          disabled
          aria-disabled="true"
          title={DEMO_PREVIEW_DISABLED_TITLE}
        />
        お気に入り
      </label>
      <DemoImageInputPreview kind="memory" />
      <PreviewSaveButton>思い出を保存</PreviewSaveButton>
    </div>
  );
}

export function DemoRecordCreateFormsPreview({ today }: { today: string }) {
  const [kind, setKind] = useState<DemoRecordPreviewKind>("health");

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <DemoRegistrationPreviewNotice />

      <div
        className="mt-4 sm:hidden"
        role="tablist"
        aria-label="プレビューする記録種類"
      >
        <p className="mb-2 text-xs font-semibold text-slate-600">記録の種類</p>
        <div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">
          {DEMO_RECORD_PREVIEW_TABS.map((tab) => (
            <button
              key={tab.value}
              id={`demo-record-preview-mobile-tab-${tab.value}`}
              type="button"
              role="tab"
              aria-selected={kind === tab.value}
              onClick={() => setKind(tab.value)}
              className={`flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-1 ${
                kind === tab.value
                  ? "bg-moss/10 font-semibold text-moss ring-1 ring-inset ring-moss/20"
                  : "text-slate-600 hover:bg-white/70 hover:text-ink"
              }`}
            >
              {tab.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <div
        className="mt-4 hidden flex-wrap gap-2 sm:flex"
        role="tablist"
        aria-label="プレビューする記録種類"
      >
        {DEMO_RECORD_PREVIEW_TABS.map((tab) => {
          const Icon = tabIcons[tab.value];
          return (
            <button
              key={tab.value}
              id={`demo-record-preview-tab-${tab.value}`}
              type="button"
              role="tab"
              aria-selected={kind === tab.value}
              aria-controls={`demo-record-preview-${tab.value}`}
              onClick={() => setKind(tab.value)}
              className={`inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-semibold ${
                kind === tab.value
                  ? "border-moss bg-moss text-white"
                  : "border-slate-200 text-slate-700 hover:border-moss hover:text-moss"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div hidden={kind !== "health"}>
        <HealthPreview today={today} />
      </div>
      <div hidden={kind !== "medical"}>
        <MedicalPreview today={today} />
      </div>
      <div hidden={kind !== "memory"}>
        <MemoryPreview today={today} />
      </div>
    </section>
  );
}
