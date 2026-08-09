import Link from "next/link";
import { MessageCircleQuestion, ShieldCheck, Users } from "lucide-react";

import { AdminHouseholdList } from "@/components/admin-household-list";
import { AdminInvitationPagination } from "@/components/admin-invitation-pagination";
import { AdminInvitationHouseholdCombobox } from "@/components/admin-invitation-household-combobox";
import { AdminUserList } from "@/components/admin-user-list";
import { AutoSubmitFilterForm } from "@/components/auto-submit-filter-form";
import { InvitationStatusBadge } from "@/components/invitation-status-badge";
import { StatusMessage } from "@/components/status-message";
import {
  ADMIN_INVITATION_SEARCH_MAX_LENGTH,
  findMatchingAdminInvitationHouseholdIds,
  getActiveInvitationCount,
  getAdminInvitationPage,
  parseAdminInvitationQuery,
  type AdminInvitationQuery
} from "@/lib/admin-invitations";
import { getAdminHouseholdPreview } from "@/lib/admin-households";
import { getAdminContactInquiryOverview } from "@/lib/contact-inquiry-queries";
import { getAdminUserPreview } from "@/lib/admin-users";
import { getRequiredAppAdminUser } from "@/lib/auth-context";
import { formatDateTimeJst } from "@/lib/date";
import { getHouseholdInvitationStatus, getInvitationCreatorDisplayName } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function getAdminPageData(invitationQuery: AdminInvitationQuery) {
  const now = new Date();
  const [users, households, userCount, householdCount, invitationHouseholds, activeInvitationCount, invitationCount, inquiryOverview] =
    await Promise.all([
      getAdminUserPreview(),
      getAdminHouseholdPreview(),
      prisma.user.count(),
      prisma.household.count({ where: { isDemo: false } }),
      prisma.household.findMany({
        where: { isDemo: false },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true }
      }),
      getActiveInvitationCount(now),
      prisma.householdInvitation.count(),
      getAdminContactInquiryOverview()
  ]);
  const matchingHouseholdIds = findMatchingAdminInvitationHouseholdIds(
    invitationQuery.search,
    invitationHouseholds
  );
  const invitationPage = await getAdminInvitationPage(invitationQuery, now, matchingHouseholdIds);

  return {
    users,
    households,
    userCount,
    householdCount,
    invitationHouseholds,
    invitationPage,
    activeInvitationCount,
    hasAnyInvitations: invitationCount > 0,
    inquiryOverview,
    now
  };
}

export default async function AdminPage({
  searchParams
}: {
  searchParams: Promise<{
    status?: string | string[];
    errorId?: string | string[];
    inviteStatus?: string | string[];
    inviteSearch?: string | string[];
    inviteSort?: string | string[];
    invitePage?: string | string[];
  }>;
}) {
  const params = await searchParams;
  await getRequiredAppAdminUser();
  const invitationQuery = parseAdminInvitationQuery(params);
  const {
    users,
    households,
    userCount,
    householdCount,
    invitationHouseholds,
    invitationPage,
    activeInvitationCount,
    hasAnyInvitations,
    inquiryOverview,
    now
  } = await getAdminPageData(invitationQuery);
  const { invitations, pagination } = invitationPage;
  const hasOpenInquiries = inquiryOverview.openCount > 0;
  const hasOverdueOpenInquiries = inquiryOverview.overdueOpenCount > 0;
  const openInquiryCardClassName = hasOverdueOpenInquiries
    ? "rounded-md border border-red-300 bg-red-50 p-4 shadow-sm transition hover:border-red-400 hover:bg-red-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2"
    : hasOpenInquiries
      ? "rounded-md border border-amber-300 bg-amber-50/50 p-4 shadow-sm transition hover:border-amber-400 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2"
      : "rounded-md border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">管理</h2>
        <p className="mt-1 text-sm text-slate-600">ユーザー、共有、招待状況、アプリ全体権限を確認します。</p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Users</p>
          <p className="mt-2 text-2xl font-bold text-ink">{userCount}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Shares</p>
          <p className="mt-2 text-2xl font-bold text-ink">{householdCount}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Active invites</p>
          <p className="mt-2 text-2xl font-bold text-ink">{activeInvitationCount}</p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-moss" aria-hidden />
            <h3 className="text-base font-bold text-ink">問い合わせ概要</h3>
          </div>
          <Link href="/admin/inquiries" className="inline-flex min-h-10 items-center text-sm font-semibold text-moss hover:underline">
            すべての問い合わせを表示
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/admin/inquiries?status=unhandled" aria-label="未対応の問い合わせ一覧を表示" className={openInquiryCardClassName}>
            <p className="text-xs font-semibold text-slate-500">未対応</p>
            <p className="mt-2 text-2xl font-bold text-ink">{inquiryOverview.openCount}</p>
            {hasOverdueOpenInquiries ? (
              <p className="mt-1 text-xs font-medium text-red-700">
                24時間経過: {inquiryOverview.overdueOpenCount}件
              </p>
            ) : null}
          </Link>
          <Link href="/admin/inquiries?status=inProgress" aria-label="確認中の問い合わせ一覧を表示" className="rounded-md border border-sky-200 bg-white p-4 shadow-sm transition hover:border-sky-300 hover:bg-sky-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2">
            <p className="text-xs font-semibold text-slate-500">確認中</p>
            <p className="mt-2 text-2xl font-bold text-ink">{inquiryOverview.inProgressCount}</p>
          </Link>
          <Link href="/admin/inquiries?status=waiting" aria-label="回答待ちの問い合わせ一覧を表示" className="rounded-md border border-violet-200 bg-white p-4 shadow-sm transition hover:border-violet-300 hover:bg-violet-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2">
            <p className="text-xs font-semibold text-slate-500">利用者からの回答待ち</p>
            <p className="mt-2 text-2xl font-bold text-ink">{inquiryOverview.waitingCount}</p>
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-moss" aria-hidden />
            <h3 className="text-base font-bold text-ink">ユーザー一覧</h3>
          </div>
          <Link href="/admin/users" className="inline-flex min-h-10 items-center text-sm font-semibold text-moss hover:underline">
            すべてのユーザーを表示
          </Link>
        </div>
        <AdminUserList users={users} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-moss" aria-hidden />
            <h3 className="text-base font-bold text-ink">共有一覧</h3>
          </div>
          <Link href="/admin/households" className="inline-flex min-h-10 items-center text-sm font-semibold text-moss hover:underline">
            すべての共有を表示
          </Link>
        </div>
        <AdminHouseholdList households={households} />
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-bold text-ink">招待一覧</h3>
        <AutoSubmitFilterForm
          action="/admin"
          className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(130px,0.7fr)_minmax(220px,1.4fr)_minmax(220px,1fr)_auto] lg:items-end"
        >
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            状態
            <select name="inviteStatus" defaultValue={invitationQuery.status}>
              <option value="all">すべて</option>
              <option value="active">有効</option>
              <option value="accepted">使用済み</option>
              <option value="expired">期限切れ</option>
              <option value="revoked">無効化済み</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            共有名
            <AdminInvitationHouseholdCombobox
              name="inviteSearch"
              defaultValue={invitationQuery.search}
              maxLength={ADMIN_INVITATION_SEARCH_MAX_LENGTH}
              options={invitationHouseholds}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            並び順
            <select name="inviteSort" defaultValue={invitationQuery.sort}>
              <option value="created-desc">作成日時：新しい順</option>
              <option value="created-asc">作成日時：古い順</option>
              <option value="expires-asc">有効期限：近い順</option>
              <option value="expires-desc">有効期限：遠い順</option>
            </select>
          </label>
          <input type="hidden" name="invitePage" value="1" />
          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            <Link
              href="/admin"
              scroll={false}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              条件をクリア
            </Link>
          </div>
        </AutoSubmitFilterForm>

        <AdminInvitationPagination
          query={invitationQuery}
          pagination={pagination}
          visibleCount={invitations.length}
        />

        <div className="hidden overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm lg:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>共有</th>
                <th>状態</th>
                <th>作成者</th>
                <th>作成日時</th>
                <th>有効期限</th>
                <th>使用日時</th>
              </tr>
            </thead>
            <tbody>
              {invitations.length > 0 ? (
                invitations.map((invitation) => {
                  const status = getHouseholdInvitationStatus(invitation, now);
                  return (
                    <tr key={invitation.id}>
                      <td className="max-w-56 break-words font-semibold text-ink [overflow-wrap:anywhere]">
                        {invitation.household.name}
                      </td>
                      <td>
                        <InvitationStatusBadge status={status} />
                      </td>
                      <td className="max-w-48 break-words [overflow-wrap:anywhere]">
                        {getInvitationCreatorDisplayName(invitation)}
                      </td>
                      <td>{formatDateTimeJst(invitation.createdAt)}</td>
                      <td>{formatDateTimeJst(invitation.expiresAt)}</td>
                      <td>{invitation.acceptedAt ? formatDateTimeJst(invitation.acceptedAt) : "-"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6}>{hasAnyInvitations ? "条件に一致する招待はありません。" : "招待リンクはまだありません。"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 lg:hidden">
          {invitations.length > 0 ? (
            invitations.map((invitation) => {
              const status = getHouseholdInvitationStatus(invitation, now);
              return (
                <article
                  key={invitation.id}
                  className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                    <div className="min-w-0 sm:col-span-2">
                      <dt className="text-xs font-semibold text-slate-500">共有</dt>
                      <dd className="mt-1 break-words font-semibold text-ink [overflow-wrap:anywhere]">
                        {invitation.household.name}
                      </dd>
                    </div>
                    <div className="border-t border-slate-100 pt-3 sm:col-span-2">
                      <dt className="text-xs font-semibold text-slate-500">状態</dt>
                      <dd className="mt-1">
                        <InvitationStatusBadge status={status} />
                      </dd>
                    </div>
                    <div className="min-w-0 border-t border-slate-100 pt-3 sm:col-span-2">
                      <dt className="text-xs font-semibold text-slate-500">作成者</dt>
                      <dd className="mt-1 break-words text-slate-700 [overflow-wrap:anywhere]">
                        {getInvitationCreatorDisplayName(invitation)}
                      </dd>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <dt className="text-xs font-semibold text-slate-500">作成日時</dt>
                      <dd className="mt-1 text-slate-700">{formatDateTimeJst(invitation.createdAt)}</dd>
                    </div>
                    <div className="border-t border-slate-100 pt-3">
                      <dt className="text-xs font-semibold text-slate-500">有効期限</dt>
                      <dd className="mt-1 text-slate-700">{formatDateTimeJst(invitation.expiresAt)}</dd>
                    </div>
                    <div className="border-t border-slate-100 pt-3 sm:col-span-2">
                      <dt className="text-xs font-semibold text-slate-500">使用日時</dt>
                      <dd className="mt-1 text-slate-700">
                        {invitation.acceptedAt ? formatDateTimeJst(invitation.acceptedAt) : "-"}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })
          ) : (
            <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
              {hasAnyInvitations ? "条件に一致する招待はありません。" : "招待リンクはまだありません。"}
            </p>
          )}
        </div>
        <AdminInvitationPagination
          query={invitationQuery}
          pagination={pagination}
          visibleCount={invitations.length}
        />
      </section>
    </div>
  );
}
