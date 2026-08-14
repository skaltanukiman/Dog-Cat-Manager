import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function source(path: string) {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

function sourceFilesUnder(path: string): string[] {
  const absolutePath = join(repositoryRoot, path);
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(child);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [child] : [];
  });
}

test("現行 Prisma schema は Pet domain と共有基盤だけを保持する", () => {
  const schema = source("prisma/schema.prisma");

  for (const model of [
    "Hamster",
    "CleaningRecord",
    "FeedingRecord",
    "WaterReplacementRecord",
    "WeightRecord",
    "DashboardHamster",
    "HamsterRecord",
    "HealthRecordDetail",
    "MedicalVisitDetail",
    "MemoryRecordDetail",
    "MemoryRecordHamster",
    "MemoryRecordImage",
    "WebPushSubscription",
    "CareNotificationDispatch"
  ]) {
    assert.doesNotMatch(schema, new RegExp(`^model ${model}\\b`, "m"));
  }
  assert.doesNotMatch(schema, /^enum (?:HamsterRecordType|CareNotificationDispatchStatus)\b/m);

  for (const shared of [
    /^model Pet\b/m,
    /^model DashboardPet\b/m,
    /^model SavedMemoryTag\b/m,
    /^enum HealthOverallCondition\b/m,
    /^enum HealthAmountCondition\b/m,
    /^enum HealthExcretionCondition\b/m,
    /^enum HealthSymptom\b/m,
    /careDayStartMinutes/,
    /isDemo/
  ]) {
    assert.match(schema, shared);
  }
});

test("remove migration は legacy data を検査してから旧構造だけを削除する", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source(
    "prisma/migrations/20260814090000_remove_hamster_legacy/migration.sql"
  );

  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /FOREACH legacy_table IN ARRAY/);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /FROM "household_activities"/);
  assert.match(migration, /"event_type"::TEXT = ANY/);
  assert.match(migration, /ALTER COLUMN "event_type" TYPE TEXT/);
  assert.match(migration, /CREATE TYPE "HouseholdActivityEvent" AS ENUM/);
  assert.match(migration, /COMMIT;\s*$/);

  const schemaEvents = schema.match(/enum HouseholdActivityEvent \{([\s\S]*?)\n\}/)?.[1]
    .match(/^\s+([A-Z_]+)\s*$/gm)
    ?.map((value) => value.trim());
  const migratedEventBlock = migration.match(
    /CREATE TYPE "HouseholdActivityEvent" AS ENUM \(([\s\S]*?)\);/
  )?.[1];
  const migratedEvents = [...(migratedEventBlock ?? "").matchAll(/'([A-Z_]+)'/g)]
    .map((match) => match[1]);
  assert.deepEqual(migratedEvents, schemaEvents);

  for (const event of [
    "HAMSTER_CREATED",
    "HAMSTER_DELETED",
    "WEIGHT_CREATED",
    "WEIGHT_UPDATED",
    "WEIGHT_DELETED",
    "WEIGHTS_BULK_DELETED",
    "WEIGHT_CSV_APP_IMPORTED",
    "WEIGHT_CSV_GAS_IMPORTED",
    "CLEANING_MONTH_SAVED",
    "HEALTH_RECORD_CREATED",
    "HEALTH_RECORD_UPDATED",
    "HEALTH_RECORD_DELETED",
    "MEDICAL_RECORD_CREATED",
    "MEDICAL_RECORD_UPDATED",
    "MEDICAL_RECORD_DELETED",
    "MEMORY_RECORD_CREATED",
    "MEMORY_RECORD_UPDATED",
    "MEMORY_RECORD_DELETED",
    "HAMSTER_PROFILE_IMAGE_UPDATED",
    "HAMSTER_ACTIVE_STATUS_UPDATED",
    "FEEDING_MARKED",
    "FEEDING_UNMARKED",
    "WATER_REPLACEMENT_MARKED",
    "WATER_REPLACEMENT_UNMARKED"
  ]) {
    assert.match(migration, new RegExp(`'${event}'`));
    assert.doesNotMatch(migratedEventBlock ?? "", new RegExp(`'${event}'`));
  }

  for (const table of [
    "hamsters",
    "cleaning_records",
    "feeding_records",
    "water_replacement_records",
    "weight_records",
    "dashboard_hamsters",
    "hamster_records",
    "health_record_details",
    "medical_visit_details",
    "memory_record_details",
    "memory_record_hamsters",
    "memory_record_images",
    "web_push_subscriptions",
    "care_notification_dispatches"
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
    assert.match(migration, new RegExp(`DROP TABLE "${table}"`));
  }

  for (const column of [
    "hamsterSelectorMode",
    "recordTimelineDefaultScope",
    "cleaningMobileDefaultDateFilter",
    "feedingNotificationEnabled",
    "feedingDeadlineMinutes",
    "feedingNotifyBeforeMinutes",
    "waterNotificationEnabled",
    "waterDeadlineMinutes",
    "waterNotifyBeforeMinutes",
    "careNotificationCompactBody"
  ]) {
    assert.match(migration, new RegExp(`DROP COLUMN "${column}"`));
  }
  assert.match(migration, /ALTER TABLE "households" DROP COLUMN "demo_slug"/);

  assert.doesNotMatch(migration, /\b(?:DELETE\s+FROM|TRUNCATE)\b/i);
  assert.doesNotMatch(migration, /DROP TABLE "(?:pets|pet_[^"]+|dashboard_pets|saved_memory_tags)"/i);
  assert.doesNotMatch(
    migration,
    /DROP TYPE "(?:HealthOverallCondition|HealthAmountCondition|HealthExcretionCondition|HealthSymptom)"/
  );
  assert.doesNotMatch(migration, /DROP EXTENSION/i);
});

test("旧 route・API・runtime access・環境設定は復活していない", () => {
  for (const removedPath of [
    "src/app/(app)/hamsters/page.tsx",
    "src/app/(app)/cleaning/page.tsx",
    "src/app/(app)/export/page.tsx",
    "src/app/api/device/care/route.ts",
    "src/app/api/hamsters/[id]/image/route.ts",
    "src/app/api/records/[id]/image/route.ts",
    "src/app/demo/page.tsx",
    "scripts/dispatch-care-notifications.ts",
    "public/sw.js"
  ]) {
    assert.equal(existsSync(join(repositoryRoot, removedPath)), false, removedPath);
  }

  for (const currentPath of [
    "src/app/(app)/page.tsx",
    "src/app/(app)/pets/page.tsx",
    "src/app/(app)/weights/page.tsx",
    "src/app/(app)/care/page.tsx",
    "src/app/(app)/records/page.tsx",
    "src/app/(app)/settings/page.tsx"
  ]) {
    assert.equal(existsSync(join(repositoryRoot, currentPath)), true, currentPath);
  }

  const runtimeSource = [
    ...sourceFilesUnder("src"),
    ...sourceFilesUnder("scripts"),
    ...sourceFilesUnder("prisma")
  ].map(source).join("\n");
  for (const legacyAccess of [
    /hamster/i,
    /prisma\.(?:cleaningRecord|feedingRecord|waterReplacementRecord|weightRecord|hamsterRecord)\b/,
    /HAMSTER_IMAGE_DIR/,
    /(?:^|[^A-Z_])RECORD_IMAGE_DIR/,
    /DEVICE_CARE/,
    /WEB_PUSH/,
    /VAPID/
  ]) {
    assert.doesNotMatch(runtimeSource, legacyAccess);
  }

  const configuration = [
    source("package.json"),
    source("Dockerfile"),
    source(".env.example"),
    source(".env.development.example"),
    source(".env.production.example")
  ].join("\n");
  assert.doesNotMatch(
    configuration,
    /HAMSTER_IMAGE_DIR|(?:^|\n)RECORD_IMAGE_DIR=|DEVICE_CARE|WEB_PUSH|VAPID|web-push/
  );
  assert.match(configuration, /PET_IMAGE_DIR/);
  assert.match(configuration, /PET_RECORD_IMAGE_DIR/);
});

test("current CI runtime configuration does not reintroduce Hamster settings", () => {
  const ciConfiguration = source(".github/workflows/ci.yml");

  assert.doesNotMatch(
    ciConfiguration,
    /HAMSTER_IMAGE_DIR|(?:^|\n)\s*RECORD_IMAGE_DIR=|uploads\/hamsters|hamster_manager_ci|hamster_user|hamster_ci_password|RUNNER_TEMP\/hamster-manager/
  );
  assert.match(ciConfiguration, /PET_IMAGE_DIR/);
  assert.match(ciConfiguration, /PET_RECORD_IMAGE_DIR/);
  assert.match(ciConfiguration, /dog_cat_manager_ci/);
  assert.match(ciConfiguration, /RUNNER_TEMP\/dog-cat-manager/);
});
