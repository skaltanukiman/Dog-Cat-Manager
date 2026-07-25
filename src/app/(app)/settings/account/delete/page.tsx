import { AlertTriangle, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountDeleteForm } from "@/components/account-delete-form";
import { StatusMessage } from "@/components/status-message";
import { getAccountDeletePreview } from "@/lib/account-delete";
import { getRequiredSessionUser } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccountDeletePage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  // getRequiredHouseholdContext()を使わず、所属0件でも初期Householdを作成しない。
  const user = await getRequiredSessionUser();
  const preview = await getAccountDeletePreview(user.id);
  if (!preview) redirect("/login?status=accountAlreadyDeleted");

  const hasBlockedHousehold = preview.households.some(
    (household) => household.disposition === "blocked"
  );
  const blockingStatus = preview.isLastSuperAdmin
    ? undefined
    : hasBlockedHousehold
      ? "accountDeleteStateChanged"
      : getParam(params.status);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-slate-600 hover:text-moss focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          設定へ戻る
        </Link>
        <h2 className="mt-3 text-xl font-bold text-ink">アカウントを削除</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          削除前に、所属グループごとの扱いと削除されるデータを確認してください。
        </p>
      </div>

      <StatusMessage status={blockingStatus} errorId={getParam(params.errorId)} />

      {preview.isLastSuperAdmin ? (
        <section
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-950"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <h3 className="font-bold">このアカウントは現在削除できません</h3>
              <p className="mt-2">
                このアカウントは最後のスーパー管理者です。別のユーザーをスーパー管理者に変更してから、もう一度お試しください。
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <AccountDeleteForm
        expectedStateToken={preview.stateToken}
        households={preview.households}
        deletionBlocked={preview.isLastSuperAdmin || hasBlockedHousehold}
      />
    </div>
  );
}
