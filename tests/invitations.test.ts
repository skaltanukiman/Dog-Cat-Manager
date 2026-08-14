import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildHouseholdInvitationPreview,
  buildInvitationUrl,
  createInvitationToken,
  getInvitationTokenFromHash,
  invitationAcceptanceFailure,
  MAX_ACTIVE_HOUSEHOLD_INVITATIONS
} from "../src/lib/invitations";

const projectRoot = process.cwd();

test("Household内の有効な招待リンク上限は10件", () => {
  assert.equal(MAX_ACTIVE_HOUSEHOLD_INVITATIONS, 10);
});

test("招待トークンはクエリではなくURLフラグメントへ格納する", () => {
  const token = createInvitationToken();
  const inviteUrl = new URL(buildInvitationUrl("https://dog-cat.example", token));

  assert.equal(inviteUrl.pathname, "/invitations/accept");
  assert.equal(inviteUrl.search, "");
  assert.equal(inviteUrl.hash.startsWith("#token="), true);
  assert.equal(getInvitationTokenFromHash(inviteUrl.hash), token);
});

test("不正な招待トークンはURLフラグメントから受け取らない", () => {
  assert.equal(getInvitationTokenFromHash(""), null);
  assert.equal(getInvitationTokenFromHash("#token=short"), null);
  assert.equal(getInvitationTokenFromHash("#token=invalid%20token"), null);
});

test("有効な招待は参加でき、使用済み・期限切れ・無効化済みを区別する", () => {
  const now = new Date("2026-07-14T00:00:00.000Z");
  const active = { acceptedAt: null, revokedAt: null, expiresAt: new Date(now.getTime() + 1) };

  assert.equal(invitationAcceptanceFailure(active, now), null);
  assert.equal(invitationAcceptanceFailure({ ...active, acceptedAt: now }, now), "accepted");
  assert.equal(invitationAcceptanceFailure({ ...active, expiresAt: now }, now), "expired");
  assert.equal(invitationAcceptanceFailure({ ...active, revokedAt: now }, now), "revoked");
});

test("有効な招待だけ共有グループ名をプレビューできる", () => {
  const now = new Date("2026-07-20T00:00:00.000Z");
  const active = {
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date(now.getTime() + 1),
    household: { name: "ゴールデンハムスター組" }
  };

  assert.deepEqual(buildHouseholdInvitationPreview(active, now), {
    status: "available",
    householdName: "ゴールデンハムスター組"
  });
  assert.deepEqual(buildHouseholdInvitationPreview(null, now), { status: "invalid" });
  assert.deepEqual(buildHouseholdInvitationPreview({ ...active, acceptedAt: now }, now), {
    status: "accepted"
  });
  assert.deepEqual(buildHouseholdInvitationPreview({ ...active, expiresAt: now }, now), {
    status: "expired"
  });
  assert.deepEqual(buildHouseholdInvitationPreview({ ...active, revokedAt: now }, now), {
    status: "revoked"
  });
});

test("参加画面はトークンをURLへ戻さず、招待先の共有グループ名を強調表示する", () => {
  const formSource = readFileSync(join(projectRoot, "src/components/invitation-accept-form.tsx"), "utf8");
  const actionSource = readFileSync(join(projectRoot, "src/app/actions/members.ts"), "utf8");

  assert.match(formSource, /getHouseholdInvitationPreview\(token\)/);
  assert.match(formSource, /招待された共有グループ/);
  assert.match(formSource, /\{preview\.householdName\}/);
  assert.match(formSource, /border-brand\/30 bg-brand\/10/);
  assert.doesNotMatch(formSource, /dangerouslySetInnerHTML/);
  assert.match(actionSource, /where: \{ tokenHash: hashInvitationToken\(token\) \}/);
  assert.match(actionSource, /household:\s*\{\s*select: \{ name: true \}/);
  assert.doesNotMatch(actionSource, /members\.getInvitationPreview[\s\S]{0,200}token/);

  const statusMessageSource = readFileSync(join(projectRoot, "src/components/status-message.tsx"), "utf8");
  assert.match(statusMessageSource, /この招待リンクは無効になっています。招待した方に、新しい招待リンクの発行を依頼してください。/);
  assert.match(formSource, /招待トークンが見つかりません。/);
  assert.doesNotMatch(formSource, /招待トークンが見つかりません。共有画面で新しい招待リンクを作成してください。/);
});
