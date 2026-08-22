import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { PetNotificationRulesForm } from "../src/components/pet-notification-rules-form";

function render(species: "DOG" | "CAT", isActive = true) {
  return renderToStaticMarkup(
    <PetNotificationRulesForm
      petId="pet-1"
      petName="ソラ"
      species={species}
      isActive={isActive}
      careDayStartMinutes={480}
      initialRules={[]}
    />
  );
}

test("DOGの通知設定は食事・水・散歩を表示し猫トイレを表示しない", () => {
  const markup = render("DOG");
  assert.match(markup, />食事</);
  assert.match(markup, />水のお世話</);
  assert.match(markup, />散歩</);
  assert.doesNotMatch(markup, />猫トイレ清掃</);
});

test("CATの通知設定は食事・水・猫トイレを表示し散歩を表示しない", () => {
  const markup = render("CAT");
  assert.match(markup, />食事</);
  assert.match(markup, />水のお世話</);
  assert.match(markup, />猫トイレ清掃</);
  assert.doesNotMatch(markup, />散歩</);
});

test("通知設定はプロフィールと別フォームで閉じて始まり、管理終了案内を保持する", () => {
  const markup = render("DOG", false);
  assert.match(markup, /<section[^>]*data-pet-notification-settings/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /<form[^>]*data-dirty-watch="true"/);
  assert.match(markup, /通知設定なし/);
  assert.match(markup, /管理終了中のため通知は送信されません。/);
});
