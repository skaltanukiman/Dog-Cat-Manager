import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { canManageCareDaySettings } from "../src/lib/authorization";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("Householdに0時既定・0〜1439制約のお世話日設定を追加する", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source(
    "prisma/migrations/20260801150000_add_care_day_start_minutes/migration.sql"
  );

  assert.match(
    schema,
    /model Household[\s\S]*careDayStartMinutes\s+Int\s+@default\(0\)\s+@map\("care_day_start_minutes"\)/
  );
  assert.match(migration, /ADD COLUMN "care_day_start_minutes" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /CHECK \("care_day_start_minutes" BETWEEN 0 AND 1439\)/);
  const appSettingModel = schema.slice(schema.indexOf("model AppSetting"), schema.indexOf("model DashboardHamster"));
  assert.doesNotMatch(appSettingModel, /careDayStartMinutes|care_day_start_minutes/);
  assert.doesNotMatch(migration, /feeding_records[\s\S]*UPDATE|water_replacement_records[\s\S]*UPDATE/i);
});

test("お世話日設定の変更権限はOWNERとADMINだけに限定する", () => {
  assert.equal(canManageCareDaySettings("OWNER"), true);
  assert.equal(canManageCareDaySettings("ADMIN"), true);
  assert.equal(canManageCareDaySettings("MEMBER"), false);
  assert.equal(canManageCareDaySettings("VIEWER"), false);

  const action = source("src/app/actions/care-day-settings.ts");
  assert.match(action, /tx\.householdMember\.findUnique/);
  assert.match(action, /canManageCareDaySettings\(membership\.role\)/);
  assert.match(action, /membership\.household\.isDemo/);
  assert.match(action, /status: "forbidden"/);
});

test("共有設定保存は変更なしを判定し、Household・dispatch・revisionを同じtransactionで更新する", () => {
  const action = source("src/app/actions/care-day-settings.ts");

  assert.match(action, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(action, /normalizeCareDayStartMinutes[\s\S]*===\s*careDayStartMinutes/);
  assert.match(action, /status: "unchanged"/);
  assert.match(action, /tx\.household\.update\([\s\S]*data: \{ careDayStartMinutes \}/);
  assert.match(action, /tx\.careNotificationDispatch\.updateMany\([\s\S]*"CLAIMED", "RETRYABLE"/);
  assert.match(action, /status: "SKIPPED"/);
  assert.doesNotMatch(action, /status: \{ in: \[[^\]]*"SENT"/);
  assert.match(action, /updateHouseholdRevision\(/);
  assert.match(action, /publishHouseholdChangeSafely\(outcome\.change\)/);
  assert.match(action, /\{ path: "\/" \}, \{ path: "\/settings" \}/);
  assert.doesNotMatch(action, /feedingRecord\.(update|updateMany)/);
  assert.doesNotMatch(action, /waterReplacementRecord\.(update|updateMany)/);
});

test("ダッシュボードは同じnowと対象日を食事・水替えへ一括適用し通常日付を分離する", () => {
  const queries = source("src/lib/queries.ts");
  const dashboard = queries.slice(
    queries.indexOf("export async function getDashboardData"),
    queries.indexOf("export async function getHamsterManagementData")
  );

  assert.equal(dashboard.match(/const now = new Date\(\)/g)?.length, 1);
  assert.match(dashboard, /careDayStartMinutes = normalizeCareDayStartMinutes\(context\.household\.careDayStartMinutes\)/);
  assert.match(dashboard, /careDayRecordDate = getCareDayRecordDate\(now, careDayStartMinutes\)/);
  assert.equal(dashboard.match(/recordDate: careDayRecordDate/g)?.length, 2);
  assert.match(dashboard, /hamsterId: \{ in: dashboardHamsterIds \}/);
  assert.doesNotMatch(dashboard, /for \([\s\S]*prisma\.(feedingRecord|waterReplacementRecord)\.find/);
  assert.match(dashboard, /cleaningRecord\.findMany\([\s\S]*toiletCleaned: true/);
  assert.match(dashboard, /weightRecords:[\s\S]*orderBy: \[\{ recordDate: "desc" \}/);
});

test("設定画面は表示設定、お世話日設定、通知設定の順で即時反映の注意を表示する", () => {
  const page = source("src/app/(app)/settings/page.tsx");
  const component = source("src/components/care-day-settings-form.tsx");
  const statusMessage = source("src/components/status-message.tsx");
  const dashboardPosition = page.indexOf("<DashboardSettingsForm");
  const careDayPosition = page.indexOf("<CareDaySettingsForm");
  const notificationPosition = page.indexOf("<NotificationSettingsForm");

  assert.ok(dashboardPosition >= 0 && careDayPosition > dashboardPosition);
  assert.ok(notificationPosition > careDayPosition);
  assert.match(component, /お世話日の切り替え時刻/);
  assert.match(component, /type="time"/);
  assert.match(component, /step=\{60\}/);
  assert.match(component, /切り替え時刻：\{formatMinutesAsTime\(savedMinutes\)\}/);
  assert.match(component, /<div className="mt-2 max-w-3xl space-y-1 text-sm leading-6 text-slate-600">[\s\S]*<p>設定した時刻になると、食事と水替えが新しいお世話日に切り替わります。<\/p>[\s\S]*<p>例：8:00に設定した場合、翌日の7:59までは同じお世話日として扱います。<\/p>/);
  assert.match(component, /<div className="space-y-1">[\s\S]*<p>変更内容は、保存後すぐに反映されます。<\/p>[\s\S]*<p>[\s\S]*食事・水替えの表示が「実施済み」から「未実施」、または「未実施」から「実施済み」に変わる場合があります。[\s\S]*<\/p>[\s\S]*<p>既存記録の日付は変更されません。<\/p>/);
  assert.match(component, /既存記録の日付は変更されません/);
  assert.match(component, /共有グループのオーナーまたは管理者のみ変更できます/);
  assert.match(component, /disabled=\{!canManage \|\| isSaving\}/);
  assert.match(component, /DirtySubmitButton/);
  assert.match(statusMessage, /careDaySaved: "お世話日の切り替え時刻を保存しました。"/);
});
