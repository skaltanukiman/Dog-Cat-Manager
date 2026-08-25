import { AccountDeleteEntryForm } from "@/components/account-delete-entry-form";
import { ContactSupportEntry } from "@/components/contact-support-entry";
import { CareDaySettingsForm } from "@/components/care-day-settings-form";
import { DashboardSettingsForm } from "@/components/dashboard-settings-form";
import { NotificationSettingsForm } from "@/components/notification-settings-form";
import { PwaInstallGuideEntry } from "@/components/pwa-install-guide-entry";
import { StatusMessage } from "@/components/status-message";
import { TutorialSettingsEntry } from "@/components/tutorial-settings-entry";
import { getDashboardSettingsPageData } from "@/lib/queries";
import { getPublicVapidConfiguration } from "@/lib/web-push";

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
    recordTimelineDefaultScope,
    careNotificationCompactBody,
    careDayStartMinutes,
    canManageCareDaySettings,
    pets,
    selectedPetIds
  } = await getDashboardSettingsPageData();
  const vapid = getPublicVapidConfiguration();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">設定</h2>
        <p className="mt-1 text-sm text-slate-600">
          プロフィール、各画面の表示方法、ダッシュボードを管理します。
        </p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      <TutorialSettingsEntry />

      <PwaInstallGuideEntry />

      <DashboardSettingsForm
        name={user.name}
        email={user.email}
        boardCount={boardCount}
        recordTimelineDefaultScope={recordTimelineDefaultScope}
        pets={pets}
        selectedPetIds={selectedPetIds}
      />

      <CareDaySettingsForm
        key={`care-day-${careDayStartMinutes}-${canManageCareDaySettings}`}
        careDayStartMinutes={careDayStartMinutes}
        canManage={canManageCareDaySettings}
      />

      <NotificationSettingsForm
        compactBody={careNotificationCompactBody}
        vapidConfigured={vapid.configured}
        vapidPublicKey={vapid.publicKey}
      />

      <ContactSupportEntry />

      <AccountDeleteEntryForm />
    </div>
  );
}
