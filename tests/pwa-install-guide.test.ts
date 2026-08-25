import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("設定画面からiPhoneのホーム画面追加ガイドへ移動できる", () => {
  const settingsPage = source("src/app/(app)/settings/page.tsx");
  const entry = source("src/components/pwa-install-guide-entry.tsx");

  assert.match(settingsPage, /<TutorialSettingsEntry \/>[\s\S]*<PwaInstallGuideEntry \/>/);
  assert.match(entry, /ホーム画面に追加/);
  assert.match(entry, /href="\/settings\/pwa"/);
  assert.match(entry, /手順を見る/);
});

test("ガイドページは5枚の手順画像を正しい順番とaltで表示する", () => {
  const page = source("src/app/(app)/settings/pwa/page.tsx");
  const expectedSteps = [
    ["/help/pwa/iphone/step-1.png", "手順1：画面右下の三点メニューをタップ"],
    ["/help/pwa/iphone/step-2.png", "手順2：ブラウザメニューから共有をタップ"],
    ["/help/pwa/iphone/step-3.png", "手順3：共有シートで表示を増やすをタップ"],
    ["/help/pwa/iphone/step-4.png", "手順4：ホーム画面に追加をタップ"],
    ["/help/pwa/iphone/step-5.png", "手順5：Webアプリとして開くをオンのまま追加をタップ"]
  ] as const;

  assert.match(page, /iPhoneでホーム画面に追加/);
  assert.match(page, /<ol/);
  assert.match(page, /<Image[\s\S]*unoptimized/);
  let previousPosition = -1;
  for (const [imagePath, alt] of expectedSteps) {
    const position = page.indexOf(imagePath);
    assert.ok(position > previousPosition, `${imagePath}が正しい順番で定義されている`);
    assert.ok(page.includes(`alt: "${alt}"`), `${imagePath}に適切なaltが設定されている`);
    assert.doesNotThrow(() => readFileSync(join(root, "public", imagePath)));
    previousPosition = position;
  }
  assert.match(page, /href="\/settings"/);
  assert.match(page, /設定に戻る/);
});
