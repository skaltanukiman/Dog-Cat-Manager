-- CreateEnum
CREATE TYPE "PetLitterAction" AS ENUM ('URINATION', 'DEFECATION', 'BOTH', 'CLEANED');

-- AlterEnum
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WALK_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WALK_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WALK_DELETED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_LITTER_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_LITTER_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_LITTER_DELETED';

-- CreateTable
CREATE TABLE "pet_walk_records" (
    "id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "record_date" DATE NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER,
    "memo" VARCHAR(500),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_walk_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_litter_records" (
    "id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "record_date" DATE NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "action" "PetLitterAction" NOT NULL,
    "memo" VARCHAR(500),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_litter_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_walk_records_pet_id_record_date_started_at_idx" ON "pet_walk_records"("pet_id", "record_date", "started_at");

-- CreateIndex
CREATE INDEX "pet_walk_records_created_by_user_id_idx" ON "pet_walk_records"("created_by_user_id");

-- CreateIndex
CREATE INDEX "pet_litter_records_pet_id_record_date_occurred_at_idx" ON "pet_litter_records"("pet_id", "record_date", "occurred_at");

-- CreateIndex
CREATE INDEX "pet_litter_records_created_by_user_id_idx" ON "pet_litter_records"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "pet_walk_records" ADD CONSTRAINT "pet_walk_records_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_walk_records" ADD CONSTRAINT "pet_walk_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_litter_records" ADD CONSTRAINT "pet_litter_records_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_litter_records" ADD CONSTRAINT "pet_litter_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
