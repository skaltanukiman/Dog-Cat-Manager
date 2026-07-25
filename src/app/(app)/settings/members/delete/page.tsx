import { AlertTriangle, ChevronLeft, Database, Home, Shield, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HouseholdDeleteForm } from "@/components/household-delete-form";
import { StatusMessage } from "@/components/status-message";
import { HOUSEHOLD_ROLE_LABELS } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { warnHouseholdDeleteRoleStateInvalid } from "@/lib/household-delete";
import { getHouseholdDeletePreview } from "@/lib/household-delete-preview";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HouseholdDeletePage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  const context = await getRequiredHouseholdContext();
  const preview = await getHouseholdDeletePreview(context.household.id, context.user.id);
  if (!preview) redirect("/settings/members?status=householdDeleteStateChanged");
  if (preview.memberCount !== 1) redirect("/settings/members/leave?status=householdDeleteStateChanged");

  const roleStateInvalid = preview.currentRole !== "OWNER" || preview.ownerCount !== 1;
  if (roleStateInvalid) {
    warnHouseholdDeleteRoleStateInvalid({
      householdId: preview.householdId,
      actorUserId: context.user.id,
      currentRole: preview.currentRole,
      memberCount: preview.memberCount,
      ownerCount: preview.ownerCount
    });
  }

  const deletionCounts = [
    ["ハムスター", `${preview.hamsterCount}匹`],
    ["体重記録", `${preview.weightRecordCount}件`],
    ["掃除記録", `${preview.cleaningRecordCount}件`],
    ["健康記録", `${preview.healthRecordCount}件`],
    ["通院記録", `${preview.medicalVisitCount}件`],
    ["思い出記録", `${preview.memoryRecordCount}件`],
    ["画像", `${preview.imageCount}枚`],
    ["保存済みタグ", `${preview.savedMemoryTagCount}件`]
  ] as const;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/settings/members/leave"
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-moss"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          退出画面へ戻る
        </Link>
        <h2 className="mt-3 text-xl font-bold text-ink">共有グループの削除</h2>
        <p className="mt-1 text-sm text-slate-600">削除対象と影響を確認してから手続きを行います。</p>
      </div>

      <StatusMessage
        status={roleStateInvalid ? "householdRoleStateInvalid" : getParam(params.status)}
        errorId={getParam(params.errorId)}
      />

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-start gap-3 sm:col-span-2">
            <Home className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500">共有グループ名</p>
              <p className="mt-1 break-words font-bold text-ink">{preview.householdName}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-slate-500">現在の権限</p>
              <p className="mt-1 font-bold text-ink">{HOUSEHOLD_ROLE_LABELS[preview.currentRole]}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-slate-500">メンバー数</p>
              <p className="mt-1 font-bold text-ink">{preview.memberCount}人</p>
            </div>
          </div>
        </div>
      </section>

      {roleStateInvalid ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <h3 className="font-bold">削除手続きを続行できません</h3>
              <p className="mt-2">
                共有グループの権限状態に問題があります。自動的な権限変更は行わないため、管理者へお問い合わせください。
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-md border border-red-200 bg-red-50 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-base font-bold text-red-950">
                  「{preview.householdName}」を完全に削除します
                </h3>
                <p className="mt-2 text-sm leading-6 text-red-900">
                  共有グループ内のデータと保存画像はすべて削除され、元に戻せません。ユーザーアカウントは削除されません。
                </p>
              </div>
            </div>
            <h4 className="mt-5 text-sm font-bold text-red-950">削除されるデータ</h4>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {deletionCounts.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 rounded-md bg-white px-3 py-2 text-sm"
                >
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="font-bold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-4 text-sm leading-7 text-slate-700 shadow-sm sm:p-5">
            {preview.joinedHouseholdCount > 1 ? (
              <>
                <p>削除後は、参加中の別の共有グループへ切り替わります。</p>
                <p className="font-semibold">新しい共有グループは作成されません。</p>
              </>
            ) : (
              <>
                <p className="font-semibold">削除後もアカウントは残ります。</p>
                <p className="mt-3">
                  現在ほかに参加している共有グループがないため、
                  <br />
                  引き続きアプリを利用できるよう、
                  <br />
                  新しい空の共有グループが自動的に作成されます。
                </p>
              </>
            )}
          </section>

          <HouseholdDeleteForm householdId={preview.householdId} householdName={preview.householdName} />
        </>
      )}
    </div>
  );
}
