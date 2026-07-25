import { auth } from "@/auth";
import { InvitationAcceptForm } from "@/components/invitation-accept-form";
import { StatusMessage } from "@/components/status-message";

export const dynamic = "force-dynamic";

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AcceptInvitationPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string | string[]; errorId?: string | string[] }>;
}) {
  const params = await searchParams;
  const status = getParam(params.status);
  const session = await auth();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">共有への参加</h2>
        <p className="mt-1 text-sm text-slate-600">招待リンクを確認し、現在のGoogleアカウントで参加します。</p>
      </div>

      <StatusMessage status={status} errorId={getParam(params.errorId)} />

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <InvitationAcceptForm isLoggedIn={Boolean(session?.user?.id)} />
      </section>
    </div>
  );
}
