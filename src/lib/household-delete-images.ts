import { deleteHamsterImageHouseholdDirectory } from "@/lib/hamster-image";
import { writeServerLog } from "@/lib/logger";
import { deletePetImageHouseholdDirectory } from "@/lib/pet-image";
import { deletePetRecordImageHouseholdDirectory } from "@/lib/pet-record-image";
import { deleteRecordImageHouseholdDirectory } from "@/lib/record-image";

type HouseholdImageDirectoryKind = "hamster" | "pet" | "record" | "petRecord";

type HouseholdImageCleanupDependencies = {
  deleteHamsterDirectory: (householdId: string) => Promise<void>;
  deletePetDirectory: (householdId: string) => Promise<void>;
  deleteRecordDirectory: (householdId: string) => Promise<void>;
  deletePetRecordDirectory: (householdId: string) => Promise<void>;
  warn: (kind: HouseholdImageDirectoryKind) => void;
};

function defaultWarning(householdId: string, kind: HouseholdImageDirectoryKind) {
  writeServerLog("warn", {
    event: "household_image_directory_delete_failed",
    message: "削除済みHouseholdの画像ディレクトリを削除できませんでした。",
    operation: "householdDelete.cleanupImages",
    context: { householdId, imageDirectoryKind: kind }
  });
}

export async function deleteHouseholdImageDirectoriesSafely(
  householdId: string,
  dependencies: Partial<HouseholdImageCleanupDependencies> = {}
) {
  const deleteHamsterDirectory =
    dependencies.deleteHamsterDirectory ?? deleteHamsterImageHouseholdDirectory;
  const deletePetDirectory = dependencies.deletePetDirectory ?? deletePetImageHouseholdDirectory;
  const deleteRecordDirectory =
    dependencies.deleteRecordDirectory ?? deleteRecordImageHouseholdDirectory;
  const deletePetRecordDirectory =
    dependencies.deletePetRecordDirectory ?? deletePetRecordImageHouseholdDirectory;
  const warn = dependencies.warn ?? ((kind) => defaultWarning(householdId, kind));
  // DB削除後の後処理なので、各画像領域を独立させ、一方の失敗で他方まで中断しない。
  const results = await Promise.allSettled([
    deleteHamsterDirectory(householdId),
    deletePetDirectory(householdId),
    deleteRecordDirectory(householdId),
    deletePetRecordDirectory(householdId)
  ]);
  const failedKinds: HouseholdImageDirectoryKind[] = [];

  if (results[0].status === "rejected") failedKinds.push("hamster");
  if (results[1].status === "rejected") failedKinds.push("pet");
  if (results[2].status === "rejected") failedKinds.push("record");
  if (results[3].status === "rejected") failedKinds.push("petRecord");
  for (const kind of failedKinds) warn(kind);

  return { failedKinds };
}
