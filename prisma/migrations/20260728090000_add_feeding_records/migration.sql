ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'FEEDING_MARKED';
ALTER TYPE "HouseholdActivityEvent" ADD VALUE 'FEEDING_UNMARKED';

CREATE TABLE "feeding_records" (
    "id" TEXT NOT NULL,
    "hamster_id" TEXT NOT NULL,
    "record_date" DATE NOT NULL,
    "fed_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feeding_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feeding_records_hamster_id_record_date_key"
ON "feeding_records"("hamster_id", "record_date");

CREATE INDEX "feeding_records_record_date_idx"
ON "feeding_records"("record_date");

CREATE INDEX "feeding_records_created_by_user_id_idx"
ON "feeding_records"("created_by_user_id");

ALTER TABLE "feeding_records" ADD CONSTRAINT "feeding_records_hamster_id_fkey"
FOREIGN KEY ("hamster_id") REFERENCES "hamsters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feeding_records" ADD CONSTRAINT "feeding_records_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
