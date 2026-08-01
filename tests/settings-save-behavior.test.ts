import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createSettingsSaveState,
  INITIAL_SETTINGS_SAVE_STATE,
  isCommittedSettingsSave
} from "../src/lib/settings-save-state";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("設定保存結果は同じstatusの連続送信でも識別できる", () => {
  const first = createSettingsSaveState(INITIAL_SETTINGS_SAVE_STATE, "unchanged");
  const second = createSettingsSaveState(first, "unchanged");

  assert.equal(first.submissionId, 1);
  assert.equal(second.submissionId, 2);
  assert.equal(isCommittedSettingsSave(first), true);
  assert.equal(isCommittedSettingsSave(createSettingsSaveState(second, "invalid")), false);
});

test("通常設定と通知設定はURL redirectではなくuseActionStateで結果を受け取る", () => {
  const dashboardForm = source("src/components/dashboard-settings-form.tsx");
  const notificationForm = source("src/components/notification-settings-form.tsx");
  const settingsAction = source("src/app/actions/settings.ts");
  const notificationAction = source("src/app/actions/care-notifications.ts");

  for (const form of [dashboardForm, notificationForm]) {
    assert.match(form, /useActionState\(/);
    assert.match(form, /action=\{saveAction\}/);
    assert.match(form, /allowPristineSubmit/);
    assert.match(form, /aria-busy=\{isSaving\}/);
    assert.match(form, /data-settings-save-toast/);
    assert.match(form, /fixed inset-x-4 bottom-20/);
    assert.match(form, /<StatusMessage/);
    assert.match(form, /key=\{saveState\.submissionId\}/);
    assert.doesNotMatch(form, /window\.scrollTo\(|router\.(?:push|replace|refresh)\(/);
  }

  for (const action of [settingsAction, notificationAction]) {
    assert.match(action, /createSettingsSaveState\(previousState, "unchanged"/);
    assert.match(action, /createSettingsSaveState\(previousState, "systemError"/);
    assert.doesNotMatch(action, /redirect\("\/settings\?status=/);
  }
});

test("保存確定時だけ現在値をDirty基準として再設定する", () => {
  const dirtyState = source("src/components/form-dirty-state.ts");
  const dashboardForm = source("src/components/dashboard-settings-form.tsx");
  const notificationForm = source("src/components/notification-settings-form.tsx");

  assert.match(dirtyState, /initialFormSnapshots\.set\(form, getFormSnapshot\(form\)\)/);
  assert.match(dashboardForm, /isCommittedSettingsSave\(saveState\)[\s\S]*?commitFormDirtyState\(form\)/);
  assert.match(notificationForm, /isCommittedSettingsSave\(saveState\)[\s\S]*?commitFormDirtyState\(form\)/);
  assert.match(notificationForm, /savedCareNotificationSettings[\s\S]*?setCompactBodyEnabled/);
  assert.match(notificationForm, /input\.defaultChecked = checked/);
  assert.match(notificationForm, /input\.defaultValue = value/);
  assert.match(dashboardForm, /requestFormDirtyReevaluation\(form\)/);
  assert.match(notificationForm, /requestFormDirtyReevaluation\(formRef\.current\)/);
  assert.match(dashboardForm, /savedDashboardSettings[\s\S]*?setSelectedIds/);
  assert.match(dashboardForm, /savedSubmissionId=\{saveState\.submissionId\}/);
});

test("設定画面だけ変更なし送信を許可し、他フォームのDirtySubmitButton既定挙動は維持する", () => {
  const button = source("src/components/dirty-submit-button.tsx");

  assert.match(button, /allowPristineSubmit = false/);
  assert.match(button, /disabled \|\| \(!allowPristineSubmit && !isDirty\)/);
  assert.match(button, /data-dirty=\{isDirty \? "true" : "false"\}/);
});
