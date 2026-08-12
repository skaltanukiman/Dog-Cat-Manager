import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { MAX_IMAGE_UPLOAD_SIZE_BYTES, SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-constraints";
import {
  ImageProcessingError,
  type ImageInput,
  type ImageProcessingErrorCode,
  prepareWebpWithinStorageLimit,
  type WebpCandidate
} from "@/lib/image-processing";

export const MAX_PET_RECORD_IMAGE_SIZE_BYTES = MAX_IMAGE_UPLOAD_SIZE_BYTES;
export const PET_RECORD_IMAGE_MIME_TYPES = SUPPORTED_IMAGE_MIME_TYPES;
export const PET_RECORD_IMAGE_MAX_DIMENSION = 1920;

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const MEMORY_IMAGE_CANDIDATES: readonly WebpCandidate[] = [
  { maxSize: PET_RECORD_IMAGE_MAX_DIMENSION, quality: 82 },
  { maxSize: PET_RECORD_IMAGE_MAX_DIMENSION, quality: 76 },
  { maxSize: PET_RECORD_IMAGE_MAX_DIMENSION, quality: 70 },
  { maxSize: 1600, quality: 82 },
  { maxSize: 1600, quality: 76 },
  { maxSize: 1600, quality: 70 },
  { maxSize: 1400, quality: 82 },
  { maxSize: 1400, quality: 76 },
  { maxSize: 1200, quality: 82 },
  { maxSize: 1200, quality: 76 },
  { maxSize: 960, quality: 76 },
  { maxSize: 800, quality: 70 },
  { maxSize: 640, quality: 64 }
];

export type PetRecordImageErrorCode = ImageProcessingErrorCode;
export { ImageProcessingError as PetRecordImageError };

export type PreparedPetRecordImage = {
  fileName: string;
  buffer: Buffer;
};

export function isSafePetRecordImageFileName(fileName: string) {
  return SAFE_FILE_NAME_PATTERN.test(fileName);
}

export function canServePetRecordImage({
  currentHouseholdId,
  petHouseholdId,
  fileName
}: {
  currentHouseholdId: string;
  petHouseholdId: string | null;
  fileName: string | null;
}) {
  return (
    petHouseholdId === currentHouseholdId &&
    Boolean(fileName && isSafePetRecordImageFileName(fileName))
  );
}

export function createPetRecordImageFileName() {
  return `${randomUUID()}.webp`;
}

export function getPetRecordImageRoot() {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.PET_RECORD_IMAGE_DIR || "./uploads/pet-records"
  );
}

function assertSafeHouseholdId(householdId: string) {
  if (!SAFE_ID_PATTERN.test(householdId)) {
    throw new ImageProcessingError("invalid");
  }
}

export function getPetRecordImageHouseholdDirectory(
  householdId: string,
  rootDir = getPetRecordImageRoot()
) {
  // Household IDをディレクトリ名に使うため、許可文字と解決後のroot配下判定を二重に確認する。
  assertSafeHouseholdId(householdId);

  const root = path.resolve(/* turbopackIgnore: true */ rootDir);
  const householdDir = path.resolve(root, householdId);
  if (!householdDir.startsWith(`${root}${path.sep}`)) {
    throw new ImageProcessingError("invalid");
  }

  return { root, householdDir };
}

export function getPetRecordImagePath(
  householdId: string,
  fileName: string,
  rootDir = getPetRecordImageRoot()
) {
  if (!isSafePetRecordImageFileName(fileName)) {
    throw new ImageProcessingError("invalid");
  }

  const { root, householdDir } = getPetRecordImageHouseholdDirectory(householdId, rootDir);
  const filePath = path.resolve(householdDir, fileName);
  if (!filePath.startsWith(`${householdDir}${path.sep}`)) {
    throw new ImageProcessingError("invalid");
  }

  return { root, householdDir, filePath };
}

export function getOptionalPetRecordImageFile(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : null;
}

export async function preparePetRecordImage(file: ImageInput): Promise<PreparedPetRecordImage> {
  const buffer = await prepareWebpWithinStorageLimit(file, {
    candidates: MEMORY_IMAGE_CANDIDATES,
    fit: "inside"
  });
  return { fileName: createPetRecordImageFileName(), buffer };
}

export async function savePetRecordImage(
  householdId: string,
  image: PreparedPetRecordImage,
  rootDir = getPetRecordImageRoot()
) {
  const { householdDir, filePath } = getPetRecordImagePath(
    householdId,
    image.fileName,
    rootDir
  );
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

export async function readPetRecordImage(
  householdId: string,
  fileName: string,
  rootDir = getPetRecordImageRoot()
) {
  const { filePath } = getPetRecordImagePath(householdId, fileName, rootDir);
  return readFile(filePath);
}

export async function deletePetRecordImage(
  householdId: string,
  fileName: string,
  rootDir = getPetRecordImageRoot()
) {
  const { filePath } = getPetRecordImagePath(householdId, fileName, rootDir);
  await rm(filePath, { force: true });
}

export async function deletePetRecordImageHouseholdDirectory(
  householdId: string,
  rootDir = getPetRecordImageRoot()
) {
  const { householdDir } = getPetRecordImageHouseholdDirectory(householdId, rootDir);
  await rm(householdDir, { recursive: true, force: true });
}

/**
 * 新画像を先に保存し、DB更新に失敗した場合は新画像を補償削除する。
 *
 * 差し替え前の画像はDB commit後に呼び出し側が削除し、参照中の画像を先に失わない。
 */
export async function commitWithNewPetRecordImage<T>({
  householdId,
  image,
  commit,
  rootDir = getPetRecordImageRoot()
}: {
  householdId: string;
  image: PreparedPetRecordImage;
  commit: (fileName: string) => Promise<T>;
  rootDir?: string;
}) {
  await savePetRecordImage(householdId, image, rootDir);

  try {
    return await commit(image.fileName);
  } catch (error) {
    await deletePetRecordImage(householdId, image.fileName, rootDir).catch(() => undefined);
    throw error;
  }
}
