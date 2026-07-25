import { AccountDeleteEntryForm } from "@/components/account-delete-entry-form";
import { ContactSupportEntry } from "@/components/contact-support-entry";
import { DashboardSettingsForm } from "@/components/dashboard-settings-form";
import { StatusMessage } from "@/components/status-message";
import { getDashboardSettingsPageData } from "@/lib/queries";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  const {
    user,
    boardCount,
    hamsterSelectorMode,
    recordTimelineDefaultScope,
    hamsters,
    selectedHamsterIds
  } = await getDashboardSettingsPageData();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">設定</h2>
        <p className="mt-1 text-sm text-slate-600">プロフィール、ダッシュボード、記録画面の表示設定を管理します。</p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      <DashboardSettingsForm
        name={user.name}
        email={user.email}
        boardCount={boardCount}
        hamsterSelectorMode={hamsterSelectorMode}
        recordTimelineDefaultScope={recordTimelineDefaultScope}
        hamsters={hamsters}
        selectedHamsterIds={selectedHamsterIds}
      />

      <ContactSupportEntry />

      <AccountDeleteEntryForm />
    </div>
  );
}
