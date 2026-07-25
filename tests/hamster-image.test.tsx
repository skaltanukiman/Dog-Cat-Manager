import assert from "node:assert/strict";
import { File } from "node:buffer";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

import { HamsterImageField } from "../src/components/hamster-image-field";
import { HamsterThumbnail } from "../src/components/hamster-thumbnail";
import {
  canServeHamsterImage,
  commitWithNewHamsterImage,
  createHamsterImageFileName,
  deleteHamsterImage,
  deleteHamsterImageRecords,
  getHamsterImagePath,
  HamsterImageError,
  isSafeHamsterImageFileName,
  MAX_HAMSTER_IMAGE_SIZE_BYTES,
  prepareHamsterImage,
  saveHamsterImage
} from "../src/lib/hamster-image";
import { createHamsterSchema } from "../src/lib/schemas";
import { MAX_STORED_IMAGE_SIZE_BYTES } from "../src/lib/image-constraints";

async function imageFile(format: "jpeg" | "png" | "webp", width = 80, height = 40) {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 120, b: 70 } }
  })
    [format]({ quality: 90 })
    .toBuffer();
  const mime = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  return new File([buffer], `input.${format}`, { type: mime });
}

async function largePngFile(width = 1400, height = 1100) {
  const buffer = await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 }
  }).png().toBuffer();
  return new File([buffer], "large.png", { type: "image/png" });
}

for (const format of ["jpeg", "png", "webp"] as const) {
  test(`${format.toUpperCase()}を512pxのWebPへ変換できる`, async () => {
    const converted = await prepareHamsterImage(await imageFile(format));
    const metadata = await sharp(converted.buffer).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(isSafeHamsterImageFileName(converted.fileName), true);
  });
}

test("EXIFの向きを補正してから中央トリミングする", async () => {
  const left = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).raw().toBuffer();
  const right = await sharp({ create: { width: 20, height: 20, channels: 3, background: "blue" } }).raw().toBuffer();
  const raw = Buffer.alloc(40 * 20 * 3);
  for (let row = 0; row < 20; row++) {
    left.copy(raw, row * 40 * 3, row * 20 * 3, (row + 1) * 20 * 3);
    right.copy(raw, row * 40 * 3 + 20 * 3, row * 20 * 3, (row + 1) * 20 * 3);
  }
  const oriented = await sharp(raw, { raw: { width: 40, height: 20, channels: 3 } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const converted = await prepareHamsterImage(new File([oriented], "oriented.jpg", { type: "image/jpeg" }));
  const { data, info } = await sharp(converted.buffer).raw().toBuffer({ resolveWithObject: true });
  const top = data.subarray((64 * info.width + 256) * info.channels, (64 * info.width + 256) * info.channels + 3);
  const bottom = data.subarray((448 * info.width + 256) * info.channels, (448 * info.width + 256) * info.channels + 3);
  assert.ok(Math.abs(top[0] - bottom[0]) > 80 || Math.abs(top[2] - bottom[2]) > 80);
});

test("10MB超過・対象外MIME・偽装・破損画像を拒否する", async () => {
  await assert.rejects(
    prepareHamsterImage(new File([Buffer.alloc(MAX_HAMSTER_IMAGE_SIZE_BYTES + 1)], "large.jpg", { type: "image/jpeg" })),
    (error: unknown) => error instanceof HamsterImageError && error.code === "tooLarge"
  );
  await assert.rejects(
    prepareHamsterImage(new File(["GIF89a"], "image.gif", { type: "image/gif" })),
    (error: unknown) => error instanceof HamsterImageError && error.code === "unsupported"
  );
  await assert.rejects(
    prepareHamsterImage(new File(["not an image"], "fake.jpg", { type: "image/jpeg" })),
    (error: unknown) => error instanceof HamsterImageError && error.code === "invalid"
  );
  const validJpeg = await imageFile("jpeg");
  const truncated = Buffer.from(await validJpeg.arrayBuffer()).subarray(0, 30);
  await assert.rejects(
    prepareHamsterImage(new File([truncated], "broken.jpg", { type: "image/jpeg" })),
    (error: unknown) => error instanceof HamsterImageError && error.code === "invalid"
  );
});

test("2MBを超える元画像をプロフィール用WebPへ圧縮して2MB以下で保存準備する", async () => {
  const source = await largePngFile();
  assert.ok(source.size > MAX_STORED_IMAGE_SIZE_BYTES);
  assert.ok(source.size <= MAX_HAMSTER_IMAGE_SIZE_BYTES);

  const converted = await prepareHamsterImage(source);
  const metadata = await sharp(converted.buffer).metadata();
  assert.ok(converted.buffer.byteLength <= MAX_STORED_IMAGE_SIZE_BYTES);
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});

test("保存名と保存パスはUUID WebPとルート配下だけを許可する", () => {
  const fileName = createHamsterImageFileName();
  assert.equal(isSafeHamsterImageFileName(fileName), true);
  assert.throws(() => getHamsterImagePath("household-1", "../outside.webp", "C:\\safe"), HamsterImageError);
  assert.throws(() => getHamsterImagePath("../outside", fileName, "C:\\safe"), HamsterImageError);
});

test("存在しない画像の削除は成功扱いになる", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hamster-image-delete-"));
  try {
    await deleteHamsterImage("household-1", createHamsterImageFileName(), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("新画像保存後にDB処理が失敗すると新画像を後片付けする", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hamster-image-rollback-"));
  const image = await prepareHamsterImage(await imageFile("png"));
  try {
    await assert.rejects(
      commitWithNewHamsterImage({
        householdId: "household-1",
        image,
        rootDir: root,
        commit: async () => {
          throw new Error("DB failed");
        }
      }),
      /DB failed/
    );
    await assert.rejects(stat(getHamsterImagePath("household-1", image.fileName, root).filePath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("保存と読込は指定した一時ルート内で完結する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hamster-image-save-"));
  const image = await prepareHamsterImage(await imageFile("webp"));
  try {
    const filePath = await saveHamsterImage("household-1", image, root);
    assert.deepEqual(await readFile(filePath), image.buffer);
    assert.ok(filePath.startsWith(path.resolve(root) + path.sep));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("別Householdや不正ファイル名の画像は配信対象にならない", () => {
  const fileName = createHamsterImageFileName();
  assert.equal(canServeHamsterImage({ currentHouseholdId: "h1", hamsterHouseholdId: "h1", fileName }), true);
  assert.equal(canServeHamsterImage({ currentHouseholdId: "h1", hamsterHouseholdId: "h2", fileName }), false);
  assert.equal(canServeHamsterImage({ currentHouseholdId: "h1", hamsterHouseholdId: "h1", fileName: "../../secret" }), false);
});

test("単体・複数削除では画像がある対象だけを一件ずつ処理する", async () => {
  const deleted: string[] = [];
  const records = [
    { id: "1", profileImageFileName: createHamsterImageFileName() },
    { id: "2", profileImageFileName: null },
    { id: "3", profileImageFileName: createHamsterImageFileName() }
  ];
  await deleteHamsterImageRecords([records[0]], async (record) => void deleted.push(record.id));
  await deleteHamsterImageRecords(records.slice(1), async (record) => void deleted.push(record.id));
  assert.deepEqual(deleted, ["1", "3"]);
});

test("画像なしの既存データとプレースホルダー表示を維持する", () => {
  assert.equal(
    createHamsterSchema.safeParse({ name: "きなこ", memo: "", birthDate: "", adoptionDate: "" }).success,
    true
  );
  const html = renderToStaticMarkup(
    <HamsterThumbnail hamsterId="hamster-1" hamsterName="きなこ" profileImageFileName={null} />
  );
  assert.match(html, /きなこのプロフィール画像は未登録です/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<button/);
});

test("画像があるサムネイルだけ拡大操作を提供する", () => {
  const html = renderToStaticMarkup(
    <HamsterThumbnail
      hamsterId="hamster-1"
      hamsterName="きなこ"
      profileImageFileName={createHamsterImageFileName()}
    />
  );
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /きなこのプロフィール画像を拡大表示/);
  assert.match(html, /<button/);
  assert.doesNotMatch(html, /role="dialog"/);
});

test("管理外ハムスターは画像編集不可だが登録済み画像を拡大できる", () => {
  const currentFileName = createHamsterImageFileName();
  const html = renderToStaticMarkup(
    <HamsterImageField
      hamsterId="hamster-1"
      hamsterName="きなこ"
      currentFileName={currentFileName}
      disabled
    />
  );
  assert.doesNotMatch(html, /<fieldset disabled=""/);
  assert.match(html, /type="file"[^>]*disabled=""/);
  assert.match(html, /<input(?=[^>]*name="removeProfileImage")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /cursor-not-allowed/);
  assert.match(html, /管理外のため画像を削除できません/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /きなこのプロフィール画像を拡大表示/);
  assert.match(html, /元画像10MB以内/);
});

test("デモ用画像管理プレビューは静的画像と操作不可UIだけを表示する", () => {
  const html = renderToStaticMarkup(
    <HamsterImageField
      hamsterId="public-demo-hamster-kinako"
      hamsterName="きなこ"
      currentFileName={null}
      staticImagePath="/demo/hamsters/kinako.svg"
      mode="preview"
    />
  );

  assert.match(html, /src="\/demo\/hamsters\/kinako\.svg"/);
  assert.doesNotMatch(html, /\/api\/hamsters\//);
  assert.match(html, /type="file"(?=[^>]*disabled="")(?=[^>]*aria-disabled="true")[^>]*>/);
  assert.doesNotMatch(html, /type="file"[^>]*name="profileImage"/);
  assert.match(html, /JPEG、PNG、WebP \/ 元画像10MB以内/);
  assert.match(html, /<button(?=[^>]*disabled="")(?=[^>]*aria-disabled="true")[^>]*>[\s\S]*登録済み画像を削除/);
  assert.doesNotMatch(html, /name="removeProfileImage"/);
  assert.match(html, /この画像管理画面は機能紹介用のプレビューです/);
  assert.doesNotMatch(html, /<form|type="submit"/);
});

test("通常画像フィールドはファイル選択・即時プレビュー・削除指定を維持する", async () => {
  const currentFileName = createHamsterImageFileName();
  const html = renderToStaticMarkup(
    <HamsterImageField
      hamsterId="hamster-1"
      hamsterName="きなこ"
      currentFileName={currentFileName}
    />
  );
  const source = await readFile("src/components/hamster-image-field.tsx", "utf8");
  const previewStart = source.indexOf("function HamsterImageFieldPreview");
  const interactiveStart = source.indexOf("function InteractiveHamsterImageField");
  const previewSource = source.slice(previewStart, interactiveStart);
  const interactiveSource = source.slice(interactiveStart);

  assert.match(html, /type="file"[^>]*name="profileImage"/);
  assert.doesNotMatch(html, /type="file"[^>]*disabled=""/);
  assert.match(html, /name="removeProfileImage"/);
  assert.doesNotMatch(html, /name="removeProfileImage"[^>]*disabled=""/);
  assert.match(interactiveSource, /onChange=\{\(event\) =>/);
  assert.match(interactiveSource, /URL\.createObjectURL\(file\)/);
  assert.match(interactiveSource, /setRemoveCurrent\(event\.currentTarget\.checked\)/);
  assert.doesNotMatch(previewSource, /onChange=|URL\.createObjectURL|removeProfileImage/);
});
