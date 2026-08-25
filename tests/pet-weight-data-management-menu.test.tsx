import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { PetWeightDataManagementMenu } from "../src/components/pet-weight-data-management-menu";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("weights画面はモバイル用CSVメニューとsm以上用エクスポートリンクを分けて表示する", async () => {
  const page = await source("src/app/(app)/weights/page.tsx");

  assert.match(page, /<PetWeightDataManagementMenu \/>/);
  assert.match(page, /href="\/weights\/export"[\s\S]*?sm:inline-flex/);
  assert.match(page, /className="min-w-0 flex-1 sm:flex-none"/);
});

test("モバイル用CSVメニューは必要なmenu属性とエクスポートリンクを持つ", () => {
  const markup = renderToStaticMarkup(<PetWeightDataManagementMenu />);

  assert.match(markup, /class="relative sm:hidden"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-haspopup="menu"/);
  assert.match(markup, /aria-controls=/);
  assert.match(markup, /role="menu"/);
  assert.match(markup, /role="menuitem"/);
  assert.match(markup, /href="\/weights\/export"/);
  assert.match(markup, />CSVエクスポート</);
});

test("モバイル用CSVメニューは再押下・項目選択・外側タップ・Escapeで閉じる", async () => {
  const menu = await source("src/components/pet-weight-data-management-menu.tsx");

  assert.match(menu, /onClick=\{\(\) => setIsOpen\(\(open\) => !open\)\}/);
  assert.match(menu, /onClick=\{\(\) => setIsOpen\(false\)\}/);
  assert.match(menu, /containerRef\.current\?\.contains\(event\.target as Node\)/);
  assert.match(menu, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /triggerRef\.current\?\.focus\(\)/);
  assert.match(menu, /tabIndex=\{isOpen \? 0 : -1\}/);
});
