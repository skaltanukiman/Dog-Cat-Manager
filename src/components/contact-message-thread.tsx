import { formatDateTimeJst } from "@/lib/date";

export function ContactMessageThread({
  messages,
  adminView = false
}: {
  messages: Array<{
    id: string;
    senderType: "USER" | "ADMIN";
    senderNameSnapshot: string;
    body: string;
    createdAt: Date;
  }>;
  adminView?: boolean;
}) {
  return (
    <ol className="grid gap-4" aria-label="メッセージ履歴">
      {messages.map((message) => {
        const fromAdmin = message.senderType === "ADMIN";
        const label = fromAdmin ? "サポート担当" : adminView ? "利用者" : "あなた";
        return (
          <li
            key={message.id}
            className={`min-w-0 rounded-md border p-4 shadow-sm ${
              fromAdmin ? "border-brand/30 bg-emerald-50/50" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-ink">
                {label}
                {adminView ? (
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {message.senderNameSnapshot}
                  </span>
                ) : null}
              </p>
              <time className="text-xs text-slate-500">{formatDateTimeJst(message.createdAt)}</time>
            </div>
            <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-7 text-slate-700 [overflow-wrap:anywhere]">
              {message.body}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
