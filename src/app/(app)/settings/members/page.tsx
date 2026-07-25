import { headers } from "next/headers";
import { History, LogOut, Save, Settings2, UserPlus, Users } from "lucide-react";
import Link from "next/link";

import { updateCurrentHouseholdName } from "@/app/actions/members";
import { DirtySubmitButton } from "@/components/dirty-submit-button";
import { HouseholdInvitationForm } from "@/components/household-invitation-form";
import { HouseholdInvitationList } from "@/components/household-invitation-list";
import { HouseholdActivityList } from "@/components/household-activity-list";
import {
  canManageHouseholdInvitations,
  canManageHouseholdMemberRoles,
  canRemoveHouseholdMembers,
  canUpdateHouseholdName,
  HOUSEHOLD_ROLE_LABELS
} from "@/lib/authorization";
import { getRequiredHouseholdContext } from "@/lib/auth-context";
import { formatDateJst } from "@/lib/date";
import { INVITATION_TTL_DAYS, MAX_ACTIVE_HOUSEHOLD_INVITATIONS } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { getCurrentHouseholdActivityPreview } from "@/lib/household-activity-queries";
import { MemberRemoveForm } from "@/components/member-remove-form";
import { MemberRoleForm } from "@/components/member-role-form";
import { StatusMessage } from "@/components/status-message";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function getInvitationOrigin() {
  const configuredOrigin = process.env.AUTH_URL;
  if (configuredOrigin) {
    try {
      const url = new URL(configuredOrigin);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // 不正なAUTH_URLはリクエストヘッダーから組み立てるフォールバックへ回す。
    }
  }

  const headerList = await headers();
  const host = headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") === "https" ? "https" : "http";
  return host ? `${protocol}://${host}` : "http://localhost:3001";
}

async function getMembersPageData() {
  const context = await getRequiredHouseholdContext();
  const now = new Date();
  const [members, invitations, hamsterCount, activityPreview] = await Promise.all([
    prisma.householdMember.findMany({
      where: { householdId: context.household.id },
      include: { user: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.householdInvitation.findMany({
      where: {
        householdId: context.household.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now }
      },
      include: {
        createdBy: {
          select: { name: true, email: true }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.hamster.count({ where: { householdId: context.household.id } }),
    getCurrentHouseholdActivityPreview()
  ]);

  return { context, members, invitations, hamsterCount, activities: activityPreview.activities, now };
}

export default async function MembersPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  const invitationOrigin = await getInvitationOrigin();
  const { context, members, invitations, hamsterCount, activities, now } = await getMembersPageData();
  const canManageInvitations = canManageHouseholdInvitations(context.membership.role);
  const canManageMemberRoles = canManageHouseholdMemberRoles(context.membership.role);
  const canRemoveMembers = canRemoveHouseholdMembers(context.membership.role);
  const hasMemberActions = canManageMemberRoles || canRemoveMembers;
  const canUpdateName = canUpdateHouseholdName(context.membership.role);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">共有</h2>
        <p className="mt-1 text-sm text-slate-600">{context.household.name} のメンバーを管理します。</p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Settings2 className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
          <div>
            <h3 className="text-base font-bold text-ink">共有グループ設定</h3>
            <p className="mt-1 text-sm text-slate-600">
              この名前は、操作対象の切り替えや共有グループの各画面に表示されます。
            </p>
          </div>
        </div>

        {canUpdateName ? (
          <form action={updateCurrentHouseholdName} data-dirty-watch className="mt-4 space-y-4">
            <input type="hidden" name="currentName" value={context.household.name} />
            <label className="grid gap-1 text-sm font-medium text-slate-700" htmlFor="household-name">
              共有グループ名
              <input
                id="household-name"
                name="name"
                required
                maxLength={50}
                defaultValue={context.household.name}
                aria-describedby="household-name-help"
              />
              <span id="household-name-help" className="text-xs font-normal text-slate-500">
                50文字以内で入力してください。
              </span>
            </label>
            <div className="flex justify-end">
              <DirtySubmitButton className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-moss/90 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto">
                <Save className="h-4 w-4" aria-hidden />
                共有グループ名を保存
              </DirtySubmitButton>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700" htmlFor="household-name-readonly">
              共有グループ名
              <input
                id="household-name-readonly"
                value={context.household.name}
                readOnly
                aria-describedby="household-name-readonly-help"
                className="bg-slate-50 text-slate-600"
              />
            </label>
            <p
              id="household-name-readonly-help"
              className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
            >
              共有グループ名を変更できるのはオーナーだけです。
            </p>
          </div>
        )}
      </section>

      {canManageInvitations ? (
        <HouseholdInvitationForm
          invitationOrigin={invitationOrigin}
          ttlDays={INVITATION_TTL_DAYS}
          activeInvitationCount={invitations.length}
          maxActiveInvitations={MAX_ACTIVE_HOUSEHOLD_INVITATIONS}
        />
      ) : (
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex min-w-0 items-start gap-3">
            <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-moss" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-base font-bold text-ink">招待リンク</h3>
              <p className="mt-1 text-sm text-slate-600">リンクは作成から {INVITATION_TTL_DAYS} 日間だけ有効です。</p>
            </div>
          </div>
          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            招待リンクを作成できるのはオーナーまたは管理者です。
          </p>
        </section>
      )}

      <HouseholdInvitationList invitations={invitations} canManage={canManageInvitations} now={now} />

      <section className="space-y-3 border-t border-slate-300 pt-6 sm:space-y-4 sm:pt-8">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-5 w-5 shrink-0 text-moss" aria-hidden />
          <h3 className="text-base font-bold text-ink">メンバー一覧</h3>
        </div>

        <div className="hidden overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm lg:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>名前</th>
                <th>メールアドレス</th>
                <th>権限</th>
                <th>参加日</th>
                {hasMemberActions ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const memberDisplayName = member.user.name || member.user.email || "未設定";
                const manageableMemberRole = member.role === "OWNER" ? null : member.role;
                const canUpdateThisMemberRole =
                  canManageMemberRoles && member.userId !== context.user.id && manageableMemberRole !== null;
                const canRemoveThisMember =
                  canRemoveMembers &&
                  member.userId !== context.user.id &&
                  (context.membership.role === "OWNER" || member.role === "MEMBER" || member.role === "VIEWER");

                return (
                  <tr key={member.id}>
                    <td className="font-semibold text-ink">{member.user.name || "未設定"}</td>
                    <td>{member.user.email || "未設定"}</td>
                    <td>{HOUSEHOLD_ROLE_LABELS[member.role]}</td>
                    <td>{formatDateJst(member.createdAt)}</td>
                    {hasMemberActions ? (
                      <td>
                        {canUpdateThisMemberRole || canRemoveThisMember ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {canUpdateThisMemberRole ? (
                              manageableMemberRole ? (
                                <MemberRoleForm
                                  memberId={member.id}
                                  memberName={memberDisplayName}
                                  currentRole={manageableMemberRole}
                                />
                              ) : null
                            ) : null}
                            {canRemoveThisMember ? (
                              <MemberRemoveForm memberId={member.id} memberName={memberDisplayName} />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">解除不可</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 lg:hidden">
          {members.map((member) => {
            const memberDisplayName = member.user.name || member.user.email || "未設定";
            const manageableMemberRole = member.role === "OWNER" ? null : member.role;
            const canUpdateThisMemberRole =
              canManageMemberRoles && member.userId !== context.user.id && manageableMemberRole !== null;
            const canRemoveThisMember =
              canRemoveMembers &&
              member.userId !== context.user.id &&
              (context.membership.role === "OWNER" || member.role === "MEMBER" || member.role === "VIEWER");

            return (
              <article key={member.id} className="rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="break-words font-bold text-ink">{member.user.name || "未設定"}</h4>
                    <p className="mt-1 break-words text-slate-600">{member.user.email || "未設定"}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-straw/40 px-2 py-1 text-xs font-semibold text-slate-700">
                    {HOUSEHOLD_ROLE_LABELS[member.role]}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">参加日: {formatDateJst(member.createdAt)}</p>
                  {canUpdateThisMemberRole || canRemoveThisMember ? (
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      {canUpdateThisMemberRole ? (
                        manageableMemberRole ? (
                          <MemberRoleForm memberId={member.id} memberName={memberDisplayName} currentRole={manageableMemberRole} />
                        ) : null
                      ) : null}
                      {canRemoveThisMember ? <MemberRemoveForm memberId={member.id} memberName={memberDisplayName} /> : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="space-y-3 border-t border-slate-300 pt-6 sm:space-y-4 sm:pt-8"
        aria-labelledby="household-activity-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <History className="h-5 w-5 shrink-0 text-moss" aria-hidden />
            <h3 id="household-activity-heading" className="text-base font-bold text-ink">共有グループの操作履歴</h3>
          </div>
          <Link
            href="/settings/members/activity"
            className="ml-auto shrink-0 whitespace-nowrap text-sm font-semibold text-moss hover:underline"
          >
            すべての履歴を見る
          </Link>
        </div>
        <HouseholdActivityList activities={activities} />
      </section>

      <section className="rounded-md border border-red-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <LogOut className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-ink">共有グループからの退出</h3>
            <p className="mt-1 text-sm text-slate-600">現在参加している共有グループから退出する手続きです。</p>
          </div>
        </div>

        <dl className="mt-4 grid gap-3 rounded-md bg-slate-50 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-slate-500">現在の共有グループ</dt>
            <dd className="mt-1 break-words font-bold text-ink">{context.household.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">現在の権限</dt>
            <dd className="mt-1 font-bold text-ink">{HOUSEHOLD_ROLE_LABELS[context.membership.role]}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">メンバー数</dt>
            <dd className="mt-1 font-bold text-ink">{members.length}人</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">登録ハムスター数</dt>
            <dd className="mt-1 font-bold text-ink">{hamsterCount}匹</dd>
          </div>
        </dl>

        <div className="mt-4 space-y-1 text-sm leading-6 text-slate-600">
          <p>退出後は、このグループのハムスターや記録を閲覧・編集できなくなります。</p>
          <p>退出しても、グループ内のハムスターや共有記録は削除されません。</p>
        </div>

        <div className="mt-5 flex justify-end">
          <Link
            href="/settings/members/leave"
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 sm:w-auto"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            退出手続きへ
          </Link>
        </div>
      </section>
    </div>
  );
}
