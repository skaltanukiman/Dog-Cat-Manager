import type {
  AppRole,
  ContactInquiryCategory,
  ContactInquiryStatus,
  ContactSenderType,
  UserAccessStatus
} from "@prisma/client";

import {
  CONTACT_CREATION_WINDOW_MS,
  CONTACT_REPLY_COOLDOWN_MS,
  canTransitionContactStatus,
  contactStatusTimestamps,
  createContactPublicId,
  createContactSearchText,
  evaluateContactCreationLimit,
  statusAfterUserReply,
  type ContactCreationLimitCode
} from "@/lib/contact-inquiry-core";
import type {
  CommittedContactInquiryChange,
  ContactInquiryChangeSource
} from "@/lib/contact-realtime";
import { prisma } from "@/lib/prisma";

type ContactActor = {
  id: string;
  name: string | null;
  email: string | null;
  appRole: AppRole;
  accessStatus: UserAccessStatus;
};

type MutableInquiry = {
  id: string;
  publicId: string;
  userId: string | null;
  status: ContactInquiryStatus;
  assignedAdminUserId: string | null;
  assignedAdminNameSnapshot: string | null;
};

export type CreatedContactInquiry = {
  publicId: string;
  category: ContactInquiryCategory;
  subject: string;
  status: ContactInquiryStatus;
  createdAt: Date;
};

export type ContactInquiryMutationRepository = {
  lock(key: string): Promise<void>;
  findUser(userId: string): Promise<ContactActor | null>;
  findLatestInquiryCreatedByUser(userId: string): Promise<Date | null>;
  countInquiriesCreatedByUserSince(userId: string, since: Date): Promise<number>;
  findOldestInquiryCreatedByUserSince(userId: string, since: Date): Promise<Date | null>;
  countOpenInquiriesByUser(userId: string): Promise<number>;
  createInquiry(input: {
    publicId: string;
    actor: ContactActor;
    category: ContactInquiryCategory;
    subject: string;
    body: string;
    errorId: string | null;
    sourcePath: string | null;
    searchText: string;
    now: Date;
  }): Promise<CreatedContactInquiry>;
  findInquiryForUser(publicId: string, userId: string): Promise<MutableInquiry | null>;
  findInquiryForAdmin(publicId: string): Promise<MutableInquiry | null>;
  findLatestMessageAt(inquiryId: string, senderType: ContactSenderType): Promise<Date | null>;
  createMessage(input: {
    inquiryId: string;
    senderType: ContactSenderType;
    actor: ContactActor;
    body: string;
    now: Date;
  }): Promise<void>;
  updateInquiry(input: {
    inquiry: MutableInquiry;
    status: ContactInquiryStatus;
    assignedAdminUserId: string | null;
    assignedAdminNameSnapshot: string | null;
    now: Date;
  }): Promise<boolean>;
  updateRealtimeRevision(input: {
    inquiry: MutableInquiry;
    source: ContactInquiryChangeSource;
    actorClientId: string | null;
    actorUserId: string;
    now: Date;
  }): Promise<CommittedContactInquiryChange>;
};

export type ContactInquiryMutationExecutor = <T>(
  operation: (repository: ContactInquiryMutationRepository) => Promise<T>
) => Promise<T>;

function actorSnapshotName(actor: Pick<ContactActor, "name" | "email">) {
  return actor.name?.trim() || actor.email?.trim() || "名前未設定";
}

const executePrismaContactMutation: ContactInquiryMutationExecutor = (operation) =>
  prisma.$transaction(async (tx) =>
    operation({
      lock: async (key) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      },
      findUser: (userId) =>
        tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            email: true,
            appRole: true,
            accessStatus: true
          }
        }),
      findLatestInquiryCreatedByUser: async (userId) =>
        (
          await tx.contactInquiry.findFirst({
            where: { userId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { createdAt: true }
          })
        )?.createdAt ?? null,
      countInquiriesCreatedByUserSince: (userId, since) =>
        tx.contactInquiry.count({ where: { userId, createdAt: { gte: since } } }),
      findOldestInquiryCreatedByUserSince: async (userId, since) =>
        (
          await tx.contactInquiry.findFirst({
            where: { userId, createdAt: { gte: since } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { createdAt: true }
          })
        )?.createdAt ?? null,
      countOpenInquiriesByUser: (userId) =>
        tx.contactInquiry.count({ where: { userId, status: { not: "CLOSED" } } }),
      createInquiry: ({ actor, body, now, ...input }) =>
        tx.contactInquiry.create({
          data: {
            ...input,
            userId: actor.id,
            userIdSnapshot: actor.id,
            userNameSnapshot: actorSnapshotName(actor),
            userEmailSnapshot: actor.email,
            status: "OPEN",
            createdAt: now,
            updatedAt: now,
            messages: {
              create: {
                senderType: "USER",
                senderUserId: actor.id,
                senderUserIdSnapshot: actor.id,
                senderNameSnapshot: actorSnapshotName(actor),
                body,
                createdAt: now
              }
            }
          },
          select: {
            publicId: true,
            category: true,
            subject: true,
            status: true,
            createdAt: true
          }
        }),
      findInquiryForUser: (publicId, userId) =>
        tx.contactInquiry.findFirst({
          where: { publicId, userId },
          select: {
            id: true,
            publicId: true,
            userId: true,
            status: true,
            assignedAdminUserId: true,
            assignedAdminNameSnapshot: true
          }
        }),
      findInquiryForAdmin: (publicId) =>
        tx.contactInquiry.findUnique({
          where: { publicId },
          select: {
            id: true,
            publicId: true,
            userId: true,
            status: true,
            assignedAdminUserId: true,
            assignedAdminNameSnapshot: true
          }
        }),
      findLatestMessageAt: async (inquiryId, senderType) =>
        (
          await tx.contactInquiryMessage.findFirst({
            where: { inquiryId, senderType },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { createdAt: true }
          })
        )?.createdAt ?? null,
      createMessage: async ({ inquiryId, senderType, actor, body, now }) => {
        await tx.contactInquiryMessage.create({
          data: {
            inquiryId,
            senderType,
            senderUserId: actor.id,
            senderUserIdSnapshot: actor.id,
            senderNameSnapshot: actorSnapshotName(actor),
            body,
            createdAt: now
          }
        });
      },
      updateInquiry: async ({
        inquiry,
        status,
        assignedAdminUserId,
        assignedAdminNameSnapshot,
        now
      }) => {
        const updated = await tx.contactInquiry.updateMany({
          where: { id: inquiry.id, status: inquiry.status },
          data: {
            status,
            assignedAdminUserId,
            assignedAdminNameSnapshot,
            updatedAt: now,
            ...contactStatusTimestamps(status, now)
          }
        });
        return updated.count === 1;
      },
      updateRealtimeRevision: async ({
        inquiry,
        source,
        actorClientId,
        actorUserId,
        now
      }) => {
        const updated = await tx.contactInquiry.update({
          where: { id: inquiry.id },
          data: {
            realtimeRevision: { increment: 1 },
            realtimeActorClientId: actorClientId,
            realtimeActorUserId: actorUserId,
            updatedAt: now
          },
          select: { realtimeRevision: true }
        });
        return {
          publicId: inquiry.publicId,
          source,
          actorClientId,
          actorUserId,
          revision: updated.realtimeRevision.toString()
        };
      }
    })
  );

export type CreateContactInquiryResult =
  | { status: "created"; inquiry: CreatedContactInquiry }
  | { status: "forbidden" }
  | { status: "limited"; code: ContactCreationLimitCode; retryAt?: Date };

export async function createContactInquiry(
  input: {
    actorUserId: string;
    category: ContactInquiryCategory;
    subject: string;
    body: string;
    errorId: string | null;
    sourcePath: string | null;
    now?: Date;
  },
  execute: ContactInquiryMutationExecutor = executePrismaContactMutation
): Promise<CreateContactInquiryResult> {
  const now = input.now ?? new Date();
  return execute(async (repository) => {
    // 作成上限はUser単位なので、Householdに関係なく同じ利用者の同時送信を直列化してから再計算する。
    await repository.lock(`contact-create:${input.actorUserId}`);
    const actor = await repository.findUser(input.actorUserId);
    if (!actor || actor.accessStatus !== "ACTIVE") return { status: "forbidden" };

    const since = new Date(now.getTime() - CONTACT_CREATION_WINDOW_MS);
    const [
      latestCreatedAt,
      createdWithinWindow,
      oldestCreatedWithinWindowAt,
      openInquiryCount
    ] = await Promise.all([
      repository.findLatestInquiryCreatedByUser(actor.id),
      repository.countInquiriesCreatedByUserSince(actor.id, since),
      repository.findOldestInquiryCreatedByUserSince(actor.id, since),
      repository.countOpenInquiriesByUser(actor.id)
    ]);
    const limit = evaluateContactCreationLimit({
      now,
      latestCreatedAt,
      createdWithinWindow,
      oldestCreatedWithinWindowAt,
      openInquiryCount
    });
    if (limit) return { status: "limited", ...limit };

    const publicId = createContactPublicId(now);
    const inquiry = await repository.createInquiry({
      publicId,
      actor,
      category: input.category,
      subject: input.subject,
      body: input.body,
      errorId: input.errorId,
      sourcePath: input.sourcePath,
      searchText: createContactSearchText({
        publicId,
        subject: input.subject,
        userName: actorSnapshotName(actor),
        userEmail: actor.email
      }),
      now
    });
    return { status: "created", inquiry };
  });
}

export type UserContactReplyResult =
  | {
      status: "replied";
      nextStatus: ContactInquiryStatus;
      change: CommittedContactInquiryChange;
    }
  | { status: "forbidden" | "notFound" | "closed" | "stateChanged" }
  | { status: "limited"; retryAt: Date };

export async function addUserContactReply(
  input: {
    actorUserId: string;
    actorClientId?: string | null;
    publicId: string;
    body: string;
    now?: Date;
  },
  execute: ContactInquiryMutationExecutor = executePrismaContactMutation
): Promise<UserContactReplyResult> {
  const now = input.now ?? new Date();
  return execute(async (repository) => {
    // 返信・状態・担当者を問い合わせ単位で直列化し、同じ旧状態を見た更新の取りこぼしを防ぐ。
    await repository.lock(`contact-inquiry:${input.publicId}`);
    const actor = await repository.findUser(input.actorUserId);
    if (!actor || actor.accessStatus !== "ACTIVE") return { status: "forbidden" };
    const inquiry = await repository.findInquiryForUser(input.publicId, actor.id);
    if (!inquiry) return { status: "notFound" };
    const nextStatus = statusAfterUserReply(inquiry.status);
    if (!nextStatus) return { status: "closed" };

    const latestUserMessageAt = await repository.findLatestMessageAt(inquiry.id, "USER");
    if (
      latestUserMessageAt &&
      now.getTime() - latestUserMessageAt.getTime() < CONTACT_REPLY_COOLDOWN_MS
    ) {
      return {
        status: "limited",
        retryAt: new Date(latestUserMessageAt.getTime() + CONTACT_REPLY_COOLDOWN_MS)
      };
    }

    const updated = await repository.updateInquiry({
      inquiry,
      status: nextStatus,
      assignedAdminUserId: inquiry.assignedAdminUserId,
      assignedAdminNameSnapshot: inquiry.assignedAdminNameSnapshot,
      now
    });
    if (!updated) return { status: "stateChanged" };
    await repository.createMessage({
      inquiryId: inquiry.id,
      senderType: "USER",
      actor,
      body: input.body,
      now
    });
    const change = await repository.updateRealtimeRevision({
      inquiry,
      source: "user-reply",
      actorClientId: input.actorClientId ?? null,
      actorUserId: actor.id,
      now
    });
    return { status: "replied", nextStatus, change };
  });
}

export type AdminContactMutationResult =
  | {
      status: "updated";
      nextStatus: ContactInquiryStatus;
      change: CommittedContactInquiryChange;
    }
  | {
      status:
        | "forbidden"
        | "notFound"
        | "closed"
        | "invalidTransition"
        | "invalidAssignee"
        | "noChange"
        | "stateChanged";
    };

export async function updateContactInquiryByAdmin(
  input: {
    actorUserId: string;
    actorClientId?: string | null;
    publicId: string;
    body: string | null;
    nextStatus: ContactInquiryStatus;
    assignedAdminUserId: string | null;
    now?: Date;
  },
  execute: ContactInquiryMutationExecutor = executePrismaContactMutation
): Promise<AdminContactMutationResult> {
  const now = input.now ?? new Date();
  return execute(async (repository) => {
    await repository.lock(`contact-inquiry:${input.publicId}`);
    const actor = await repository.findUser(input.actorUserId);
    if (
      !actor ||
      actor.accessStatus !== "ACTIVE" ||
      !["ADMIN", "SUPER_ADMIN"].includes(actor.appRole)
    ) {
      return { status: "forbidden" };
    }
    const inquiry = await repository.findInquiryForAdmin(input.publicId);
    if (!inquiry) return { status: "notFound" };
    if (inquiry.status === "CLOSED") return { status: "closed" };
    if (!canTransitionContactStatus(inquiry.status, input.nextStatus)) {
      return { status: "invalidTransition" };
    }

    let assignee: ContactActor | null = null;
    if (input.assignedAdminUserId) {
      assignee = await repository.findUser(input.assignedAdminUserId);
      if (
        !assignee ||
        assignee.accessStatus !== "ACTIVE" ||
        !["ADMIN", "SUPER_ADMIN"].includes(assignee.appRole)
      ) {
        return { status: "invalidAssignee" };
      }
    } else if (input.body && !inquiry.assignedAdminUserId) {
      // 未担当の問い合わせへ最初に返信した管理者を自動設定し、返信者と担当表示を一致させる。
      assignee = actor;
    }

    const assignedAdminUserId = assignee?.id ?? input.assignedAdminUserId;
    const assignedAdminNameSnapshot = assignee
      ? actorSnapshotName(assignee)
      : assignedAdminUserId === inquiry.assignedAdminUserId
        ? inquiry.assignedAdminNameSnapshot
        : null;
    const changed =
      Boolean(input.body) ||
      input.nextStatus !== inquiry.status ||
      assignedAdminUserId !== inquiry.assignedAdminUserId;
    if (!changed) return { status: "noChange" };

    const updated = await repository.updateInquiry({
      inquiry,
      status: input.nextStatus,
      assignedAdminUserId,
      assignedAdminNameSnapshot,
      now
    });
    if (!updated) return { status: "stateChanged" };
    if (input.body) {
      await repository.createMessage({
        inquiryId: inquiry.id,
        senderType: "ADMIN",
        actor,
        body: input.body,
        now
      });
    }
    const change = await repository.updateRealtimeRevision({
      inquiry,
      source: input.body
        ? "admin-reply"
        : input.nextStatus !== inquiry.status
          ? "status"
          : "assignee",
      actorClientId: input.actorClientId ?? null,
      actorUserId: actor.id,
      now
    });
    return { status: "updated", nextStatus: input.nextStatus, change };
  });
}
