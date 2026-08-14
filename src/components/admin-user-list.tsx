import { updateUserAppRole } from "@/app/actions/admin";
import { AdminUserAccessControls } from "@/components/admin-user-access-controls";
import {
  APP_ROLE_LABELS,
  type AdminRoleReturnPath,
  type AdminUserListItem
} from "@/lib/admin-users";
import { formatDateJst, formatDateTimeJst } from "@/lib/date";

function UserAccessStatusBadge({
  status,
  compact = false
}: {
  status: AdminUserListItem["accessStatus"];
  compact?: boolean;
}) {
  return status === "SUSPENDED" ? (
    <span className="inline-flex whitespace-nowrap rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
      利用停止中
    </span>
  ) : compact ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-emerald-700">
      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
      利用中
    </span>
  ) : (
    <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
      利用中
    </span>
  );
}

function SuspensionDetails({ user }: { user: AdminUserListItem }) {
  if (user.accessStatus !== "SUSPENDED") return <span className="text-slate-500">-</span>;

  return (
    <div className="max-w-72 space-y-1 text-sm">
      <p>{formatDateTimeJst(user.suspendedAt)}</p>
      <p className="break-words text-slate-600 [overflow-wrap:anywhere]">理由: {user.suspensionReason || "未記録"}</p>
      <p className="break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
        実行者: {user.suspendedBy?.name || "削除済み・未設定"}
      </p>
    </div>
  );
}

function AppRoleField({
  userId,
  currentRole,
  canEdit,
  returnPath,
  compact = false
}: {
  userId: string;
  currentRole: AdminUserListItem["appRole"];
  canEdit: boolean;
  returnPath: AdminRoleReturnPath;
  compact?: boolean;
}) {
  if (!canEdit) {
    return <span>{APP_ROLE_LABELS[currentRole]}</span>;
  }

  return (
    <form
      action={updateUserAppRole}
      className={
        compact
          ? "inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
          : "grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      }
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="returnTo" value={returnPath} />
      <select
        name="appRole"
        defaultValue={currentRole}
        aria-label="アプリ全体権限"
        className={compact ? "h-8 w-36 min-w-0 py-1 text-sm" : "h-9 min-w-0 py-1.5 text-sm"}
      >
        {Object.entries(APP_ROLE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className={`inline-flex shrink-0 items-center justify-center rounded-md border border-brand text-sm font-semibold text-brand hover:bg-brand-dark hover:text-white ${
          compact ? "h-8 px-2.5" : "h-9 w-full px-3 sm:w-auto"
        }`}
      >
        変更
      </button>
    </form>
  );
}

export function AdminUserList({
  users,
  canEditAppRoles = false,
  canManageUserAccess = false,
  currentUserId,
  returnPath = "/admin/users"
}: {
  users: AdminUserListItem[];
  canEditAppRoles?: boolean;
  canManageUserAccess?: boolean;
  currentUserId?: string;
  returnPath?: AdminRoleReturnPath;
}) {
  if (users.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
        ユーザーはまだいません。
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm lg:block">
        <table className="data-table min-w-[64rem] table-fixed">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[25%]" />
            <col className="w-[18%]" />
            <col className="w-[13%]" />
            <col className="w-[12%]" />
            {canManageUserAccess ? <col className="w-[8%]" /> : null}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="whitespace-nowrap">ユーザー</th>
              <th scope="col" className="whitespace-nowrap">アプリ権限</th>
              <th scope="col" className="whitespace-nowrap">利用状態</th>
              <th scope="col" className="whitespace-nowrap">利用状況</th>
              <th scope="col" className="whitespace-nowrap">登録日</th>
              {canManageUserAccess ? <th scope="col" className="whitespace-nowrap text-center">操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.accessStatus === "SUSPENDED" ? "bg-red-50/40" : undefined}>
                <td
                  className={`min-w-0 border-l-2 ${
                    user.accessStatus === "SUSPENDED" ? "border-l-red-300" : "border-l-transparent"
                  }`}
                >
                  <p className="break-words font-semibold text-ink [overflow-wrap:anywhere]">
                    {user.name || "未設定"}
                  </p>
                  <p className="mt-0.5 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                    {user.email || "未設定"}
                  </p>
                </td>
                <td>
                  <AppRoleField
                    userId={user.id}
                    currentRole={user.appRole}
                    canEdit={canEditAppRoles && user.id !== currentUserId}
                    returnPath={returnPath}
                    compact
                  />
                </td>
                <td>
                  <UserAccessStatusBadge status={user.accessStatus} compact />
                  {user.accessStatus === "SUSPENDED" ? (
                    <p className="mt-1.5 whitespace-nowrap text-xs text-slate-500">
                      {formatDateTimeJst(user.suspendedAt)}
                    </p>
                  ) : null}
                </td>
                <td>
                  <div className="space-y-1 text-sm text-slate-700">
                    <p className="whitespace-nowrap">共有 {user._count.memberships}</p>
                    <p className="whitespace-nowrap">セッション {user._count.sessions}</p>
                  </div>
                </td>
                <td className="whitespace-nowrap">{formatDateJst(user.createdAt)}</td>
                {canManageUserAccess ? (
                  <td className="text-center">
                    {user.id === currentUserId ? (
                      <span className="whitespace-nowrap text-xs text-slate-500">対象外</span>
                    ) : (
                      <AdminUserAccessControls
                        user={user}
                        returnPath={returnPath}
                        presentation="menu"
                        suspensionDetails={
                          user.accessStatus === "SUSPENDED"
                            ? {
                                suspendedAt: formatDateTimeJst(user.suspendedAt),
                                reason: user.suspensionReason || "未記録",
                                actorName: user.suspendedBy?.name || "削除済み・未設定"
                              }
                            : undefined
                        }
                      />
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 lg:hidden">
        {users.map((user) => (
          <article key={user.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <dl className="grid min-w-0 gap-3 text-sm">
              <div className="min-w-0">
                <dt className="text-xs font-semibold text-slate-500">名前</dt>
                <dd className="mt-1 break-words font-semibold text-ink [overflow-wrap:anywhere]">
                  {user.name || "未設定"}
                </dd>
              </div>
              <div className="min-w-0 border-t border-slate-100 pt-3">
                <dt className="text-xs font-semibold text-slate-500">メールアドレス</dt>
                <dd className="mt-1 break-words text-slate-700 [overflow-wrap:anywhere]">
                  {user.email || "未設定"}
                </dd>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <dt className="text-xs font-semibold text-slate-500">利用状態</dt>
                <dd className="mt-2"><UserAccessStatusBadge status={user.accessStatus} /></dd>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <dt className="text-xs font-semibold text-slate-500">利用停止情報</dt>
                <dd className="mt-1 text-slate-700"><SuspensionDetails user={user} /></dd>
              </div>
              <div className="min-w-0 border-t border-slate-100 pt-3">
                <dt className="text-xs font-semibold text-slate-500">アプリ全体権限</dt>
                <dd className="mt-2 min-w-0 text-slate-700">
                  <AppRoleField
                    userId={user.id}
                    currentRole={user.appRole}
                    canEdit={canEditAppRoles && user.id !== currentUserId}
                    returnPath={returnPath}
                  />
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">所属共有数</dt>
                  <dd className="mt-1 text-slate-700">{user._count.memberships}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">セッション数</dt>
                  <dd className="mt-1 text-slate-700">{user._count.sessions}</dd>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <dt className="text-xs font-semibold text-slate-500">作成日</dt>
                <dd className="mt-1 text-slate-700">{formatDateJst(user.createdAt)}</dd>
              </div>
              {canManageUserAccess ? (
                <div className="border-t border-slate-100 pt-3">
                  <dt className="text-xs font-semibold text-slate-500">操作</dt>
                  <dd className="mt-2">
                    {user.id === currentUserId ? (
                      <span className="text-xs text-slate-500">自分自身は利用停止できません。</span>
                    ) : (
                      <AdminUserAccessControls user={user} returnPath={returnPath} />
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
