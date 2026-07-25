import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path: string) => readFile(path, "utf8");

test("管理状態変更は初回・2回目以降ともURL遷移せずrefreshしてスクロールと一覧状態を維持する", async () => {
  const [actionSource, formSource, listSource] = await Promise.all([
    readSource("src/app/actions/hamsters.ts"),
    readSource("src/components/hamster-active-status-form.tsx"),
    readSource("src/components/hamster-list.tsx")
  ]);
  const actionStart = actionSource.indexOf("export async function updateHamsterActiveStatus");
  const actionEnd = actionSource.indexOf("export async function deleteHamster", actionStart);
  const activeStatusAction = actionSource.slice(actionStart, actionEnd);

  assert.doesNotMatch(activeStatusAction, /redirect\(/);
  assert.match(activeStatusAction, /return \{ success: true, status: "updated" \}/);
  assert.match(formSource, /event\.preventDefault\(\)/);
  assert.match(formSource, /const actionResult = await updateHamsterActiveStatus\(formData\)/);
  assert.match(formSource, /router\.refresh\(\)/);
  assert.match(formSource, /const scrollPosition = \{ x: window\.scrollX, y: window\.scrollY \}/);
  assert.match(formSource, /useLayoutEffect\([\s\S]*?window\.scrollTo\(position\.x, position\.y\)[\s\S]*?\[isActive\]/);
  assert.doesNotMatch(formSource, /router\.(?:push|replace)\(|sessionStorage/);

  assert.match(listSource, /useState\(""\)/);
  assert.match(listSource, /useState\(1\)/);
  assert.match(listSource, /useState<string\[\]>\(\[\]\)/);
});

test("管理中・管理外の両方向を最新propsから送信し、処理中の二重送信を防ぐ", async () => {
  const source = await readSource("src/components/hamster-active-status-form.tsx");

  assert.match(source, /const nextIsActive = !isActive/);
  assert.match(source, /formData\.set\("isActive", String\(nextIsActive\)\)/);
  assert.match(source, /if \(submittingRef\.current\) return/);
  assert.match(source, /disabled=\{isPending\}/);
  assert.match(source, /更新中\.\.\./);
  assert.match(source, /nextIsActive \? "管理中に戻す" : "管理外にする"/);
});

test("成功時はメッセージを表示せず、失敗時だけ既存メッセージを表示する", async () => {
  const [formSource, statusMessageSource, pageSource] = await Promise.all([
    readSource("src/components/hamster-active-status-form.tsx"),
    readSource("src/components/status-message.tsx"),
    readSource("src/app/(app)/hamsters/page.tsx")
  ]);

  assert.match(
    formSource,
    /\{result && !result\.success \? <StatusMessage status=\{result\.status\} errorId=\{result\.errorId\} \/> : null\}/
  );
  assert.doesNotMatch(formSource, /\{result \? <StatusMessage/);
  assert.match(statusMessageSource, /updated: "更新しました。"/);
  assert.match(pageSource, /<StatusMessage status=\{status\} errorId=\{getParam\(params\.errorId\)\} \/>/);
});

test("成功後の状態とロックをPC・モバイル共通フローで反映する", async () => {
  const listSource = await readSource("src/components/hamster-list.tsx");

  assert.equal(listSource.match(/<HamsterActiveStatusForm/g)?.length, 2);
  assert.match(listSource, /hidden lg:block[\s\S]*?<HamsterActiveStatusForm[^>]+compact/);
  assert.match(listSource, /lg:hidden[\s\S]*?<HamsterActiveStatusForm/);
  assert.match(listSource, /const isLocked = !hamster\.isActive/);
  assert.match(listSource, /disabled=\{isLocked\}/);
  assert.match(listSource, /disabled=\{isLocked\}[\s\S]*?<DirtySubmitButton/);
});

test("サーバー側の権限・所属・競合・履歴・revision・SSE処理を維持する", async () => {
  const source = await readSource("src/app/actions/hamsters.ts");
  const actionStart = source.indexOf("export async function updateHamsterActiveStatus");
  const actionEnd = source.indexOf("export async function deleteHamster", actionStart);
  const action = source.slice(actionStart, actionEnd);

  assert.match(action, /getRequiredHouseholdMutationContext\("\/hamsters"\)/);
  assert.match(action, /where: \{ id: result\.data\.id, householdId: context\.household\.id \}/);
  assert.match(action, /where: \{ id: result\.data\.id, householdId: context\.household\.id, isActive: hamster\.isActive \}/);
  assert.match(action, /updated\.count !== 1/);
  assert.match(action, /commitHouseholdMutation\(/);
  assert.match(action, /HAMSTER_ACTIVE_STATUS_UPDATED/);
  assert.match(action, /publishHouseholdChangeSafely\(change\)/);
  assert.match(action, /revalidatePathsSafely\(/);
});
