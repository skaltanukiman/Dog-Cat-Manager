import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { ContactCategoryBadge, ContactStatusBadge } from "@/components/contact-status-badge";
import { isContactInquiryOverdue } from "@/lib/contact-inquiry-core";
import type { ContactInquiryListItem } from "@/lib/contact-inquiry-queries";
import { assignedAdminDisplayName } from "@/lib/contact-inquiry-queries";
import { formatDateTimeJst } from "@/lib/date";

export function ContactInquiryList({ inquiries }: { inquiries: ContactInquiryListItem[] }) {
  if (inquiries.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
        問い合わせ履歴はまだありません。
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm lg:block">
        <table className="data-table min-w-[58rem]">
          <thead>
            <tr>
              <th scope="col">問い合わせ番号</th>
              <th scope="col">状態</th>
              <th scope="col">種類</th>
              <th scope="col">件名</th>
              <th scope="col">受付日時</th>
              <th scope="col">最終更新日時</th>
              <th scope="col" aria-label="詳細" />
            </tr>
          </thead>
          <tbody>
            {inquiries.map((inquiry) => (
              <tr key={inquiry.id}>
                <td className="break-all font-semibold text-ink">{inquiry.publicId}</td>
                <td><ContactStatusBadge status={inquiry.status} /></td>
                <td><ContactCategoryBadge category={inquiry.category} /></td>
                <td className="max-w-72 break-words [overflow-wrap:anywhere]">{inquiry.subject}</td>
                <td className="whitespace-nowrap">{formatDateTimeJst(inquiry.createdAt)}</td>
                <td className="whitespace-nowrap">{formatDateTimeJst(inquiry.updatedAt)}</td>
                <td>
                  <Link
                    href={`/contact/${inquiry.publicId}`}
                    aria-label={`${inquiry.publicId}の詳細を表示`}
                    className="inline-flex min-h-10 items-center gap-1 font-semibold text-moss hover:underline"
                  >
                    詳細
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 lg:hidden">
        {inquiries.map((inquiry) => (
          <article key={inquiry.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ContactStatusBadge status={inquiry.status} />
              <ContactCategoryBadge category={inquiry.category} />
            </div>
            <h4 className="mt-3 break-words font-bold text-ink [overflow-wrap:anywhere]">{inquiry.subject}</h4>
            <p className="mt-1 break-all text-xs font-semibold text-slate-500">{inquiry.publicId}</p>
            <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-slate-500">受付日時</dt>
                <dd className="mt-1 text-slate-700">{formatDateTimeJst(inquiry.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">最終更新日時</dt>
                <dd className="mt-1 text-slate-700">{formatDateTimeJst(inquiry.updatedAt)}</dd>
              </div>
            </dl>
            <Link
              href={`/contact/${inquiry.publicId}`}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-md border border-moss px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white sm:w-auto"
            >
              詳細を確認
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}

export function AdminContactInquiryList({
  inquiries,
  now
}: {
  inquiries: ContactInquiryListItem[];
  now: Date;
}) {
  if (inquiries.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
        条件に一致する問い合わせはありません。
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm lg:block">
        <table className="data-table min-w-[78rem] table-fixed">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">状態・種類</th>
              <th scope="col">問い合わせ番号</th>
              <th scope="col">件名</th>
              <th scope="col">利用者</th>
              <th scope="col">受付・更新</th>
              <th scope="col">担当管理者</th>
              <th scope="col" aria-label="詳細" />
            </tr>
          </thead>
          <tbody>
            {inquiries.map((inquiry) => {
              const isOverdue = isContactInquiryOverdue(inquiry, now);
              return (
                <tr key={inquiry.id} className={isOverdue ? "bg-red-50/50 hover:bg-red-50" : undefined}>
                  <td>
                    <div className="flex flex-col items-start gap-1.5">
                      {isOverdue ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                          24時間経過
                        </span>
                      ) : null}
                      <ContactStatusBadge status={inquiry.status} compact />
                      <ContactCategoryBadge category={inquiry.category} />
                    </div>
                  </td>
                <td className="break-all text-xs font-semibold text-ink">{inquiry.publicId}</td>
                <td className="break-words font-semibold text-ink [overflow-wrap:anywhere]">{inquiry.subject}</td>
                <td className="min-w-0">
                  <p className="break-words [overflow-wrap:anywhere]">{inquiry.userNameSnapshot}</p>
                  <p className="mt-1 break-all text-xs text-slate-500">{inquiry.userEmailSnapshot || "未設定"}</p>
                </td>
                <td className="text-xs">
                  <p>受付: {formatDateTimeJst(inquiry.createdAt)}</p>
                  <p className="mt-1">更新: {formatDateTimeJst(inquiry.updatedAt)}</p>
                </td>
                <td className="break-words [overflow-wrap:anywhere]">{assignedAdminDisplayName(inquiry)}</td>
                <td>
                  <Link
                    href={`/admin/inquiries/${inquiry.publicId}`}
                    aria-label={`${inquiry.publicId}の管理詳細を表示`}
                    className="inline-flex min-h-10 items-center gap-1 font-semibold text-moss hover:underline"
                  >
                    詳細
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 lg:hidden">
        {inquiries.map((inquiry) => {
          const isOverdue = isContactInquiryOverdue(inquiry, now);
          return (
            <article
              key={inquiry.id}
              className={isOverdue
                ? "min-w-0 rounded-md border border-red-300 bg-red-50/50 p-4 shadow-sm"
                : "min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm"}
            >
              <div className="flex flex-wrap items-center gap-2">
                {isOverdue ? (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                    24時間経過
                  </span>
                ) : null}
                <ContactStatusBadge status={inquiry.status} compact />
                <ContactCategoryBadge category={inquiry.category} />
              </div>
            <h3 className="mt-3 break-words font-bold text-ink [overflow-wrap:anywhere]">{inquiry.subject}</h3>
            <p className="mt-1 break-all text-xs font-semibold text-slate-500">{inquiry.publicId}</p>
            <dl className="mt-4 grid min-w-0 gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs font-semibold text-slate-500">利用者</dt>
                <dd className="mt-1 break-words text-slate-700 [overflow-wrap:anywhere]">{inquiry.userNameSnapshot}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-semibold text-slate-500">メールアドレス</dt>
                <dd className="mt-1 break-all text-slate-700">{inquiry.userEmailSnapshot || "未設定"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">受付日時</dt>
                <dd className="mt-1 text-slate-700">{formatDateTimeJst(inquiry.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">最終更新日時</dt>
                <dd className="mt-1 text-slate-700">{formatDateTimeJst(inquiry.updatedAt)}</dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-xs font-semibold text-slate-500">担当管理者</dt>
                <dd className="mt-1 break-words text-slate-700 [overflow-wrap:anywhere]">{assignedAdminDisplayName(inquiry)}</dd>
              </div>
            </dl>
            <Link
              href={`/admin/inquiries/${inquiry.publicId}`}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-md border border-moss px-4 text-sm font-semibold text-moss hover:bg-moss hover:text-white sm:w-auto"
            >
              詳細を確認
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
            </article>
          );
        })}
      </div>
    </>
  );
}
