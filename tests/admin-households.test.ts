import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getAdminHouseholdPage } from "../src/lib/admin-households";
import { normalizeAdminPage } from "../src/lib/admin-pagination";
import { getPaginationItems } from "../src/lib/pagination";

test("管理一覧のページ番号は先頭・中間・末尾を省略記号付きで組み立てる", () => {
  assert.deepEqual(getPaginationItems(1, 10), [1, 2, 3, "ellipsis", 10]);
  assert.deepEqual(getPaginationItems(5, 10), [1, "ellipsis", 4, 5, 6, "ellipsis", 10]);
  assert.deepEqual(getPaginationItems(10, 10), [1, "ellipsis", 8, 9, 10]);
  assert.deepEqual(getPaginationItems(1, 1), [1]);
  assert.deepEqual(getPaginationItems(4, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test("共有管理ページ番号は不正値を安全に1へ正規化する", () => {
  for (const value of [undefined, "", "0", "-2", "2.5", "not-a-page"]) {
    assert.equal(normalizeAdminPage(value), 1);
  }
});

test("共有一覧はcount後に範囲外ページを補正しページ内20件だけDB取得する", async () => {
  let findManyArgs: Record<string, unknown> | undefined;
  const result = await getAdminHouseholdPage(999, {
    count: async () => 41,
    findMany: async (args) => {
      findManyArgs = args;
      return [];
    }
  });

  assert.deepEqual(result.pagination, { currentPage: 3, totalPages: 3, totalCount: 41, pageSize: 20 });
  assert.equal(findManyArgs?.skip, 40);
  assert.equal(findManyArgs?.take, 20);
  assert.deepEqual(findManyArgs?.where, { isDemo: false });
  assert.deepEqual(findManyArgs?.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  const select = findManyArgs?.select as { members?: unknown } | undefined;
  assert.ok(select?.members, "ページ内共有と同じfindManyで必要なメンバーだけを取得する");
});

test("共有0件は1ページ目の空状態として扱う", async () => {
  const result = await getAdminHouseholdPage(5, {
    count: async () => 0,
    findMany: async ({ skip, take }) => {
      assert.equal(skip, 0);
      assert.equal(take, 20);
      return [];
    }
  });

  assert.equal(result.pagination.currentPage, 1);
  assert.equal(result.pagination.totalPages, 1);
  assert.equal(result.pagination.totalCount, 0);
});

test("共有管理画面は管理者認可、共有カード、共通ページングを備える", async () => {
  const pageSource = await readFile("src/app/(app)/admin/households/page.tsx", "utf8");
  const overviewSource = await readFile("src/app/(app)/admin/page.tsx", "utf8");
  const listSource = await readFile("src/components/admin-household-list.tsx", "utf8");
  const paginationSource = await readFile("src/components/pagination.tsx", "utf8");

  assert.match(pageSource, /getRequiredAppAdminUser\(\)/);
  assert.match(pageSource, /getAdminHouseholdPage\(normalizeAdminPage\(params\.page\)\)/);
  assert.match(pageSource, /管理トップへ戻る/);
  assert.match(overviewSource, /household\.count\(\{\s*where:\s*\{\s*isDemo:\s*false/);
  assert.match(overviewSource, /household\.findMany\(\{\s*where:\s*\{\s*isDemo:\s*false/);
  assert.match(listSource, /household\._count\.members/);
  assert.match(listSource, /household\._count\.hamsters/);
  assert.match(listSource, /household\._count\.invitations/);
  assert.match(listSource, /HOUSEHOLD_ROLE_LABELS\[member\.role\]/);
  assert.match(listSource, /\[overflow-wrap:anywhere\]/);

  assert.doesNotMatch(paginationSource, /最初へ|最後へ/);
  assert.match(paginationSource, /aria-current="page"/);
  assert.match(paginationSource, /aria-disabled="true"/);
  assert.match(paginationSource, /disabled/);
  assert.match(paginationSource, /focus-visible:ring-2/);
  assert.match(paginationSource, /className="grid min-w-0 grid-cols-3 items-center gap-1 sm:hidden"/);
  assert.match(paginationSource, /className="hidden items-center gap-0\.5 sm:flex"/);
  assert.match(paginationSource, /pagination\.totalCount > 0/);
});
