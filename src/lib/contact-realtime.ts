import { logUnexpectedError } from "@/lib/server-errors";

export type ContactInquiryChangeSource =
  | "user-reply"
  | "admin-reply"
  | "status"
  | "assignee";

export type ContactInquiryChangeEvent = {
  id: number;
  publicId: string;
  source: ContactInquiryChangeSource;
  actorClientId: string | null;
  actorUserId: string | null;
  revision: string;
  createdAt: string;
};

export type CommittedContactInquiryChange = Omit<
  ContactInquiryChangeEvent,
  "createdAt" | "id"
>;

type ContactInquiryChangeListener = (event: ContactInquiryChangeEvent) => void;

type ContactRealtimeBus = {
  nextId: number;
  listeners: Set<ContactInquiryChangeListener>;
};

type ContactRealtimeGlobal = typeof globalThis & {
  __dogCatContactRealtimeBus?: ContactRealtimeBus;
};

function getContactRealtimeBus() {
  const globalForRealtime = globalThis as ContactRealtimeGlobal;

  if (!globalForRealtime.__dogCatContactRealtimeBus) {
    globalForRealtime.__dogCatContactRealtimeBus = {
      nextId: 1,
      listeners: new Set()
    };
  }

  return globalForRealtime.__dogCatContactRealtimeBus;
}

/**
 * 現在のNode.jsプロセス内で問い合わせ変更を購読する。
 *
 * 複数プロセス間の配送保証はないため、永続化されたrevisionのpollingを併用する必要がある。
 * @returns 購読を解除する関数
 */
export function subscribeContactInquiryChanges(listener: ContactInquiryChangeListener) {
  const bus = getContactRealtimeBus();
  bus.listeners.add(listener);

  return () => {
    bus.listeners.delete(listener);
  };
}

/**
 * commit済みの問い合わせ変更を、現在のNode.jsプロセス内の購読者へ同期通知する。
 *
 * DBのrevisionは更新せず、listenerの例外は呼び出し側へ伝播する。
 */
export function publishContactInquiryChange(change: CommittedContactInquiryChange) {
  const bus = getContactRealtimeBus();
  const event: ContactInquiryChangeEvent = {
    ...change,
    id: bus.nextId,
    createdAt: new Date().toISOString()
  };

  bus.nextId += 1;

  for (const listener of bus.listeners) {
    listener(event);
  }
}

/**
 * commit済みの問い合わせ変更を通知し、通知だけの失敗を記録して吸収する。
 *
 * DB更新は既に確定しているため、失敗時はrevision pollingによる追従へ委ねる。
 * @returns 通知に成功した場合は`true`
 */
export function publishContactInquiryChangeSafely(
  change: CommittedContactInquiryChange,
  publisher: (change: CommittedContactInquiryChange) => void = publishContactInquiryChange,
  reportError: typeof logUnexpectedError = logUnexpectedError
) {
  try {
    publisher(change);
    return true;
  } catch (error) {
    reportError(error, {
      operation: "contactRealtime.publish",
      context: {
        publicId: change.publicId,
        source: change.source,
        revision: change.revision
      }
    });
    return false;
  }
}
