-- CreateEnum
CREATE TYPE "PetRecordType" AS ENUM ('HEALTH', 'MEDICAL', 'MEDICATION', 'VACCINATION', 'MEMORY');

-- AlterEnum
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_HEALTH_RECORD_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_HEALTH_RECORD_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_HEALTH_RECORD_DELETED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEDICAL_RECORD_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEDICAL_RECORD_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEDICAL_RECORD_DELETED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEDICATION_RECORD_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEDICATION_RECORD_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEDICATION_RECORD_DELETED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_VACCINATION_RECORD_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_VACCINATION_RECORD_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_VACCINATION_RECORD_DELETED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEMORY_RECORD_CREATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEMORY_RECORD_UPDATED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'PET_MEMORY_RECORD_DELETED';

-- CreateTable
CREATE TABLE "pet_records" (
    "id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "record_type" "PetRecordType" NOT NULL,
    "record_date" DATE NOT NULL,
    "record_time_minutes" SMALLINT,
    "title" TEXT NOT NULL,
    "memo" TEXT,
    "search_text" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pet_records_record_time_minutes_check"
        CHECK ("record_time_minutes" IS NULL OR "record_time_minutes" BETWEEN 0 AND 1439)
);

-- CreateTable
CREATE TABLE "pet_health_record_details" (
    "pet_record_id" TEXT NOT NULL,
    "overall_condition" "HealthOverallCondition" NOT NULL,
    "appetite" "HealthAmountCondition" NOT NULL,
    "activity_level" "HealthAmountCondition" NOT NULL,
    "stool_condition" "HealthExcretionCondition" NOT NULL,
    "urine_condition" "HealthExcretionCondition" NOT NULL,
    "symptoms" "HealthSymptom"[] NOT NULL DEFAULT ARRAY[]::"HealthSymptom"[],

    CONSTRAINT "pet_health_record_details_pkey" PRIMARY KEY ("pet_record_id")
);

-- CreateTable
CREATE TABLE "pet_medical_visit_details" (
    "pet_record_id" TEXT NOT NULL,
    "hospital_name" TEXT,
    "reason" TEXT NOT NULL,
    "diagnosis" TEXT,
    "examination" TEXT,
    "treatment" TEXT,
    "medication" TEXT,
    "medication_instructions" TEXT,
    "next_visit_date" DATE,
    "consultation_fee" DECIMAL(10,0),

    CONSTRAINT "pet_medical_visit_details_pkey" PRIMARY KEY ("pet_record_id"),
    CONSTRAINT "pet_medical_visit_details_consultation_fee_check"
        CHECK ("consultation_fee" IS NULL OR "consultation_fee" >= 0)
);

-- CreateTable
CREATE TABLE "pet_medication_record_details" (
    "pet_record_id" TEXT NOT NULL,
    "medication_name" VARCHAR(200) NOT NULL,
    "dosage" VARCHAR(100),

    CONSTRAINT "pet_medication_record_details_pkey" PRIMARY KEY ("pet_record_id")
);

-- CreateTable
CREATE TABLE "pet_vaccination_record_details" (
    "pet_record_id" TEXT NOT NULL,
    "vaccine_name" VARCHAR(200) NOT NULL,
    "hospital_name" VARCHAR(200),
    "next_due_date" DATE,

    CONSTRAINT "pet_vaccination_record_details_pkey" PRIMARY KEY ("pet_record_id")
);

-- CreateTable
CREATE TABLE "pet_memory_record_details" (
    "pet_record_id" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "search_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pet_memory_record_details_pkey" PRIMARY KEY ("pet_record_id")
);

-- CreateTable
CREATE TABLE "pet_memory_record_pets" (
    "pet_record_id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pet_memory_record_pets_pkey" PRIMARY KEY ("pet_record_id", "pet_id")
);

-- CreateTable
CREATE TABLE "pet_memory_record_images" (
    "id" TEXT NOT NULL,
    "memory_record_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_memory_record_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_records_pet_id_record_date_record_time_minutes_created_at_idx"
    ON "pet_records"("pet_id", "record_date", "record_time_minutes", "created_at");

-- CreateIndex
CREATE INDEX "pet_records_pet_id_record_type_record_date_idx"
    ON "pet_records"("pet_id", "record_type", "record_date");

-- CreateIndex
CREATE INDEX "pet_records_search_text_trgm_idx"
    ON "pet_records" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "pet_medical_visit_details_next_visit_date_idx"
    ON "pet_medical_visit_details"("next_visit_date");

-- CreateIndex
CREATE INDEX "pet_vaccination_record_details_next_due_date_idx"
    ON "pet_vaccination_record_details"("next_due_date");

-- CreateIndex
CREATE INDEX "pet_memory_record_details_is_favorite_idx"
    ON "pet_memory_record_details"("is_favorite");

-- CreateIndex
CREATE INDEX "pet_memory_record_details_search_tags_idx"
    ON "pet_memory_record_details" USING GIN ("search_tags");

-- CreateIndex
CREATE INDEX "pet_memory_record_pets_pet_id_idx"
    ON "pet_memory_record_pets"("pet_id");

-- CreateIndex
CREATE UNIQUE INDEX "pet_memory_record_images_memory_record_id_sort_order_key"
    ON "pet_memory_record_images"("memory_record_id", "sort_order");

-- AddForeignKey
ALTER TABLE "pet_records" ADD CONSTRAINT "pet_records_pet_id_fkey"
    FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_records" ADD CONSTRAINT "pet_records_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_health_record_details" ADD CONSTRAINT "pet_health_record_details_pet_record_id_fkey"
    FOREIGN KEY ("pet_record_id") REFERENCES "pet_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_medical_visit_details" ADD CONSTRAINT "pet_medical_visit_details_pet_record_id_fkey"
    FOREIGN KEY ("pet_record_id") REFERENCES "pet_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_medication_record_details" ADD CONSTRAINT "pet_medication_record_details_pet_record_id_fkey"
    FOREIGN KEY ("pet_record_id") REFERENCES "pet_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_vaccination_record_details" ADD CONSTRAINT "pet_vaccination_record_details_pet_record_id_fkey"
    FOREIGN KEY ("pet_record_id") REFERENCES "pet_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_memory_record_details" ADD CONSTRAINT "pet_memory_record_details_pet_record_id_fkey"
    FOREIGN KEY ("pet_record_id") REFERENCES "pet_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_memory_record_pets" ADD CONSTRAINT "pet_memory_record_pets_pet_record_id_fkey"
    FOREIGN KEY ("pet_record_id") REFERENCES "pet_memory_record_details"("pet_record_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_memory_record_pets" ADD CONSTRAINT "pet_memory_record_pets_pet_id_fkey"
    FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_memory_record_images" ADD CONSTRAINT "pet_memory_record_images_memory_record_id_fkey"
    FOREIGN KEY ("memory_record_id") REFERENCES "pet_memory_record_details"("pet_record_id") ON DELETE CASCADE ON UPDATE CASCADE;
