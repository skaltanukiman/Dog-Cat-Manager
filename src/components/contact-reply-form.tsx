"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  replyToContactInquiry,
  updateContactInquiryAdmin,
  type ContactReplyState
} from "@/app/actions/contact";
import { useFormDirtyById } from "@/components/form-dirty-state";
import { CONTACT_REPLY_MAX_LENGTH, type ContactStatus } from "@/lib/contact-inquiry-core";

const INITIAL_CONTACT_REPLY_STATE: ContactReplyState = { success: false, error: null };

function ReplySubmitButton({ label, pending }: { label: string; pending?: boolean }) {
  const { pending: formPending } = useFormStatus();
  const isPending = pending ?? formPending;
  return (
    <button
      type="submit"
      disabled={isPending}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-moss px-5 py-2.5 text-sm font-bold text-white hover:bg-moss/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
    >
      {isPending ? "送信中..." : label}
    </button>
  );
}

function ActionMessage({ success, error }: { success: boolean; error: string | null }) {
  if (error) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }
  return success ? (
    <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      更新しました。
    </div>
  ) : null;
}

export function UserContactReplyForm({ publicId }: { publicId: string }) {
  const router = useRouter();
  const formId = `contact-user-reply-${publicId}`;
  useFormDirtyById(formId);
  const [state, action] = useActionState(replyToContactInquiry, INITIAL_CONTACT_REPLY_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state]);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-bold text-ink">追加で返信する</h3>
      <form
        id={formId}
        ref={formRef}
        action={action}
        className="mt-4 grid gap-4"
        data-dirty-watch
      >
        <input type="hidden" name="publicId" value={publicId} />
        <ActionMessage success={state.success} error={state.error} />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          返信内容
          <textarea
            name="body"
            required
            maxLength={CONTACT_REPLY_MAX_LENGTH}
            rows={6}
            className="min-h-32 resize-y"
          />
          <span className="text-xs font-normal text-slate-500">前後の空白を除いて1〜2,000文字</span>
        </label>
        <div className="flex justify-end">
          <ReplySubmitButton label="返信を送信" />
        </div>
      </form>
    </section>
  );
}

export function AdminContactReplyForm({
  publicId,
  currentStatus,
  assignedAdminUserId,
  admins
}: {
  publicId: string;
  currentStatus: ContactStatus;
  assignedAdminUserId: string | null;
  admins: Array<{ id: string; name: string | null; email: string | null; appRole: string }>;
}) {
  const router = useRouter();
  const formId = `contact-admin-reply-${publicId}`;
  useFormDirtyById(formId);
  const defaultStatus = currentStatus === "OPEN" ? "IN_PROGRESS" : currentStatus;
  const [replyBody, setReplyBody] = useState("");
  const [nextStatus, setNextStatus] = useState<ContactStatus>(defaultStatus);
  const [selectedAdminUserId, setSelectedAdminUserId] = useState(assignedAdminUserId ?? "");
  const [confirmClosed, setConfirmClosed] = useState(false);
  const [state, action, pending] = useActionState(
    async (previousState: ContactReplyState, formData: FormData) => {
      const nextState = await updateContactInquiryAdmin(previousState, formData);
      if (nextState.success) {
        setReplyBody("");
        setConfirmClosed(false);
        router.refresh();
      }
      return nextState;
    },
    INITIAL_CONTACT_REPLY_STATE
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      action(formData);
    });
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-bold text-ink">返信・管理</h3>
      <p className="mt-1 text-sm text-slate-600">
        返信せず、状態または担当者だけを変更することもできます。
      </p>
      <form
        id={formId}
        onSubmit={handleSubmit}
        className="mt-4 grid gap-4"
        data-dirty-watch
      >
        <input type="hidden" name="publicId" value={publicId} />
        <ActionMessage success={state.success} error={state.error} />
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          管理者返信（任意）
          <textarea
            name="body"
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            maxLength={CONTACT_REPLY_MAX_LENGTH}
            rows={7}
            className="min-h-36 resize-y"
            placeholder="利用者へ表示する返信を入力してください。"
          />
          <span className="text-xs font-normal text-slate-500">最大2,000文字。HTMLは実行されません。</span>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            変更後の状態
            <select
              name="nextStatus"
              value={nextStatus}
              onChange={(event) => {
                setNextStatus(event.target.value as ContactStatus);
                setConfirmClosed(false);
              }}
            >
              <option value="IN_PROGRESS">確認中</option>
              <option value="WAITING_FOR_USER">利用者からの回答待ち</option>
              <option value="RESOLVED">対応済み</option>
              <option value="CLOSED">終了</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700">
            担当管理者
            <select
              name="assignedAdminUserId"
              value={selectedAdminUserId}
              onChange={(event) => setSelectedAdminUserId(event.target.value)}
              className="min-w-0"
            >
              <option value="">未設定（返信時は自分を自動設定）</option>
              {admins.map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.name || admin.email || "名前未設定"}（{admin.appRole}）
                </option>
              ))}
            </select>
          </label>
        </div>
        {nextStatus === "CLOSED" ? (
          <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input
              type="checkbox"
              name="confirmClosed"
              value="yes"
              checked={confirmClosed}
              onChange={(event) => setConfirmClosed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="leading-5">
              状態を「終了」にすると、利用者は追加返信できなくなります。内容を確認しました。
            </span>
          </label>
        ) : null}
        <div className="flex justify-end">
          <ReplySubmitButton label="返信・変更を保存" pending={pending} />
        </div>
      </form>
    </section>
  );
}
