-- CreateEnum
CREATE TYPE "PetWaterAction" AS ENUM ('REPLACED', 'REFILLED');

-- AlterEnum
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_FEEDING_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_FEEDING_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_FEEDING_DELETED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WATER_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WATER_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WATER_DELETED';

-- CreateTable
CREATE TABLE "pet_feeding_records" (
    "id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "record_date" DATE NOT NULL,
    "fed_at" TIMESTAMP(3) NOT NULL,
    "memo" VARCHAR(500),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_feeding_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_water_records" (
    "id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "record_date" DATE NOT NULL,
    "cared_at" TIMESTAMP(3) NOT NULL,
    "action" "PetWaterAction" NOT NULL,
    "memo" VARCHAR(500),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_water_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_feeding_records_pet_id_record_date_fed_at_idx" ON "pet_feeding_records"("pet_id", "record_date", "fed_at");

-- CreateIndex
CREATE INDEX "pet_feeding_records_created_by_user_id_idx" ON "pet_feeding_records"("created_by_user_id");

-- CreateIndex
CREATE INDEX "pet_water_records_pet_id_record_date_cared_at_idx" ON "pet_water_records"("pet_id", "record_date", "cared_at");

-- CreateIndex
CREATE INDEX "pet_water_records_created_by_user_id_idx" ON "pet_water_records"("created_by_user_id");

-- AddForeignKey
ALTER TABLE "pet_feeding_records" ADD CONSTRAINT "pet_feeding_records_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_feeding_records" ADD CONSTRAINT "pet_feeding_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_water_records" ADD CONSTRAINT "pet_water_records_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_water_records" ADD CONSTRAINT "pet_water_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
