import assert from "node:assert/strict";
import { File } from "node:buffer";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

import { PetImageField } from "../src/components/pet-image-field";
import { PetThumbnail } from "../src/components/pet-thumbnail";
import { MAX_STORED_IMAGE_SIZE_BYTES } from "../src/lib/image-constraints";
import {
  canServePetImage,
  commitWithNewPetImage,
  createPetImageFileName,
  getPetImagePath,
  getPetImageRoot,
  isSafePetImageFileName,
  MAX_PET_IMAGE_SIZE_BYTES,
  PetImageError,
  preparePetImage,
  savePetImage
} from "../src/lib/pet-image";

async function source(filePath: string) {
  return readFile(new URL(`../${filePath}`, import.meta.url), "utf8");
}

async function imageFile(format: "jpeg" | "png" | "webp") {
  const buffer = await sharp({
    create: { width: 80, height: 40, channels: 3, background: { r: 120, g: 170, b: 90 } }
  })[format]({ quality: 90 }).toBuffer();
  return new File([buffer], `input.${format}`, { type: format === "jpeg" ? "image/jpeg" : `image/${format}` });
}

test("Pet画像rootはPET_IMAGE_DIRとPet専用デフォルトだけを使用する", async () => {
  const utility = await source("src/lib/pet-image.ts");
  assert.match(utility, /process\.env\.PET_IMAGE_DIR \|\| "\.\/uploads\/pets"/);
  const previous = process.env.PET_IMAGE_DIR;
  delete process.env.PET_IMAGE_DIR;
  try {
    assert.equal(getPetImageRoot(), path.resolve("./uploads/pets"));
  } finally {
    if (previous === undefined) delete process.env.PET_IMAGE_DIR;
    else process.env.PET_IMAGE_DIR = previous;
  }
});

for (const format of ["jpeg", "png", "webp"] as const) {
  test(`${format.toUpperCase()}を正方形のWebPへ変換できる`, async () => {
    const converted = await preparePetImage(await imageFile(format));
    const metadata = await sharp(converted.buffer).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.ok(converted.buffer.byteLength <= MAX_STORED_IMAGE_SIZE_BYTES);
    assert.equal(isSafePetImageFileName(converted.fileName), true);
  });
}

test("10MB超過・対象外MIME・破損画像をサーバー側で拒否する", async () => {
  await assert.rejects(
    preparePetImage(new File([Buffer.alloc(MAX_PET_IMAGE_SIZE_BYTES + 1)], "large.jpg", { type: "image/jpeg" })),
    (error: unknown) => error instanceof PetImageError && error.code === "tooLarge"
  );
  await assert.rejects(
    preparePetImage(new File(["GIF89a"], "image.gif", { type: "image/gif" })),
    (error: unknown) => error instanceof PetImageError && error.code === "unsupported"
  );
  await assert.rejects(
    preparePetImage(new File(["not an image"], "fake.jpg", { type: "image/jpeg" })),
    (error: unknown) => error instanceof PetImageError && error.code === "invalid"
  );
});

test("保存先はHouseholdサブディレクトリとUUID WebPに限定しpath traversalを拒否する", () => {
  const fileName = createPetImageFileName();
  const resolved = getPetImagePath("household-1", fileName, "C:\\pet-safe-root");
  assert.equal(path.basename(resolved.householdDir), "household-1");
  assert.equal(path.basename(resolved.filePath), fileName);
  assert.throws(() => getPetImagePath("../outside", fileName, "C:\\pet-safe-root"), PetImageError);
  assert.throws(() => getPetImagePath("household-1", "../../secret", "C:\\pet-safe-root"), PetImageError);
});

test("保存とDB失敗時の補償削除はPet専用一時root内で完結する", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pet-image-"));
  try {
    const saved = await preparePetImage(await imageFile("png"));
    const savedPath = await savePetImage("household-1", saved, root);
    assert.ok(savedPath.startsWith(path.resolve(root) + path.sep));
    assert.deepEqual(await readFile(savedPath), saved.buffer);

    const rollback = await preparePetImage(await imageFile("webp"));
    await assert.rejects(
      commitWithNewPetImage({
        householdId: "household-1",
        image: rollback,
        rootDir: root,
        commit: async () => { throw new Error("DB failed"); }
      }),
      /DB failed/
    );
    await assert.rejects(stat(getPetImagePath("household-1", rollback.fileName, root).filePath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pet画像配信判定とrouteは認証・Household・安全なファイル名を必須にする", async () => {
  const fileName = createPetImageFileName();
  assert.equal(canServePetImage({ currentHouseholdId: "h1", petHouseholdId: "h1", fileName }), true);
  assert.equal(canServePetImage({ currentHouseholdId: "h1", petHouseholdId: "h2", fileName }), false);
  assert.equal(canServePetImage({ currentHouseholdId: "h1", petHouseholdId: "h1", fileName: "../secret" }), false);

  const route = await source("src/app/api/pets/[id]/image/route.ts");
  assert.match(route, /getHouseholdContextForRoute\(\)/);
  assert.match(route, /status: 401/);
  assert.match(route, /where: \{ id, householdId: context\.household\.id \}/);
  assert.match(route, /Content-Type": "image\/webp"/);
  assert.match(route, /X-Content-Type-Options": "nosniff"/);
  assert.match(route, /private, max-age=31536000, immutable/);
});

test("Pet画像UIはpreview・削除指定・placeholder・Pet名altを提供しVIEWER操作を無効化する", () => {
  const fileName = createPetImageFileName();
  const empty = renderToStaticMarkup(
    <PetThumbnail petId="pet-1" petName="こむぎ" profileImageFileName={null} />
  );
  assert.match(empty, /こむぎのプロフィール画像は未登録です/);
  assert.doesNotMatch(empty, /<img/);

  const thumbnail = renderToStaticMarkup(
    <PetThumbnail petId="pet-1" petName="こむぎ" profileImageFileName={fileName} />
  );
  assert.match(thumbnail, /\/api\/pets\/pet-1\/image\?v=/);
  assert.match(thumbnail, /alt="こむぎのプロフィール画像"/);
  assert.match(thumbnail, /aria-haspopup="dialog"/);

  const field = renderToStaticMarkup(
    <PetImageField petId="pet-1" petName="こむぎ" currentFileName={fileName} />
  );
  assert.match(field, /name="profileImage"/);
  assert.match(field, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(field, /name="removeProfileImage"/);
  assert.match(field, /登録済み画像を削除/);
  assert.match(field, /元画像10MB以内/);

  const viewer = renderToStaticMarkup(
    <PetImageField petId="pet-1" petName="こむぎ" currentFileName={fileName} disabled />
  );
  assert.match(viewer, /type="file"[^>]*disabled=""/);
  assert.match(viewer, /<input(?=[^>]*name="removeProfileImage")(?=[^>]*disabled="")[^>]*>/);
});

test("Pet画面・Actionは画像追加差し替え削除を既存権限・species不変のまま扱う", async () => {
  const [page, actions, field] = await Promise.all([
    source("src/app/(app)/pets/page.tsx"),
    source("src/app/actions/pets.ts"),
    source("src/components/pet-image-field.tsx")
  ]);
  assert.match(page, /<PetImageField petName="新しいPet"/);
  assert.match(page, /currentFileName=\{pet\.profileImageFileName\}/);
  assert.match(page, /disabled=\{!canEdit\}/);
  assert.equal((page.match(/name="species"/g) ?? []).length, 1);

  assert.match(field, /URL\.createObjectURL\(file\)/);
  assert.match(field, /setRemoveCurrent\(false\)/);
  assert.match(actions, /getOptionalPetImageFile\(formData\.get\("profileImage"\)\)/);
  assert.match(actions, /commitWithNewPetImage/);
  assert.match(actions, /profileImageFileName: true/);
  assert.match(actions, /removeProfileImage && pet\.profileImageFileName/);
  assert.match(actions, /profileImageFileName !== undefined/);
  assert.match(actions, /assertCurrentPetMutationPermission\(tx, context\.household\.id, context\.user\.id\)/);
  assert.doesNotMatch(actions.slice(actions.indexOf("export async function updatePet"), actions.indexOf("export async function updatePetActiveStatus")), /data\.species|pet\.species/);
  const updateStart = actions.indexOf("export async function updatePet");
  const commitPosition = actions.indexOf("await commit", updateStart);
  const oldDeletePosition = actions.indexOf("deletePetImageAfterMutation", commitPosition);
  assert.ok(commitPosition !== -1 && oldDeletePosition > commitPosition);
});

test("Household cleanupとDocker/envはPet画像rootだけを使用する", async () => {
  const [cleanup, dockerfile, compose, envExample, devEnvExample] = await Promise.all([
    source("src/lib/household-delete-images.ts"),
    source("Dockerfile"),
    source("docker-compose.yml"),
    source(".env.example"),
    source(".env.development.example")
  ]);
  assert.match(cleanup, /deletePetImageHouseholdDirectory/);
  assert.match(cleanup, /deletePetRecordImageHouseholdDirectory/);
  assert.match(dockerfile, /\/app\/uploads\/pets/);
  assert.match(dockerfile, /\/app\/uploads\/pet-records/);
  assert.match(compose, /\.\/uploads:\/app\/uploads/);
  assert.match(envExample, /^PET_IMAGE_DIR=\/app\/uploads\/pets$/m);
  assert.match(envExample, /^PET_RECORD_IMAGE_DIR=\/app\/uploads\/pet-records$/m);
  assert.match(devEnvExample, /^PET_IMAGE_DIR=\/app\/uploads\/pets$/m);
});

test("管理終了Actionは画像を削除しない", async () => {
  const actions = await source("src/app/actions/pets.ts");
  const activeStatusAction = actions.slice(actions.indexOf("export async function updatePetActiveStatus"));
  assert.match(activeStatusAction, /data: \{ isActive: result\.data\.isActive \}/);
  assert.doesNotMatch(activeStatusAction, /deletePetImage|profileImageFileName/);
});
