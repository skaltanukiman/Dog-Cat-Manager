import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { HouseholdRole } from "@prisma/client";

import {
  createRateLimitedHouseholdInvitation,
  revokeHouseholdInvitationMutation,
  type InvitationMutationExecutor,
  type InvitationMutationRepository
} from "../src/lib/invitation-mutations";
import {
  invitationAcceptanceFailure,
  invitationExpiresAt,
  INVITATION_CREATION_RATE_SCOPE,
  INVITATION_CREATION_WINDOW_LIMIT,
  MAX_ACTIVE_HOUSEHOLD_INVITATIONS
} from "../src/lib/invitations";

type StoredInvitation = {
  id: string;
  householdId: string;
  createdByUserId: string | null;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

type FakeDatabase = {
  memberships: Map<string, HouseholdRole>;
  invitations: StoredInvitation[];
  userLockTails: Map<string, Promise<void>>;
  householdLockTails: Map<string, Promise<void>>;
  nextId: number;
  revision: number;
};

function membershipKey(householdId: string, userId: string) {
  return `${householdId}:${userId}`;
}

function createFakeDatabase(): FakeDatabase {
  return {
    memberships: new Map([[membershipKey("household-1", "user-1"), "OWNER"]]),
    invitations: [],
    userLockTails: new Map(),
    householdLockTails: new Map(),
    nextId: 1,
    revision: 0
  };
}

function createFakeExecutor(database: FakeDatabase): InvitationMutationExecutor {
  return async (operation) => {
    const lockReleases: Array<() => void> = [];

    async function acquireLock(lockTails: Map<string, Promise<void>>, key: string) {
      const previousTail = lockTails.get(key) ?? Promise.resolve();
      let releaseCurrent!: () => void;
      const current = new Promise<void>((resolve) => {
        releaseCurrent = resolve;
      });
      lockTails.set(key, previousTail.then(() => current));
      await previousTail;
      lockReleases.push(releaseCurrent);
    }

    const repository: InvitationMutationRepository = {
      findMembershipRole: async (householdId, userId) =>
        database.memberships.get(membershipKey(householdId, userId)) ?? null,
      lockInvitationCreationByUser: (userId) => acquireLock(database.userLockTails, userId),
      lockInvitationCreationByHousehold: (householdId) =>
        acquireLock(database.householdLockTails, householdId),
      countActiveInvitationsInHousehold: async (householdId, now) =>
        database.invitations.filter(
          (invitation) =>
            invitation.householdId === householdId &&
            invitation.acceptedAt === null &&
            invitation.revokedAt === null &&
            invitation.expiresAt.getTime() > now.getTime()
        ).length,
      findLatestInvitationCreatedByUser: async (userId) =>
        database.invitations
          .filter((invitation) => invitation.createdByUserId === userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdAt ?? null,
      countInvitationsCreatedByUserSince: async (userId, since) =>
        database.invitations.filter(
          (invitation) =>
            invitation.createdByUserId === userId && invitation.createdAt.getTime() >= since.getTime()
        ).length,
      findOldestInvitationCreatedByUserSince: async (userId, since) =>
        database.invitations
          .filter(
            (invitation) =>
              invitation.createdByUserId === userId && invitation.createdAt.getTime() >= since.getTime()
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt ?? null,
      createInvitation: async (input) => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const invitation: StoredInvitation = {
          id: `invitation-${database.nextId++}`,
          ...input,
          acceptedAt: null,
          revokedAt: null
        };
        database.invitations.push(invitation);
        return { id: invitation.id, expiresAt: invitation.expiresAt };
      },
      findInvitation: async (householdId, invitationId) =>
        database.invitations.find(
          (invitation) => invitation.id === invitationId && invitation.householdId === householdId
        ) ?? null,
      revokeInvitation: async (householdId, invitationId, now) => {
        const invitation = database.invitations.find(
          (item) =>
            item.id === invitationId &&
            item.householdId === householdId &&
            item.acceptedAt === null &&
            item.revokedAt === null &&
            item.expiresAt.getTime() > now.getTime()
        );
        if (!invitation) return 0;
        invitation.revokedAt = now;
        return 1;
      },
      commitChange: async ({ householdId, actorClientId, actorUserId }) => {
        database.revision += 1;
        return {
          householdId,
          source: "member",
          actorClientId,
          actorUserId,
          revision: String(database.revision)
        };
      }
    };

    try {
      return await operation(repository);
    } finally {
      for (const release of lockReleases.reverse()) release();
    }
  };
}

function seedInvitation(
  database: FakeDatabase,
  input: Partial<StoredInvitation> & Pick<StoredInvitation, "createdAt">
) {
  const invitation: StoredInvitation = {
    id: input.id ?? `seed-${database.nextId++}`,
    householdId: input.householdId ?? "household-1",
    createdByUserId: input.createdByUserId ?? "user-1",
    tokenHash: input.tokenHash ?? `hash-${database.nextId}`,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt ?? new Date(input.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: input.acceptedAt ?? null,
    revokedAt: input.revokedAt ?? null
  };
  database.invitations.push(invitation);
  return invitation;
}

let tokenSequence = 1;

function creationInput(now: Date, overrides: Partial<Parameters<typeof createRateLimitedHouseholdInvitation>[0]> = {}) {
  return {
    householdId: "household-1",
    actorUserId: "user-1",
    actorClientId: "client-1",
    tokenHash: `token-${tokenSequence++}`,
    now,
    expiresAt: invitationExpiresAt(now),
    ...overrides
  };
}

test("初回の招待リンク作成に成功し、作成者と7日後の期限を保存する", async () => {
  const database = createFakeDatabase();
  const now = new Date("2026-07-14T00:00:00.000Z");
  const result = await createRateLimitedHouseholdInvitation(creationInput(now), createFakeExecutor(database));

  assert.equal(result.status, "created");
  assert.equal(database.invitations.length, 1);
  assert.equal(database.invitations[0].createdByUserId, "user-1");
  assert.equal(database.invitations[0].expiresAt.toISOString(), "2026-07-21T00:00:00.000Z");
});

test("前回作成から30秒未満は拒否し、30秒経過時は作成できる", async () => {
  const now = new Date("2026-07-14T01:00:00.000Z");
  const blockedDatabase = createFakeDatabase();
  seedInvitation(blockedDatabase, { createdAt: new Date(now.getTime() - 29_999) });
  const blocked = await createRateLimitedHouseholdInvitation(
    creationInput(now),
    createFakeExecutor(blockedDatabase)
  );
  assert.deepEqual(blocked.status === "limited" ? blocked.code : null, "cooldown");

  const allowedDatabase = createFakeDatabase();
  seedInvitation(allowedDatabase, { createdAt: new Date(now.getTime() - 30_000) });
  const allowed = await createRateLimitedHouseholdInvitation(
    creationInput(now),
    createFakeExecutor(allowedDatabase)
  );
  assert.equal(allowed.status, "created");
});

test("過去1時間以内に5件作成済みの場合は拒否する", async () => {
  const database = createFakeDatabase();
  const now = new Date("2026-07-14T02:00:00.000Z");
  for (const minutes of [55, 45, 35, 25, 1]) {
    seedInvitation(database, { createdAt: new Date(now.getTime() - minutes * 60 * 1000) });
  }

  const result = await createRateLimitedHouseholdInvitation(creationInput(now), createFakeExecutor(database));
  assert.equal(INVITATION_CREATION_WINDOW_LIMIT, 5);
  assert.deepEqual(result.status === "limited" ? result.code : null, "hourlyLimit");
});

test("1時間の範囲外になった招待は件数に含めない", async () => {
  const database = createFakeDatabase();
  const now = new Date("2026-07-14T03:00:00.000Z");
  for (let index = 1; index <= 5; index += 1) {
    seedInvitation(database, { createdAt: new Date(now.getTime() - 60 * 60 * 1000 - index) });
  }

  const result = await createRateLimitedHouseholdInvitation(creationInput(now), createFakeExecutor(database));
  assert.equal(result.status, "created");
});

test("別ユーザーの履歴は影響せず、同一ユーザーの別Household履歴は制限へ算入する", async () => {
  const now = new Date("2026-07-14T04:00:00.000Z");
  const otherUserDatabase = createFakeDatabase();
  for (let index = 0; index < 5; index += 1) {
    seedInvitation(otherUserDatabase, {
      createdByUserId: "user-2",
      createdAt: new Date(now.getTime() - (index + 1) * 5 * 60 * 1000)
    });
  }
  const otherUserResult = await createRateLimitedHouseholdInvitation(
    creationInput(now),
    createFakeExecutor(otherUserDatabase)
  );
  assert.equal(otherUserResult.status, "created");

  const otherHouseholdDatabase = createFakeDatabase();
  otherHouseholdDatabase.memberships.set(membershipKey("household-2", "user-1"), "ADMIN");
  for (let index = 0; index < 5; index += 1) {
    seedInvitation(otherHouseholdDatabase, {
      householdId: "household-1",
      createdAt: new Date(now.getTime() - (index + 1) * 5 * 60 * 1000)
    });
  }
  const otherHouseholdResult = await createRateLimitedHouseholdInvitation(
    creationInput(now, { householdId: "household-2" }),
    createFakeExecutor(otherHouseholdDatabase)
  );
  assert.equal(INVITATION_CREATION_RATE_SCOPE, "user");
  assert.deepEqual(otherHouseholdResult.status === "limited" ? otherHouseholdResult.code : null, "hourlyLimit");
});

test("同時リクエストでも1時間上限を超えて作成しない", async () => {
  const database = createFakeDatabase();
  const executor = createFakeExecutor(database);
  const now = new Date("2026-07-14T05:00:00.000Z");
  for (let index = 0; index < 4; index += 1) {
    seedInvitation(database, { createdAt: new Date(now.getTime() - (index + 1) * 5 * 60 * 1000) });
  }

  const results = await Promise.all([
    createRateLimitedHouseholdInvitation(creationInput(now), executor),
    createRateLimitedHouseholdInvitation(creationInput(now), executor)
  ]);

  assert.equal(results.filter((result) => result.status === "created").length, 1);
  assert.equal(results.filter((result) => result.status === "limited").length, 1);
  assert.equal(database.invitations.length, 5);
});

test("有効リンクが9件なら作成でき、10件になってHousehold revisionを更新する", async () => {
  const database = createFakeDatabase();
  const now = new Date("2026-07-14T05:30:00.000Z");
  for (let index = 0; index < MAX_ACTIVE_HOUSEHOLD_INVITATIONS - 1; index += 1) {
    seedInvitation(database, {
      createdByUserId: "seed-user",
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000 - index)
    });
  }

  const result = await createRateLimitedHouseholdInvitation(
    creationInput(now),
    createFakeExecutor(database)
  );

  assert.equal(result.status, "created");
  assert.equal(database.invitations.length, MAX_ACTIVE_HOUSEHOLD_INVITATIONS);
  assert.equal(database.revision, 1);
});

test("有効リンクが10件ならactiveLimitとなり、招待もrevisionも増やさない", async () => {
  const database = createFakeDatabase();
  const now = new Date("2026-07-14T05:40:00.000Z");
  for (let index = 0; index < MAX_ACTIVE_HOUSEHOLD_INVITATIONS; index += 1) {
    seedInvitation(database, {
      createdByUserId: "seed-user",
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000 - index)
    });
  }

  const result = await createRateLimitedHouseholdInvitation(
    creationInput(now),
    createFakeExecutor(database)
  );

  assert.equal(result.status, "activeLimit");
  assert.equal(database.invitations.length, MAX_ACTIVE_HOUSEHOLD_INVITATIONS);
  assert.equal(database.revision, 0);
});

test("有効リンクを1件無効化すると9件になり、新しいリンクを再作成できる", async () => {
  const database = createFakeDatabase();
  const executor = createFakeExecutor(database);
  const now = new Date("2026-07-14T05:45:00.000Z");
  const activeInvitations = Array.from(
    { length: MAX_ACTIVE_HOUSEHOLD_INVITATIONS },
    (_, index) =>
      seedInvitation(database, {
        createdByUserId: "seed-user",
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000 - index)
      })
  );

  const revoked = await revokeHouseholdInvitationMutation(
    {
      householdId: "household-1",
      actorUserId: "user-1",
      actorClientId: "client-1",
      invitationId: activeInvitations[0].id,
      now
    },
    executor
  );
  const activeAfterRevoke = database.invitations.filter(
    (invitation) =>
      invitation.householdId === "household-1" &&
      invitation.acceptedAt === null &&
      invitation.revokedAt === null &&
      invitation.expiresAt.getTime() > now.getTime()
  ).length;
  const created = await createRateLimitedHouseholdInvitation(creationInput(now), executor);

  assert.equal(revoked.status, "revoked");
  assert.equal(activeAfterRevoke, MAX_ACTIVE_HOUSEHOLD_INVITATIONS - 1);
  assert.equal(created.status, "created");
  assert.equal(database.revision, 2);
});

test("承認済み・無効化済み・期限切れ・別Householdのリンクは有効件数に含めない", async () => {
  const database = createFakeDatabase();
  const now = new Date("2026-07-14T05:50:00.000Z");
  for (let index = 0; index < MAX_ACTIVE_HOUSEHOLD_INVITATIONS - 1; index += 1) {
    seedInvitation(database, {
      createdByUserId: "seed-user",
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000 - index)
    });
  }
  seedInvitation(database, {
    createdByUserId: "seed-user",
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    acceptedAt: new Date(now.getTime() - 1)
  });
  seedInvitation(database, {
    createdByUserId: "seed-user",
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    revokedAt: new Date(now.getTime() - 1)
  });
  seedInvitation(database, {
    createdByUserId: "seed-user",
    createdAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
    expiresAt: now
  });
  seedInvitation(database, {
    householdId: "household-2",
    createdByUserId: "seed-user",
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000)
  });

  const result = await createRateLimitedHouseholdInvitation(
    creationInput(now),
    createFakeExecutor(database)
  );
  const activeInvitationCount = database.invitations.filter(
    (invitation) =>
      invitation.householdId === "household-1" &&
      invitation.acceptedAt === null &&
      invitation.revokedAt === null &&
      invitation.expiresAt.getTime() > now.getTime()
  ).length;

  assert.equal(result.status, "created");
  assert.equal(activeInvitationCount, MAX_ACTIVE_HOUSEHOLD_INVITATIONS);
  assert.equal(database.revision, 1);
});

test("同じHouseholdの異なる管理者が同時作成しても有効リンクは10件を超えない", async () => {
  const database = createFakeDatabase();
  database.memberships.set(membershipKey("household-1", "user-2"), "ADMIN");
  const executor = createFakeExecutor(database);
  const now = new Date("2026-07-14T05:55:00.000Z");
  for (let index = 0; index < MAX_ACTIVE_HOUSEHOLD_INVITATIONS - 1; index += 1) {
    seedInvitation(database, {
      createdByUserId: "seed-user",
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000 - index)
    });
  }

  const results = await Promise.all([
    createRateLimitedHouseholdInvitation(creationInput(now), executor),
    createRateLimitedHouseholdInvitation(
      creationInput(now, { actorUserId: "user-2", actorClientId: "client-2" }),
      executor
    )
  ]);
  const activeInvitationCount = database.invitations.filter(
    (invitation) =>
      invitation.householdId === "household-1" &&
      invitation.acceptedAt === null &&
      invitation.revokedAt === null &&
      invitation.expiresAt.getTime() > now.getTime()
  ).length;

  assert.equal(results.filter((result) => result.status === "created").length, 1);
  assert.equal(results.filter((result) => result.status === "activeLimit").length, 1);
  assert.equal(activeInvitationCount, MAX_ACTIVE_HOUSEHOLD_INVITATIONS);
  assert.equal(database.revision, 1);
});

test("本番DB実装はユーザー・Household単位で異なるPostgreSQL transaction lockを使用する", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/invitation-mutations.ts"), "utf8");
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$\{userId\}, 731491\)\)/);
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$\{householdId\}, 731492\)\)/);
  assert.ok(
    source.indexOf("lockInvitationCreationByUser(input.actorUserId)") <
      source.indexOf("lockInvitationCreationByHousehold(input.householdId)")
  );
  assert.match(source, /where:\s*{ createdByUserId: userId }/);
  assert.match(
    source,
    /where:\s*{\s*householdId,\s*acceptedAt: null,\s*revokedAt: null,\s*expiresAt: { gt: now }\s*}/
  );
});

test("共有画面は有効件数と上限を表示し、上限到達時の作成を無効化する", () => {
  const pageSource = readFileSync(join(process.cwd(), "src/app/(app)/settings/members/page.tsx"), "utf8");
  const formSource = readFileSync(
    join(process.cwd(), "src/components/household-invitation-form.tsx"),
    "utf8"
  );
  const actionSource = readFileSync(join(process.cwd(), "src/app/actions/members.ts"), "utf8");

  assert.match(pageSource, /activeInvitationCount=\{invitations\.length\}/);
  assert.match(pageSource, /maxActiveInvitations=\{MAX_ACTIVE_HOUSEHOLD_INVITATIONS\}/);
  assert.doesNotMatch(pageSource, /PaginationLayout|invitePage|skip:|take:/);
  assert.match(formSource, /import \{ Check, Copy, Link as LinkIcon, Plus, UserPlus \} from "lucide-react"/);
  assert.match(formSource, /<UserPlus className="mt-0\.5 h-5 w-5 shrink-0 text-moss" aria-hidden \/>/);
  assert.match(pageSource, /import \{ History, LogOut, Save, Settings2, UserPlus, Users \} from "lucide-react"/);
  assert.match(pageSource, /<UserPlus className="mt-0\.5 h-5 w-5 shrink-0 text-moss" aria-hidden \/>/);
  assert.match(formSource, /有効なリンク \{activeInvitationCount} \/ \{maxActiveInvitations}件/);
  assert.match(formSource, /const disabled = pending \|\| activeLimitReached \|\| cooldownActive;/);
  assert.match(formSource, /disabled=\{disabled\}/);
  assert.match(
    formSource,
    /aria-describedby=\{activeLimitReached \? activeLimitMessageId : cooldownActive \? cooldownMessageId : undefined\}/
  );
  assert.match(formSource, /const \[createdInviteUrl, setCreatedInviteUrl\] = useState<string \| null>\(null\);/);
  assert.match(formSource, /setCreatedInviteUrl\(nextInviteUrl\);/);
  assert.match(formSource, /\{state\.errorMessage \? \(/);
  assert.match(formSource, /\{createdInviteUrl \? \(/);
  assert.match(formSource, /setCooldownEndsAt\(Date\.now\(\) \+ nextState\.retryAfterSeconds \* 1000\);/);
  assert.match(formSource, /const timer = setInterval\(/);
  assert.match(formSource, /return \(\) => clearInterval\(timer\);/);
  assert.match(formSource, /不要な招待リンクを無効化すると、新しいリンクを作成できます。/);
  assert.match(actionSource, /errorCode: "activeLimit"/);
  assert.match(actionSource, /INVITATION_CREATION_COOLDOWN_MS/);
  assert.match(actionSource, /retryAfterSeconds: Math\.ceil\(INVITATION_CREATION_COOLDOWN_MS \/ 1000\)/);
  assert.match(
    actionSource,
    /有効な招待リンクが上限の\$\{MAX_ACTIVE_HOUSEHOLD_INVITATIONS}件に達しています。/
  );
});

test("未使用かつ有効なリンクだけ無効化できる", async () => {
  const now = new Date("2026-07-14T06:00:00.000Z");
  const database = createFakeDatabase();
  const active = seedInvitation(database, { createdAt: new Date(now.getTime() - 60_000) });
  const result = await revokeHouseholdInvitationMutation(
    {
      householdId: "household-1",
      actorUserId: "user-1",
      actorClientId: "client-1",
      invitationId: active.id,
      now
    },
    createFakeExecutor(database)
  );

  assert.equal(result.status, "revoked");
  assert.equal(active.revokedAt?.toISOString(), now.toISOString());
});

test("使用済み・期限切れ・無効化済みリンクは無効化できず、無効化済みリンクは参加できない", async () => {
  const now = new Date("2026-07-14T07:00:00.000Z");
  for (const [expected, fields] of [
    ["accepted", { acceptedAt: new Date(now.getTime() - 1) }],
    ["expired", { expiresAt: now }],
    ["alreadyRevoked", { revokedAt: new Date(now.getTime() - 1) }]
  ] as const) {
    const database = createFakeDatabase();
    const invitation = seedInvitation(database, {
      createdAt: new Date(now.getTime() - 60_000),
      ...fields
    });
    const result = await revokeHouseholdInvitationMutation(
      {
        householdId: "household-1",
        actorUserId: "user-1",
        actorClientId: null,
        invitationId: invitation.id,
        now
      },
      createFakeExecutor(database)
    );
    assert.equal(result.status, expected);
  }

  assert.equal(
    invitationAcceptanceFailure(
      { acceptedAt: null, revokedAt: new Date(now.getTime() - 1), expiresAt: new Date(now.getTime() + 60_000) },
      now
    ),
    "revoked"
  );
});

test("OWNERとADMINだけが作成・無効化できる", async () => {
  const now = new Date("2026-07-14T08:00:00.000Z");
  for (const role of ["MEMBER", "VIEWER"] as const) {
    const database = createFakeDatabase();
    database.memberships.set(membershipKey("household-1", "user-1"), role);
    const invitation = seedInvitation(database, { createdAt: new Date(now.getTime() - 60_000) });
    assert.equal(
      (await createRateLimitedHouseholdInvitation(creationInput(now), createFakeExecutor(database))).status,
      "forbidden"
    );
    assert.equal(
      (
        await revokeHouseholdInvitationMutation(
          {
            householdId: "household-1",
            actorUserId: "user-1",
            actorClientId: null,
            invitationId: invitation.id,
            now
          },
          createFakeExecutor(database)
        )
      ).status,
      "forbidden"
    );
  }

  const adminDatabase = createFakeDatabase();
  adminDatabase.memberships.set(membershipKey("household-1", "user-1"), "ADMIN");
  const adminInvitation = seedInvitation(adminDatabase, {
    createdAt: new Date(now.getTime() - 60_000)
  });
  const adminExecutor = createFakeExecutor(adminDatabase);
  assert.equal(
    (await createRateLimitedHouseholdInvitation(creationInput(now), adminExecutor)).status,
    "created"
  );
  assert.equal(
    (
      await revokeHouseholdInvitationMutation(
        {
          householdId: "household-1",
          actorUserId: "user-1",
          actorClientId: null,
          invitationId: adminInvitation.id,
          now
        },
        adminExecutor
      )
    ).status,
    "revoked"
  );
});
