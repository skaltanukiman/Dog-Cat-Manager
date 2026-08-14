import { Link2 } from "lucide-react";

import { InvitationRevokeForm } from "@/components/invitation-revoke-form";
import { InvitationStatusBadge } from "@/components/invitation-status-badge";
import { formatDateTimeJst } from "@/lib/date";
import {
  getInvitationCreatorDisplayName,
  getHouseholdInvitationStatus,
} from "@/lib/invitations";

type HouseholdInvitationListItem = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdBy: { name: string | null; email: string | null } | null;
};

export function HouseholdInvitationList({
  invitations,
  canManage,
  now
}: {
  invitations: HouseholdInvitationListItem[];
  canManage: boolean;
  now: Date;
}) {
  const activeInvitations = invitations.filter(
    (invitation) => getHouseholdInvitationStatus(invitation, now) === "active"
  );

  if (activeInvitations.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 border-t border-slate-300 pt-6 sm:space-y-4 sm:pt-8">
      <div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <h3 className="text-base font-bold text-ink">有効な招待リンク</h3>
          </div>
          <p className="mt-1 text-sm text-slate-600">過去のリンク自体は再表示されません。有効なリンクだけ無効化できます。</p>
        </div>
      </div>

      <div className="hidden overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm lg:block">
        <table className="data-table">
          <thead>
            <tr>
              <th>作成日時</th>
              <th>有効期限</th>
              <th>状態</th>
              <th>作成者</th>
              {canManage ? <th>操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {activeInvitations.map((invitation) => {
              const status = getHouseholdInvitationStatus(invitation, now);
              return (
                <tr key={invitation.id}>
                  <td>{formatDateTimeJst(invitation.createdAt)}</td>
                  <td>{formatDateTimeJst(invitation.expiresAt)}</td>
                  <td>
                    <InvitationStatusBadge status={status} />
                  </td>
                  <td>{getInvitationCreatorDisplayName(invitation)}</td>
                  {canManage ? (
                    <td>{status === "active" ? <InvitationRevokeForm invitationId={invitation.id} /> : "-"}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:hidden">
        {activeInvitations.map((invitation) => {
          const status = getHouseholdInvitationStatus(invitation, now);
          return (
            <article key={invitation.id} className="rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{getInvitationCreatorDisplayName(invitation)}</p>
                  <p className="mt-1 text-xs text-slate-500">作成: {formatDateTimeJst(invitation.createdAt)}</p>
                </div>
                <InvitationStatusBadge status={status} />
              </div>
              <p className="mt-3 text-xs text-slate-600">有効期限: {formatDateTimeJst(invitation.expiresAt)}</p>
              {canManage && status === "active" ? (
                <div className="mt-3">
                  <InvitationRevokeForm invitationId={invitation.id} />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
