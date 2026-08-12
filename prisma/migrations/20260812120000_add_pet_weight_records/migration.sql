-- AlterEnum
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WEIGHT_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WEIGHT_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_WEIGHT_DELETED';

-- CreateTable
CREATE TABLE "pet_weight_records" (
    "id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "record_date" DATE NOT NULL,
    "weight_kg" DECIMAL(5,2) NOT NULL,
    "memo" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_weight_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pet_weight_records_pet_id_record_date_key" ON "pet_weight_records"("pet_id", "record_date");

-- CreateIndex
CREATE INDEX "pet_weight_records_record_date_idx" ON "pet_weight_records"("record_date");

-- AddForeignKey
ALTER TABLE "pet_weight_records" ADD CONSTRAINT "pet_weight_records_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
