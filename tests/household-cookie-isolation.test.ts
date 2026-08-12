import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CURRENT_HOUSEHOLD_COOKIE } from "../src/lib/auth-context";
import { DOG_CAT_AUTH_SESSION_COOKIE_NAMES } from "../src/lib/auth-cookies";

const LEGACY_HAMSTER_HOUSEHOLD_COOKIE = "hamster_current_household";

test("現在HouseholdのCookie名はDog-Cat専用名称である", () => {
  assert.equal(CURRENT_HOUSEHOLD_COOKIE, "dog_cat_manager_current_household");
  assert.notEqual(CURRENT_HOUSEHOLD_COOKIE, LEGACY_HAMSTER_HOUSEHOLD_COOKIE);
});

test("現在Householdの取得・設定・削除はDog-Cat専用Cookie定数だけを使用する", async () => {
  const authContextSource = await readFile("src/lib/auth-context.ts", "utf8");

  assert.match(
    authContextSource,
    /cookieStore\.get\(CURRENT_HOUSEHOLD_COOKIE\)\?\.value/
  );
  assert.match(
    authContextSource,
    /cookieStore\.set\(CURRENT_HOUSEHOLD_COOKIE, householdId, \{[\s\S]*?httpOnly: true,[\s\S]*?sameSite: "lax",[\s\S]*?path: "\/",[\s\S]*?maxAge: 60 \* 60 \* 24 \* 365[\s\S]*?\}\);/
  );
  assert.match(authContextSource, /cookieStore\.delete\(CURRENT_HOUSEHOLD_COOKIE\)/);
  assert.doesNotMatch(authContextSource, /hamster_current_household/);
});

test("Household切替は認可確認後に共通のDog-Cat専用Cookie設定処理を使う", async () => {
  const actionSource = await readFile("src/app/actions/households.ts", "utf8");

  assert.match(actionSource, /where: \{ householdId, userId: user\.id \}/);
  assert.match(actionSource, /if \(!membership\) redirect\(redirectTo\)/);
  assert.match(actionSource, /await setCurrentHouseholdCookie\(householdId\)/);
  assert.doesNotMatch(actionSource, /hamster_current_household/);
});

test("アカウント削除はDog-Cat専用Household Cookieと専用Auth.js Cookieだけを対象にする", async () => {
  const authContextSource = await readFile("src/lib/auth-context.ts", "utf8");

  assert.match(authContextSource, /cookieStore\.delete\(CURRENT_HOUSEHOLD_COOKIE\)/);
  assert.match(authContextSource, /DOG_CAT_AUTH_SESSION_COOKIE_NAMES/);
  assert.ok(
    DOG_CAT_AUTH_SESSION_COOKIE_NAMES.every((name) => name.includes("dog-cat-manager.authjs"))
  );
  assert.doesNotMatch(authContextSource, /hamster_current_household/);
});
