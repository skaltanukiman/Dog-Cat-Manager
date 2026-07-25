import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";

import { AdminPagination } from "@/components/admin-pagination";
import { AdminUserList } from "@/components/admin-user-list";
import { StatusMessage } from "@/components/status-message";
import { normalizeAdminPage } from "@/lib/admin-pagination";
import { getAdminUserPage } from "@/lib/admin-users";
import { getRequiredAppAdminUser } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams: Promise<{
    page?: string | string[];
    status?: string | string[];
    errorId?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const currentUser = await getRequiredAppAdminUser();
  const { users, pagination } = await getAdminUserPage(normalizeAdminPage(params.page));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-moss hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          管理トップへ戻る
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <Users className="h-6 w-6 text-moss" aria-hidden />
          <h2 className="text-xl font-bold text-ink">ユーザー管理</h2>
        </div>
        <p className="mt-1 text-sm text-slate-600">ユーザー情報、利用状態、アプリ全体権限を確認・管理します。</p>
      </div>

      <StatusMessage status={getParam(params.status)} errorId={getParam(params.errorId)} />

      <AdminPagination pathname="/admin/users" pagination={pagination} visibleCount={users.length} />
      <AdminUserList
        users={users}
        canEditAppRoles={currentUser.appRole === "SUPER_ADMIN"}
        canManageUserAccess={currentUser.appRole === "SUPER_ADMIN"}
        currentUserId={currentUser.id}
        returnPath="/admin/users"
      />
      <AdminPagination pathname="/admin/users" pagination={pagination} visibleCount={users.length} />
    </div>
  );
}
