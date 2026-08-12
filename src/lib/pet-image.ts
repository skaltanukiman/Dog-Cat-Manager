import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { MAX_IMAGE_UPLOAD_SIZE_BYTES, SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";
import {
  ImageProcessingError,
  type ImageProcessingErrorCode,
  prepareWebpWithinStorageLimit,
  type WebpCandidate
} from "@/lib/image-processing";

export const MAX_PET_IMAGE_SIZE_BYTES = MAX_IMAGE_UPLOAD_SIZE_BYTES;
export const PET_IMAGE_SIZE = 512;
export const PET_IMAGE_MIME_TYPES = SUPPORTED_IMAGE_MIME_TYPES;

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_FILE_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const PROFILE_IMAGE_CANDIDATES: readonly WebpCandidate[] = [
  { maxSize: PET_IMAGE_SIZE, quality: 82 },
  { maxSize: PET_IMAGE_SIZE, quality: 76 },
  { maxSize: PET_IMAGE_SIZE, quality: 70 },
  { maxSize: 448, quality: 76 },
  { maxSize: 384, quality: 70 },
  { maxSize: 320, quality: 64 }
];

export type PetImageErrorCode = ImageProcessingErrorCode;
export { ImageProcessingError as PetImageError };

export type PreparedPetImage = {
  fileName: string;
  buffer: Buffer;
};

type PetImageInput = Pick<File, "size" | "type" | "arrayBuffer">;

export function isSafePetImageFileName(fileName: string) {
  return SAFE_FILE_NAME_PATTERN.test(fileName);
}

export function canServePetImage({
  currentHouseholdId,
  petHouseholdId,
  fileName
}: {
  currentHouseholdId: string;
  petHouseholdId: string | null;
  fileName: string | null;
}) {
  return petHouseholdId === currentHouseholdId && Boolean(fileName && isSafePetImageFileName(fileName));
}

export function createPetImageFileName() {
  return `${randomUUID()}.webp`;
}

export function getPetImageRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.env.PET_IMAGE_DIR || "./uploads/pets");
}

function assertSafeHouseholdId(householdId: string) {
  if (!SAFE_ID_PATTERN.test(householdId)) {
    throw new ImageProcessingError("invalid");
  }
}

export function getPetImageHouseholdDirectory(householdId: string, rootDir = getPetImageRoot()) {
  // householdIdをディレクトリ名に使うため、文字種と解決後のroot配下判定を二重に行う。
  assertSafeHouseholdId(householdId);

  const root = path.resolve(/* turbopackIgnore: true */ rootDir);
  const householdDir = path.resolve(root, householdId);
  if (!householdDir.startsWith(`${root}${path.sep}`)) {
    throw new ImageProcessingError("invalid");
  }

  return { root, householdDir };
}

export function getPetImagePath(householdId: string, fileName: string, rootDir = getPetImageRoot()) {
  if (!isSafePetImageFileName(fileName)) {
    throw new ImageProcessingError("invalid");
  }

  const { root, householdDir } = getPetImageHouseholdDirectory(householdId, rootDir);
  const filePath = path.resolve(householdDir, fileName);
  if (!filePath.startsWith(`${householdDir}${path.sep}`)) {
    throw new ImageProcessingError("invalid");
  }

  return { root, householdDir, filePath };
}

export function getOptionalPetImageFile(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : null;
}

export async function preparePetImage(file: PetImageInput): Promise<PreparedPetImage> {
  const buffer = await prepareWebpWithinStorageLimit(file, {
    candidates: PROFILE_IMAGE_CANDIDATES,
    fit: "cover"
  });
  return { fileName: createPetImageFileName(), buffer };
}

export async function savePetImage(
  householdId: string,
  image: PreparedPetImage,
  rootDir = getPetImageRoot()
) {
  const { householdDir, filePath } = getPetImagePath(householdId, image.fileName, rootDir);
  await mkdir(householdDir, { recursive: true, mode: 0o750 });
  const temporaryPath = path.join(householdDir, `.${image.fileName}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    // 排他的な一時ファイルを同期してからrenameし、配信側に書きかけの画像を見せない。
    handle = await open(temporaryPath, "wx", 0o640);
    await handle.writeFile(image.buffer);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return filePath;
}

export async function readPetImage(householdId: string, fileName: string, rootDir = getPetImageRoot()) {
  const { filePath } = getPetImagePath(householdId, fileName, rootDir);
  return readFile(filePath);
}

export async function deletePetImage(householdId: string, fileName: string, rootDir = getPetImageRoot()) {
  const { filePath } = getPetImagePath(householdId, fileName, rootDir);
  await rm(filePath, { force: true });
}

export async function deletePetImageHouseholdDirectory(householdId: string, rootDir = getPetImageRoot()) {
  const { householdDir } = getPetImageHouseholdDirectory(householdId, rootDir);
  await rm(householdDir, { recursive: true, force: true });
}

export async function commitWithNewPetImage<T>({
  householdId,
  image,
  commit,
  rootDir = getPetImageRoot()
}: {
  householdId: string;
  image: PreparedPetImage;
  commit: (fileName: string) => Promise<T>;
  rootDir?: string;
}) {
  // DB commitに失敗した場合は先に確定した新画像を補償削除し、孤立ファイルを残さない。
  await savePetImage(householdId, image, rootDir);

  try {
    return await commit(image.fileName);
  } catch (error) {
    await deletePetImage(householdId, image.fileName, rootDir).catch(() => undefined);
    throw error;
  }
}
