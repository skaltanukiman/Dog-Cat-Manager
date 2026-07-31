-- Existing users remain opted out because both notification flags default to false.
ALTER TABLE "app_settings"
  ADD COLUMN "feedingNotificationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "feedingDeadlineMinutes" INTEGER NOT NULL DEFAULT 1320,
  ADD COLUMN "feedingNotifyBeforeMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "waterNotificationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "waterDeadlineMinutes" INTEGER NOT NULL DEFAULT 1260,
  ADD COLUMN "waterNotifyBeforeMinutes" INTEGER NOT NULL DEFAULT 30;

CREATE TYPE "CareNotificationDispatchStatus" AS ENUM ('CLAIMED', 'SENT', 'RETRYABLE', 'SKIPPED');

CREATE TABLE "web_push_subscriptions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" VARCHAR(512),
  "last_success_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "care_notification_dispatches" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "household_id" TEXT NOT NULL,
  "target_date" DATE NOT NULL,
  "scheduled_minute" INTEGER NOT NULL,
  "status" "CareNotificationDispatchStatus" NOT NULL DEFAULT 'CLAIMED',
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "claim_token" TEXT NOT NULL,
  "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_expires_at" TIMESTAMP(3) NOT NULL,
  "next_attempt_at" TIMESTAMP(3),
  "last_attempt_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "care_notification_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");
CREATE INDEX "web_push_subscriptions_user_id_idx" ON "web_push_subscriptions"("user_id");
CREATE UNIQUE INDEX "care_notification_dispatches_user_id_household_id_target_date_scheduled_minute_key"
  ON "care_notification_dispatches"("user_id", "household_id", "target_date", "scheduled_minute");
CREATE INDEX "care_notification_dispatches_status_next_attempt_at_idx"
  ON "care_notification_dispatches"("status", "next_attempt_at");
CREATE INDEX "care_notification_dispatches_status_lease_expires_at_idx"
  ON "care_notification_dispatches"("status", "lease_expires_at");
CREATE INDEX "care_notification_dispatches_household_id_target_date_idx"
  ON "care_notification_dispatches"("household_id", "target_date");

ALTER TABLE "web_push_subscriptions"
  ADD CONSTRAINT "web_push_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_notification_dispatches"
  ADD CONSTRAINT "care_notification_dispatches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_notification_dispatches"
  ADD CONSTRAINT "care_notification_dispatches_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
