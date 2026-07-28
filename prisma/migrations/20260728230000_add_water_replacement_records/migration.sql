ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'WATER_REPLACEMENT_MARKED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'WATER_REPLACEMENT_UNMARKED';

CREATE TABLE "water_replacement_records" (
    "id" TEXT NOT NULL,
    "hamster_id" TEXT NOT NULL,
    "record_date" DATE NOT NULL,
    "replaced_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "water_replacement_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "water_replacement_records_hamster_id_record_date_key"
ON "water_replacement_records"("hamster_id", "record_date");

CREATE INDEX "water_replacement_records_record_date_idx"
ON "water_replacement_records"("record_date");

CREATE INDEX "water_replacement_records_created_by_user_id_idx"
ON "water_replacement_records"("created_by_user_id");

ALTER TABLE "water_replacement_records" ADD CONSTRAINT "water_replacement_records_hamster_id_fkey"
FOREIGN KEY ("hamster_id") REFERENCES "hamsters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "water_replacement_records" ADD CONSTRAINT "water_replacement_records_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
