"use server";

import type { ContactInquiryStatus } from "@prisma/client";

import {
  CONTACT_REPLY_MAX_LENGTH,
  CONTACT_STATUSES,
  contactReplySchema,
  createContactInquirySchema,
  isPublicContactId
} from "@/lib/contact-inquiry-core";
import {
  addUserContactReply,
  createContactInquiry,
  updateContactInquiryByAdmin
} from "@/lib/contact-inquiry-mutations";
import { publishContactInquiryChangeSafely } from "@/lib/contact-realtime";
import { getRequiredAppAdminUser, getRequiredSessionUser } from "@/lib/auth-context";
import { getRealtimeActorId } from "@/lib/realtime";
import { revalidatePathsSafely } from "@/lib/safe-side-effects";
import { handleServerActionError, isPrismaUniqueConstraintError } from "@/lib/server-errors";

export type ContactFormField = "category" | "subject" | "body" | "errorId" | "sourcePath";
export type ContactFormState = {
  fieldErrors: Partial<Record<ContactFormField, string>>;
  formError: string | null;
  created: {
    publicId: string;
    category: string;
    subject: string;
    status: string;
    createdAt: string;
  } | null;
};

function createFieldErrors(issues: Array<{ path: PropertyKey[] }>) {
  const errors: ContactFormState["fieldErrors"] = {};
  for (const issue of issues) {
    const field = issue.path[0] as ContactFormField | undefined;
    if (!field || errors[field]) continue;
    errors[field] =
      field === "category"
        ? "問い合わせ種類を選択してください。"
        : field === "subject"
          ? "件名は前後の空白を除いて1〜100文字で入力してください。"
          : field === "body"
            ? "問い合わせ内容は前後の空白を除いて10〜2,000文字で入力してください。"
            : field === "errorId"
              ? "エラーIDは128文字以内の英数字と「. _ : -」で入力してください。"
              : "発生した画面には300文字以内のアプリ内パスを入力してください。";
  }
  return errors;
}

function creationLimitMessage(code: "cooldown" | "hourlyLimit" | "openLimit") {
  if (code === "cooldown") return "連続送信を防ぐため、30秒ほど待ってからもう一度お試しください。";
  if (code === "hourlyLimit") return "1時間に送信できる問い合わせは5件までです。時間をおいてお試しください。";
  return "終了していない問い合わせが多いため、新しい問い合わせを作成できません。既存の問い合わせをご利用ください。";
}

export async function submitContactInquiry(
  _previousState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  try {
    const user = await getRequiredSessionUser();
    const parsed = createContactInquirySchema.safeParse({
      category: formData.get("category"),
      subject: formData.get("subject"),
      body: formData.get("body"),
      errorId: formData.get("errorId"),
      sourcePath: formData.get("sourcePath")
    });
    if (!parsed.success) {
      return {
        fieldErrors: createFieldErrors(parsed.error.issues),
        formError: "入力内容を確認してください。",
        created: null
      };
    }

    const input = { actorUserId: user.id, ...parsed.data };
    let result;
    try {
      result = await createContactInquiry(input);
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      result = await createContactInquiry(input);
    }
    if (result.status === "forbidden") {
      return { fieldErrors: {}, formError: "この操作を実行する権限がありません。", created: null };
    }
    if (result.status === "limited") {
      return { fieldErrors: {}, formError: creationLimitMessage(result.code), created: null };
    }

    revalidatePathsSafely(
      [{ path: "/contact" }, { path: "/admin" }, { path: "/admin/inquiries" }],
      "contact.create.revalidate",
      { userId: user.id }
    );
    return {
      fieldErrors: {},
      formError: null,
      created: {
        publicId: result.inquiry.publicId,
        category: result.inquiry.category,
        subject: result.inquiry.subject,
        status: result.inquiry.status,
        createdAt: result.inquiry.createdAt.toISOString()
      }
    };
  } catch (error) {
    handleServerActionError(error, { operation: "contact.create", pathname: "/contact" });
  }
}

export type ContactReplyState = {
  success: boolean;
  error: string | null;
};

export async function replyToContactInquiry(
  _previousState: ContactReplyState,
  formData: FormData
): Promise<ContactReplyState> {
  const publicId = formData.get("publicId");
  try {
    const user = await getRequiredSessionUser();
    if (!isPublicContactId(publicId)) return { success: false, error: "問い合わせを確認できません。" };
    const parsed = contactReplySchema.safeParse(formData.get("body"));
    if (!parsed.success) {
      return { success: false, error: "返信は前後の空白を除いて1〜2,000文字で入力してください。" };
    }
    const result = await addUserContactReply({
      actorUserId: user.id,
      actorClientId: getRealtimeActorId(formData),
      publicId,
      body: parsed.data
    });
    if (result.status === "replied") {
      publishContactInquiryChangeSafely(result.change);
      revalidatePathsSafely(
        [
          { path: `/contact/${publicId}` },
          { path: "/contact" },
          { path: "/admin" },
          { path: "/admin/inquiries" },
          { path: `/admin/inquiries/${publicId}` }
        ],
        "contact.userReply.revalidate",
        { userId: user.id }
      );
      return { success: true, error: null };
    }
    if (result.status === "closed") {
      return { success: false, error: "終了した問い合わせには返信できません。" };
    }
    if (result.status === "limited") {
      return { success: false, error: "連続送信を防ぐため、10秒ほど待ってからもう一度お試しください。" };
    }
    return { success: false, error: "問い合わせを更新できません。画面を再読み込みしてお試しください。" };
  } catch (error) {
    handleServerActionError(error, {
      operation: "contact.userReply",
      pathname: isPublicContactId(publicId) ? `/contact/${publicId}` : "/contact"
    });
  }
}

const ADMIN_NEXT_STATUSES: ContactInquiryStatus[] = [
  "IN_PROGRESS",
  "WAITING_FOR_USER",
  "RESOLVED",
  "CLOSED"
];

export async function updateContactInquiryAdmin(
  _previousState: ContactReplyState,
  formData: FormData
): Promise<ContactReplyState> {
  const publicId = formData.get("publicId");
  try {
    const admin = await getRequiredAppAdminUser();
    if (!isPublicContactId(publicId)) return { success: false, error: "問い合わせを確認できません。" };

    const rawBody = formData.get("body");
    const body = typeof rawBody === "string" && rawBody.trim() ? rawBody.trim() : null;
    if (body && body.length > CONTACT_REPLY_MAX_LENGTH) {
      return { success: false, error: "返信は2,000文字以内で入力してください。" };
    }
    const rawStatus = formData.get("nextStatus");
    if (
      typeof rawStatus !== "string" ||
      !CONTACT_STATUSES.includes(rawStatus as ContactInquiryStatus) ||
      !ADMIN_NEXT_STATUSES.includes(rawStatus as ContactInquiryStatus)
    ) {
      return { success: false, error: "変更後の状態を確認してください。" };
    }
    if (rawStatus === "CLOSED" && formData.get("confirmClosed") !== "yes") {
      return { success: false, error: "終了することを確認してから実行してください。" };
    }
    const rawAssignee = formData.get("assignedAdminUserId");
    if (typeof rawAssignee !== "string") {
      return { success: false, error: "担当者を確認してください。" };
    }

    const result = await updateContactInquiryByAdmin({
      actorUserId: admin.id,
      actorClientId: getRealtimeActorId(formData),
      publicId,
      body,
      nextStatus: rawStatus as ContactInquiryStatus,
      assignedAdminUserId: rawAssignee || null
    });
    if (result.status === "updated") {
      publishContactInquiryChangeSafely(result.change);
      revalidatePathsSafely(
        [
          { path: `/admin/inquiries/${publicId}` },
          { path: "/admin/inquiries" },
          { path: "/admin" },
          { path: `/contact/${publicId}` },
          { path: "/contact" }
        ],
        "contact.adminUpdate.revalidate",
        { userId: admin.id }
      );
      return { success: true, error: null };
    }
    const messages: Record<Exclude<typeof result.status, "updated">, string> = {
      forbidden: "この操作を実行する権限がありません。",
      notFound: "問い合わせを確認できません。",
      closed: "終了した問い合わせには返信・変更できません。",
      invalidTransition: "現在の状態から選択した状態へは変更できません。",
      invalidAssignee: "担当者には現在の管理者またはスーパー管理者を選択してください。",
      noChange: "返信、状態、担当者のいずれかを変更してください。",
      stateChanged: "問い合わせの状態が変更されています。画面を再読み込みしてください。"
    };
    return { success: false, error: messages[result.status] };
  } catch (error) {
    handleServerActionError(error, {
      operation: "contact.adminUpdate",
      pathname: isPublicContactId(publicId) ? `/admin/inquiries/${publicId}` : "/admin/inquiries"
    });
  }
}
