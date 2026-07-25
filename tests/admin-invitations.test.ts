import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADMIN_INVITATION_PAGE_SIZE,
  ADMIN_INVITATION_SEARCH_MAX_LENGTH,
  buildActiveInvitationWhere,
  buildAdminInvitationHref,
  buildAdminInvitationOrderBy,
  buildAdminInvitationWhere,
  findMatchingAdminInvitationHouseholdIds,
  getActiveInvitationCount,
  getAdminInvitationPage,
  normalizeAdminInvitationPage,
  normalizeAdminInvitationSearch,
  parseAdminInvitationQuery,
  type AdminInvitationQuery,
  type AdminInvitationStatusFilter
} from "../src/lib/admin-invitations";
import { getHouseholdInvitationStatus, getInvitationCreatorDisplayName } from "../src/lib/invitations";

const now = new Date("2026-07-15T00:00:00.000Z");

function query(overrides: Partial<AdminInvitationQuery> = {}): AdminInvitationQuery {
  return {
    status: "all",
    search: "",
    sort: "created-desc",
    page: 1,
    ...overrides
  };
}

test("招待状態ごとに既存の判定優先順位と一致するDB条件を作る", () => {
  const expectedByStatus: Record<AdminInvitationStatusFilter, object> = {
    all: {},
    active: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    accepted: { acceptedAt: { not: null }, revokedAt: null },
    expired: { acceptedAt: null, revokedAt: null, expiresAt: { lte: now } },
    revoked: { revokedAt: { not: null } }
  };

  for (const status of ["all", "active", "accepted", "expired", "revoked"] as const) {
    assert.deepEqual(buildAdminInvitationWhere(query({ status }), now), expectedByStatus[status]);
  }

  assert.equal(
    getHouseholdInvitationStatus({ acceptedAt: now, revokedAt: now, expiresAt: now }, now),
    "revoked"
  );
});

test("共有名は前後空白・NFKC・かなの表記差を吸収して候補のHousehold IDへ解決する", () => {
  assert.equal(normalizeAdminInvitationSearch("  林家  "), "林家");
  assert.equal(normalizeAdminInvitationSearch(" ＡＢＣ "), "ABC");
  assert.equal(
    normalizeAdminInvitationSearch("あ".repeat(ADMIN_INVITATION_SEARCH_MAX_LENGTH + 10)).length,
    ADMIN_INVITATION_SEARCH_MAX_LENGTH
  );
  const households = [
    { id: "hiragana", name: "はむすたー家" },
    { id: "katakana", name: "ハムスター病院" },
    { id: "other", name: "林家" }
  ];
  assert.deepEqual(findMatchingAdminInvitationHouseholdIds(" ハム ", households), [
    "hiragana",
    "katakana"
  ]);
  assert.deepEqual(findMatchingAdminInvitationHouseholdIds("はむ", households), [
    "hiragana",
    "katakana"
  ]);
  assert.deepEqual(buildAdminInvitationWhere(query({ search: "はむ" }), now, ["hiragana", "katakana"]), {
    householdId: { in: ["hiragana", "katakana"] }
  });
  assert.deepEqual(buildAdminInvitationWhere(query({ search: "該当なし" }), now, []), {
    householdId: { in: [] }
  });
  assert.deepEqual(buildAdminInvitationWhere(query({ search: "" }), now), {});
});

test("各並び順に安定したidの第2ソート条件を付ける", () => {
  assert.deepEqual(buildAdminInvitationOrderBy("created-desc"), [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(buildAdminInvitationOrderBy("created-asc"), [{ createdAt: "asc" }, { id: "asc" }]);
  assert.deepEqual(buildAdminInvitationOrderBy("expires-asc"), [{ expiresAt: "asc" }, { id: "asc" }]);
  assert.deepEqual(buildAdminInvitationOrderBy("expires-desc"), [{ expiresAt: "desc" }, { id: "desc" }]);
});

test("不正な状態・並び順・ページ番号は初期値へ戻す", () => {
  assert.deepEqual(
    parseAdminInvitationQuery({
      inviteStatus: "unexpected",
      inviteSort: "unexpected",
      invitePage: "not-a-number"
    }),
    query()
  );
  assert.equal(normalizeAdminInvitationPage(undefined), 1);
  assert.equal(normalizeAdminInvitationPage("0"), 1);
  assert.equal(normalizeAdminInvitationPage("-1"), 1);
  assert.equal(normalizeAdminInvitationPage("1.5"), 1);
  assert.equal(normalizeAdminInvitationPage("999999999999999999999"), 1);
});

test("一覧とcountは同じwhereを使い、範囲外ページを補正して20件単位で取得する", async () => {
  const seenWhere: unknown[] = [];
  let skip = -1;
  let take = -1;
  const result = await getAdminInvitationPage(query({ status: "active", page: 99 }), now, [], {
    count: async ({ where }) => {
      seenWhere.push(where);
      return 45;
    },
    findMany: async (args) => {
      seenWhere.push(args.where);
      skip = args.skip;
      take = args.take;
      return [];
    }
  });

  assert.equal(ADMIN_INVITATION_PAGE_SIZE, 20);
  assert.strictEqual(seenWhere[0], seenWhere[1]);
  assert.equal(result.pagination.currentPage, 3);
  assert.equal(result.pagination.totalPages, 3);
  assert.equal(skip, 40);
  assert.equal(take, 20);
});

test("0件でもページ計算を1ページとして安全に扱う", async () => {
  const result = await getAdminInvitationPage(query({ page: 10 }), now, [], {
    count: async () => 0,
    findMany: async ({ skip, take }) => {
      assert.equal(skip, 0);
      assert.equal(take, 20);
      return [];
    }
  });

  assert.deepEqual(result.pagination, { currentPage: 1, totalPages: 1, totalCount: 0, pageSize: 20 });
});

test("作成者表示は表示名、メールアドレス、既存データ用文言の順でフォールバックする", () => {
  assert.equal(
    getInvitationCreatorDisplayName({ createdBy: { name: "林", email: "hayashi@example.com" } }),
    "林"
  );
  assert.equal(
    getInvitationCreatorDisplayName({ createdBy: { name: null, email: "hayashi@example.com" } }),
    "hayashi@example.com"
  );
  assert.equal(getInvitationCreatorDisplayName({ createdBy: null }), "不明（既存データ）");
});

test("ページ移動URLは招待条件だけを維持し、安全にエンコードする", () => {
  const href = buildAdminInvitationHref(
    query({ status: "expired", search: "林 家", sort: "expires-asc", page: 2 }),
    3
  );
  const url = new URL(href, "https://hamster.example");

  assert.equal(url.pathname, "/admin");
  assert.equal(url.searchParams.get("inviteStatus"), "expired");
  assert.equal(url.searchParams.get("inviteSearch"), "林 家");
  assert.equal(url.searchParams.get("inviteSort"), "expires-asc");
  assert.equal(url.searchParams.get("invitePage"), "3");
  assert.equal(url.searchParams.has("status"), false);
  assert.equal(url.searchParams.has("errorId"), false);
});

test("フィルタフォームは適用時に1ページ目へ戻す", async () => {
  const source = await readFile("src/app/(app)/admin/page.tsx", "utf8");
  assert.match(source, /<input type="hidden" name="invitePage" value="1" \/>/);
});

test("招待一覧フィルターは変更時に自動適用し、手動の絞り込みボタンを表示しない", async () => {
  const pageSource = await readFile("src/app/(app)/admin/page.tsx", "utf8");
  const formSource = await readFile("src/components/auto-submit-filter-form.tsx", "utf8");
  assert.match(pageSource, /<AutoSubmitFilterForm[\s\S]*?action="\/admin"/);
  assert.doesNotMatch(pageSource, />絞り込む<\/button>/);
  assert.match(formSource, /scroll=\{false\}/);
  assert.match(formSource, /setTimeout\(\(\) => form\.requestSubmit\(\), debounceMs\)/);
});

test("共有名フィルターは入力候補付きコンボボックスを使う", async () => {
  const pageSource = await readFile("src/app/(app)/admin/page.tsx", "utf8");
  const comboboxSource = await readFile("src/components/admin-invitation-household-combobox.tsx", "utf8");
  assert.match(pageSource, /<AdminInvitationHouseholdCombobox/);
  assert.match(comboboxSource, /normalizeSearchText\(inputValue\)/);
  assert.match(comboboxSource, /normalizeSearchText\(option\.name\)\.includes\(normalizedInput\)/);
  assert.match(comboboxSource, /role="combobox"/);
  assert.match(comboboxSource, /role="listbox"/);
});

test("招待一覧の絞り込み・クリア・ページ移動はスクロール位置を維持する", async () => {
  const source = await readFile("src/app/(app)/admin/page.tsx", "utf8");
  const paginationSource = await readFile("src/components/admin-invitation-pagination.tsx", "utf8");
  const sharedPaginationSource = await readFile("src/components/pagination.tsx", "utf8");
  const formSource = await readFile("src/components/auto-submit-filter-form.tsx", "utf8");
  assert.match(source, /<AutoSubmitFilterForm[\s\S]*?action="\/admin"/);
  assert.match(formSource, /scroll=\{false\}/);
  assert.match(source, /href="\/admin"[\s\S]*?scroll=\{false\}/);
  assert.match(paginationSource, /buildHref=\{\(page\) => buildAdminInvitationHref\(query, page\)\}/);
  assert.match(paginationSource, /scroll=\{false\}/);
  assert.match(sharedPaginationSource, /href=\{buildHref\(currentPage - 1\)\}/);
  assert.match(sharedPaginationSource, /href=\{buildHref\(item\)\}/);
  assert.match(sharedPaginationSource, /href=\{buildHref\(currentPage \+ 1\)\}/);
  assert.equal(source.match(/<AdminInvitationPagination/g)?.length, 2);
  assert.equal(source.match(/visibleCount=\{invitations\.length\}/g)?.length, 2);
});

test("招待一覧は件数サマリーと共通ページングを一覧の上下に表示する", async () => {
  const source = await readFile("src/app/(app)/admin/page.tsx", "utf8");
  const paginationSource = await readFile("src/components/admin-invitation-pagination.tsx", "utf8");
  const sharedPaginationSource = await readFile("src/components/pagination.tsx", "utf8");

  assert.match(
    source,
    /<AdminInvitationPagination[\s\S]*?visibleCount=\{invitations\.length\}[\s\S]*?hidden overflow-x-auto/
  );
  assert.match(paginationSource, /<PaginationLayout/);
  assert.match(sharedPaginationSource, /全\{pagination\.totalCount\}件中/);
  assert.doesNotMatch(source, /firstVisibleNumber|lastVisibleNumber/);
});

test("管理一覧はlg未満で全項目を持つカード表示へ切り替える", async () => {
  const source = await readFile("src/app/(app)/admin/page.tsx", "utf8");
  const userListSource = await readFile("src/components/admin-user-list.tsx", "utf8");

  assert.equal(source.match(/hidden overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm lg:block/g)?.length, 1);
  assert.equal(source.match(/className="grid gap-3 lg:hidden"/g)?.length, 1);
  assert.match(userListSource, /hidden overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm lg:block/);
  assert.match(userListSource, /className="grid gap-3 lg:hidden"/);

  for (const label of ["名前", "メールアドレス", "アプリ全体権限", "所属共有数", "セッション数", "作成日"]) {
    assert.equal(userListSource.match(new RegExp(`>${label}<`, "g"))?.length, 1);
  }
  for (const label of ["共有", "状態", "作成者", "作成日時", "有効期限", "使用日時"]) {
    assert.equal(source.match(new RegExp(`>${label}<`, "g"))?.length, 2);
  }

  assert.match(userListSource, /\[overflow-wrap:anywhere\]/);
  assert.match(userListSource, /sm:w-auto/);
});

test("有効招待数は一覧のtakeに依存しない独立countで取得する", async () => {
  let countArgs: unknown;
  const count = await getActiveInvitationCount(now, {
    count: async (args) => {
      countArgs = args;
      return 137;
    }
  });

  assert.equal(count, 137);
  assert.deepEqual(countArgs, { where: buildActiveInvitationWhere(now) });
});
