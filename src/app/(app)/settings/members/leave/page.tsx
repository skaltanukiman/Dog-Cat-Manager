import { AlertTriangle, ChevronLeft, Database, Home, Shield, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HouseholdLeaveForm } from "@/components/household-leave-form";
import { StatusMessage } from "@/components/status-message";
import { getHouseholdLeaveRequirement, HOUSEHOLD_ROLE_LABELS } from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { warnHouseholdDeleteRoleStateInvalid } from "@/lib/household-delete";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HouseholdLeavePage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  const context = await getRequiredHouseholdContext();
  const household = await prisma.household.findUnique({
    where: { id: context.household.id },
    select: {
      id: true,
      name: true,
      _count: { select: { hamsters: true, members: true } },
      members: {
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          role: true,
          user: { select: { name: true, email: true } }
        }
      }
    }
  });
  if (!household) redirect("/settings/members?status=householdLeaveStateChanged");

  const currentMembership = household.members.find((member) => member.userId === context.user.id);
  if (!currentMembership) redirect("/settings/members?status=householdAlreadyLeft");
  const ownerCount = household.members.filter((member) => member.role === "OWNER").length;
  const requirement = getHouseholdLeaveRequirement({
    role: currentMembership.role,
    ownerCount,
    memberCount: household._count.members
  });
  const soleMemberRoleStateInvalid =
    requirement === "soleMember" && (currentMembership.role !== "OWNER" || ownerCount !== 1);
  if (soleMemberRoleStateInvalid) {
    warnHouseholdDeleteRoleStateInvalid({
      householdId: household.id,
      actorUserId: context.user.id,
      currentRole: currentMembership.role,
      memberCount: household._count.members,
      ownerCount
    });
  }
  const candidates = household.members
    .filter((member) => member.userId !== context.user.id)
    .map((member) => ({
      userId: member.userId,
      name: member.user.name || member.user.email || "名前未設定",
      email: member.user.email || "メールアドレス未設定",
      role: member.role
    }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/settings/members"
          className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-moss"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          共有画面へ戻る
        </Link>
        <h2 className="mt-3 text-xl font-bold text-ink">共有グループからの退出</h2>
        <p className="mt-1 text-sm text-slate-600">現在の状態を確認してから、退出手続きを行います。</p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-start gap-3">
            <Home className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-slate-500">現在の共有グループ</p>
              <p className="mt-1 break-words font-bold text-ink">{household.name}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-slate-500">あなたの権限</p>
              <p className="mt-1 font-bold text-ink">{HOUSEHOLD_ROLE_LABELS[currentMembership.role]}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-slate-500">メンバー数</p>
              <p className="mt-1 font-bold text-ink">{household._count.members}人</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-slate-500">登録ハムスター数</p>
              <p className="mt-1 font-bold text-ink">{household._count.hamsters}匹</p>
            </div>
          </div>
        </div>
      </section>

      {requirement === "soleMember" ? (
        soleMemberRoleStateInvalid ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 shrink-0" aria-hidden />
              <div>
                <h3 className="text-base font-bold">共有グループの権限状態に問題があります</h3>
                <p className="mt-3">
                  削除手続きを続行できません。権限は自動変更されないため、管理者へお問い合わせください。
                </p>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm leading-7 text-amber-950">
            <h3 className="text-base font-bold">このグループには、あなた以外のメンバーがいません</h3>
            <p className="mt-3">
              自分だけのグループは、退出する代わりに、共有グループとグループ内のすべてのデータを削除できます。
            </p>
            <p className="mt-3">この操作を行っても、ユーザーアカウントは削除されません。</p>
            <div className="mt-5 flex justify-end">
              <Link
                href="/settings/members/delete"
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 sm:w-auto"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                共有グループの削除手続きへ
              </Link>
            </div>
          </section>
        )
      ) : (
        <>
          {requirement === "leave" ? (
            <section className="rounded-md border border-red-200 bg-red-50 p-5 text-sm leading-7 text-red-950">
              <h3 className="text-base font-bold">「{household.name}」から退出しますか？</h3>
              <p className="mt-3">
                退出後、このグループのハムスターや記録を閲覧・編集できなくなります。
              </p>
              <p>グループ内のデータは削除されません。</p>
            </section>
          ) : null}
          <HouseholdLeaveForm
            householdId={household.id}
            householdName={household.name}
            requiresTransfer={requirement === "transferOwnership"}
            candidates={candidates}
          />
        </>
      )}
    </div>
  );
}
