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
  __hamsterContactRealtimeBus?: ContactRealtimeBus;
};

function getContactRealtimeBus() {
  const globalForRealtime = globalThis as ContactRealtimeGlobal;

  if (!globalForRealtime.__hamsterContactRealtimeBus) {
    globalForRealtime.__hamsterContactRealtimeBus = {
      nextId: 1,
      listeners: new Set()
    };
  }

  return globalForRealtime.__hamsterContactRealtimeBus;
}

export function subscribeContactInquiryChanges(listener: ContactInquiryChangeListener) {
  const bus = getContactRealtimeBus();
  bus.listeners.add(listener);

  return () => {
    bus.listeners.delete(listener);
  };
}

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
