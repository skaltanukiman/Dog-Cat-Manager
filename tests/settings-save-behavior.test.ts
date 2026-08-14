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

test("設定保存結果は同じ status の連続送信でも識別できる", () => {
  const first = createSettingsSaveState(INITIAL_SETTINGS_SAVE_STATE, "unchanged");
  const second = createSettingsSaveState(first, "unchanged");

  assert.equal(first.submissionId, 1);
  assert.equal(second.submissionId, 2);
  assert.equal(isCommittedSettingsSave(first), true);
  assert.equal(isCommittedSettingsSave(createSettingsSaveState(second, "invalid")), false);
});

test("Dashboard 設定とお世話日設定は useActionState で保存結果を受け取る", () => {
  const dashboardForm = source("src/components/dashboard-settings-form.tsx");
  const careDayForm = source("src/components/care-day-settings-form.tsx");
  const settingsAction = source("src/app/actions/settings.ts");
  const careDayAction = source("src/app/actions/care-day-settings.ts");

  for (const form of [dashboardForm, careDayForm]) {
    assert.match(form, /useActionState\(/);
    assert.match(form, /action=\{saveAction\}/);
    assert.match(form, /aria-busy=\{isSaving\}/);
    assert.match(form, /data-settings-save-toast/);
    assert.match(form, /<StatusMessage/);
    assert.doesNotMatch(form, /allowPristineSubmit/);
    assert.doesNotMatch(form, /window\.scrollTo\(|router\.(?:push|replace|refresh)\(/);
  }

  for (const action of [settingsAction, careDayAction]) {
    assert.match(action, /createSettingsSaveState\(previousState, "unchanged"/);
    assert.match(action, /createSettingsSaveState\(previousState, "systemError"/);
    assert.doesNotMatch(action, /redirect\("\/settings\?status=/);
  }
});

test("保存確定時だけ現在値を Dirty 基準として再設定する", () => {
  const dirtyState = source("src/components/form-dirty-state.ts");
  const dashboardForm = source("src/components/dashboard-settings-form.tsx");
  const careDayForm = source("src/components/care-day-settings-form.tsx");

  assert.match(dirtyState, /initialFormSnapshots\.set\(form, getFormSnapshot\(form\)\)/);

  for (const form of [dashboardForm, careDayForm]) {
    assert.match(form, /isCommittedSettingsSave\(saveState\)/);
    assert.match(form, /commitFormDirtyState\(/);
    assert.match(form, /requestFormDirtyReevaluation\(/);
  }

  assert.match(dashboardForm, /savedDashboardSettings[\s\S]*?setSelectedIds/);
  assert.match(careDayForm, /savedCareDayStartMinutes[\s\S]*?setSavedMinutes/);
});

test("設定画面の DirtySubmitButton は変更がないとき送信を許可しない", () => {
  const button = source("src/components/dirty-submit-button.tsx");
  const dashboardForm = source("src/components/dashboard-settings-form.tsx");
  const careDayForm = source("src/components/care-day-settings-form.tsx");

  assert.doesNotMatch(button, /allowPristineSubmit/);
  assert.match(button, /disabled \|\| !isDirty/);
  assert.match(button, /data-dirty=\{isDirty \? "true" : "false"\}/);
  assert.doesNotMatch(dashboardForm, /allowPristineSubmit/);
  assert.doesNotMatch(careDayForm, /allowPristineSubmit/);
});
