-- 思い出1件を同じグループ内の複数ハムスターへ関連付ける中間テーブル。
CREATE TABLE "memory_record_hamsters" (
    "hamster_record_id" TEXT NOT NULL,
    "hamster_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "memory_record_hamsters_pkey" PRIMARY KEY ("hamster_record_id", "hamster_id")
);

-- 既存の思い出は従来の所属ハムスターを代表兼対象として1行だけ移行する。
INSERT INTO "memory_record_hamsters" ("hamster_record_id", "hamster_id", "sort_order")
SELECT memory."hamster_record_id", record."hamster_id", 0
FROM "memory_record_details" AS memory
INNER JOIN "hamster_records" AS record ON record."id" = memory."hamster_record_id"
WHERE record."record_type" = 'MEMORY'
ON CONFLICT ("hamster_record_id", "hamster_id") DO NOTHING;

-- バックフィル後に対象が空の既存思い出がないことをmigration内でも保証する。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "hamster_records" AS record
        INNER JOIN "memory_record_details" AS memory ON memory."hamster_record_id" = record."id"
        WHERE record."record_type" = 'MEMORY'
          AND NOT EXISTS (
              SELECT 1
              FROM "memory_record_hamsters" AS target
              WHERE target."hamster_record_id" = record."id"
          )
    ) THEN
        RAISE EXCEPTION 'Failed to backfill memory record hamsters';
    END IF;
END $$;

CREATE INDEX "memory_record_hamsters_hamster_id_idx" ON "memory_record_hamsters"("hamster_id");

ALTER TABLE "memory_record_hamsters"
ADD CONSTRAINT "memory_record_hamsters_hamster_record_id_fkey"
FOREIGN KEY ("hamster_record_id") REFERENCES "memory_record_details"("hamster_record_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memory_record_hamsters"
ADD CONSTRAINT "memory_record_hamsters_hamster_id_fkey"
FOREIGN KEY ("hamster_id") REFERENCES "hamsters"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
