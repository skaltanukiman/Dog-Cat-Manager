import { HOUSEHOLD_ROLE_LABELS } from "@/lib/authorization";
import type { AdminHouseholdListItem } from "@/lib/admin-households";
import { formatDateJst } from "@/lib/date";

export function AdminHouseholdList({ households }: { households: AdminHouseholdListItem[] }) {
  if (households.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
        共有はまだありません。
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {households.map((household) => (
        <article key={household.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="break-words font-bold text-ink [overflow-wrap:anywhere]">{household.name}</h4>
              <p className="mt-1 break-words text-sm text-slate-600">
                メンバー {household._count.members} 人 / Pet {household._count.pets} 件 / 招待{" "}
                {household._count.invitations} 件
              </p>
            </div>
            <span className="shrink-0 text-xs text-slate-500">作成日: {formatDateJst(household.createdAt)}</span>
          </div>
          <div className="mt-3 flex min-w-0 flex-wrap gap-2">
            {household.members.length > 0 ? (
              household.members.map((member) => (
                <span
                  key={member.id}
                  className="max-w-full break-words rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 [overflow-wrap:anywhere]"
                >
                  {member.user.name || member.user.email || "未設定"} / {HOUSEHOLD_ROLE_LABELS[member.role]}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-500">所属メンバーはいません。</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
