-- CreateTable
CREATE TABLE "breeds" (
    "id" TEXT NOT NULL,
    "species" "PetSpecies" NOT NULL,
    "name_ja" VARCHAR(100) NOT NULL,
    "name_kana" VARCHAR(100),
    "name_en" VARCHAR(100),
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "breeds_pkey" PRIMARY KEY ("id")
);

-- Existing free-text values are copied before the legacy column is removed.
ALTER TABLE "pets" ADD COLUMN "breed_id" TEXT;
ALTER TABLE "pets" ADD COLUMN "custom_breed_name" VARCHAR(100);
UPDATE "pets" SET "custom_breed_name" = "breed" WHERE "breed" IS NOT NULL;
ALTER TABLE "pets" DROP COLUMN "breed";

CREATE UNIQUE INDEX "breeds_species_name_ja_key" ON "breeds"("species", "name_ja");
CREATE INDEX "breeds_species_is_active_idx" ON "breeds"("species", "is_active");
CREATE INDEX "breeds_species_is_popular_sort_order_idx" ON "breeds"("species", "is_popular", "sort_order");
CREATE INDEX "pets_breed_id_idx" ON "pets"("breed_id");

-- A Pet may reference either a canonical breed or a free-text breed, never both.
ALTER TABLE "pets" ADD CONSTRAINT "pets_breed_choice_check"
CHECK (NOT ("breed_id" IS NOT NULL AND "custom_breed_name" IS NOT NULL));

-- Physical deletion is blocked while a Pet references a breed; normal retirement uses is_active.
ALTER TABLE "pets" ADD CONSTRAINT "pets_breed_id_fkey"
FOREIGN KEY ("breed_id") REFERENCES "breeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
