import { UserRound } from "lucide-react";

import { SETTINGS_CARD_SCROLL_BUTTON_SAFE_PADDING } from "@/components/settings-layout";

type ProfileSettingsFieldsProps = {
  name?: string | null;
  email?: string | null;
};

export function ProfileSettingsFields({ name, email }: ProfileSettingsFieldsProps) {
  return (
    <section
      className={`space-y-4 rounded-md border border-slate-200 bg-white shadow-sm ${SETTINGS_CARD_SCROLL_BUTTON_SAFE_PADDING}`}
    >
      <div className="flex items-center gap-2">
        <UserRound className="h-5 w-5 text-brand" aria-hidden />
        <h3 className="text-base font-bold text-ink">プロフィール</h3>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          表示名
          <input name="name" required maxLength={50} defaultValue={name ?? ""} placeholder="例: 山田 太郎" />
          <span className="text-xs font-normal text-slate-500">ヘッダーや共有メンバー一覧に表示されます。</span>
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          メールアドレス
          <input value={email ?? "未設定"} readOnly disabled className="bg-slate-50 text-slate-500" />
          <span className="text-xs font-normal text-slate-500">Googleアカウントのメールアドレスです。</span>
        </label>
      </div>
    </section>
  );
}
