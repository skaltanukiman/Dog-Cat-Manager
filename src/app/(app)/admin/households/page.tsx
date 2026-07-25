import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { AdminHouseholdList } from "@/components/admin-household-list";
import { AdminPagination } from "@/components/admin-pagination";
import { getAdminHouseholdPage } from "@/lib/admin-households";
import { normalizeAdminPage } from "@/lib/admin-pagination";
import { getRequiredAppAdminUser } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

export default async function AdminHouseholdsPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const params = await searchParams;
  await getRequiredAppAdminUser();
  const { households, pagination } = await getAdminHouseholdPage(normalizeAdminPage(params.page));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-moss hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          管理トップへ戻る
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-moss" aria-hidden />
          <h2 className="text-xl font-bold text-ink">共有管理</h2>
        </div>
        <p className="mt-1 text-sm text-slate-600">共有と所属メンバー、共有内権限を確認します。</p>
      </div>

      <AdminPagination pathname="/admin/households" pagination={pagination} visibleCount={households.length} />
      <AdminHouseholdList households={households} />
      <AdminPagination pathname="/admin/households" pagination={pagination} visibleCount={households.length} />
    </div>
  );
}
