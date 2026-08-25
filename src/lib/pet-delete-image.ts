import { writeServerLog } from "@/lib/logger";
import { deletePetImage } from "@/lib/pet-image";

type PetDeleteImageDependencies = {
  deleteImage: (householdId: string, fileName: string) => Promise<void>;
  warn: (context: { householdId: string; petId: string; errorName: string }) => void;
};

/** DB削除後の画像後処理を行い、失敗しても確定済みのPet削除結果は維持する。 */
export async function deletePetImageAfterPetDeletionSafely(
  householdId: string,
  petId: string,
  fileName: string | null,
  dependencies: Partial<PetDeleteImageDependencies> = {}
) {
  if (!fileName) return;

  const deleteImage = dependencies.deleteImage ?? deletePetImage;
  try {
    await deleteImage(householdId, fileName);
  } catch (error) {
    const context = {
      householdId,
      petId,
      errorName: error instanceof Error ? error.name : typeof error
    };
    if (dependencies.warn) {
      dependencies.warn(context);
      return;
    }
    writeServerLog("warn", {
      event: "pet_image_delete_failed",
      message: "Pet完全削除後のプロフィール画像削除に失敗しました。",
      operation: "pets.delete.deleteImage",
      context
    });
  }
}
