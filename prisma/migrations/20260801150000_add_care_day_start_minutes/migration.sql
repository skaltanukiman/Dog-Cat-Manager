-- Existing households keep the current JST midnight boundary.
ALTER TABLE "households"
  ADD COLUMN "care_day_start_minutes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "households"
  ADD CONSTRAINT "households_care_day_start_minutes_check"
  CHECK ("care_day_start_minutes" BETWEEN 0 AND 1439);
