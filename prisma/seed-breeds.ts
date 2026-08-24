import { PrismaClient } from "@prisma/client";

import { catBreeds } from "./data/cat-breeds";
import { dogBreeds } from "./data/dog-breeds";

const prisma = new PrismaClient();
const breeds = [...dogBreeds, ...catBreeds];

/** canonical keyでupsertし、廃止候補も勝手に削除せず何度でも安全に同期する。 */
async function seedBreeds() {
  await prisma.$transaction(
    breeds.map((breed) =>
      prisma.breed.upsert({
        where: { species_nameJa: { species: breed.species, nameJa: breed.nameJa } },
        create: breed,
        update: {
          nameKana: breed.nameKana,
          nameEn: breed.nameEn,
          isPopular: breed.isPopular,
          sortOrder: breed.sortOrder
        }
      })
    )
  );

  // 移行済み自由入力はspeciesと正式日本語名が完全一致する場合だけマスタ参照へ寄せる。
  const canonicalBreeds = await prisma.breed.findMany({
    where: { isActive: true },
    select: { id: true, species: true, nameJa: true }
  });
  for (const breed of canonicalBreeds) {
    await prisma.pet.updateMany({
      where: {
        species: breed.species,
        breedId: null,
        customBreedName: breed.nameJa
      },
      data: { breedId: breed.id, customBreedName: null }
    });
  }

  console.log(`Breed seed完了: 犬種 ${dogBreeds.length}件 / 猫種 ${catBreeds.length}件`);
}

seedBreeds()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
