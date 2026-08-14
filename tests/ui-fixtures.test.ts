import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCurrentDatabaseName,
  assertSpeciesCareRules,
  assertUiFixtureDatabaseUrl,
  assertUniqueWeightDates,
  isOwnedFixtureContactPublicId,
  isOwnedFixtureHouseholdId,
  isOwnedFixtureUserId,
  selectTargetUser,
  UI_FIXTURE_ADMIN_HOUSEHOLD_IDS,
  UI_FIXTURE_ADMIN_USER_IDS,
  UI_FIXTURE_CONTACT_PUBLIC_IDS,
  UI_FIXTURE_HOUSEHOLD_ID,
  UI_FIXTURE_MEMBER_USER_IDS
} from "../prisma/ui-fixture-logic";

const candidate = {
  id: "real-user",
  name: "利用者",
  email: "user@example.invalid",
  appRole: "USER" as const,
  accessStatus: "ACTIVE" as const
};

test("UI fixtureはdevelopment DBだけを許可する", () => {
  assert.equal(
    assertUiFixtureDatabaseUrl("postgresql://user:secret@localhost:5434/dog_cat_manager_dev?schema=public"),
    "dog_cat_manager_dev"
  );
  assert.throws(() => assertUiFixtureDatabaseUrl("postgresql://user:secret@localhost/production"));
  assert.throws(() => assertCurrentDatabaseName("dog_cat_manager"));
});

test("対象ユーザーを推測せず、一意または明示指定だけを許可する", () => {
  assert.equal(selectTargetUser([candidate]).id, candidate.id);
  assert.equal(selectTargetUser([candidate, { ...candidate, id: "other" }], "other").id, "other");
  assert.throws(() => selectTargetUser([]));
  assert.throws(() => selectTargetUser([candidate, { ...candidate, id: "other" }]));
  assert.throws(() => selectTargetUser([candidate], "missing"));
});

test("cleanup識別は列挙したfixture identifierだけに一致する", () => {
  assert.equal(isOwnedFixtureHouseholdId(UI_FIXTURE_HOUSEHOLD_ID), true);
  assert.equal(isOwnedFixtureHouseholdId(UI_FIXTURE_ADMIN_HOUSEHOLD_IDS[0]), true);
  assert.equal(isOwnedFixtureUserId(UI_FIXTURE_MEMBER_USER_IDS[0]), true);
  assert.equal(isOwnedFixtureUserId(UI_FIXTURE_ADMIN_USER_IDS[0]), true);
  assert.equal(isOwnedFixtureContactPublicId(UI_FIXTURE_CONTACT_PUBLIC_IDS[0]), true);
  assert.equal(isOwnedFixtureHouseholdId("UI_FIXTURE_LIKE_BUT_NOT_OWNED"), false);
  assert.equal(isOwnedFixtureUserId("real-user"), false);
  assert.equal(isOwnedFixtureContactPublicId("DCM-20260814-AAAAAAAAAA"), false);
});

test("fixture identifierは再実行しても決定的で重複しない", () => {
  const ids = [
    UI_FIXTURE_HOUSEHOLD_ID,
    ...UI_FIXTURE_ADMIN_HOUSEHOLD_IDS,
    ...UI_FIXTURE_MEMBER_USER_IDS,
    ...UI_FIXTURE_ADMIN_USER_IDS,
    ...UI_FIXTURE_CONTACT_PUBLIC_IDS
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test("DOG WalkとCAT Litterだけを許可する", () => {
  assert.doesNotThrow(() =>
    assertSpeciesCareRules([{ petId: "dog", species: "DOG" }], [{ petId: "cat", species: "CAT" }])
  );
  assert.throws(() =>
    assertSpeciesCareRules([{ petId: "cat", species: "CAT" }], [])
  );
  assert.throws(() =>
    assertSpeciesCareRules([], [{ petId: "dog", species: "DOG" }])
  );
});

test("同一Pet・同一recordDateのWeight重複を拒否する", () => {
  const date = new Date("2026-08-14T00:00:00.000Z");
  assert.doesNotThrow(() => assertUniqueWeightDates([
    { petId: "dog", recordDate: date },
    { petId: "cat", recordDate: date }
  ]));
  assert.throws(() => assertUniqueWeightDates([
    { petId: "dog", recordDate: date },
    { petId: "dog", recordDate: new Date(date) }
  ]));
});
