-- CreateEnum
CREATE TYPE "PetNotificationKind" AS ENUM ('FEEDING', 'WATER', 'WALK', 'LITTER_CLEANING');

-- CreateEnum
CREATE TYPE "CareNotificationDispatchStatus" AS ENUM ('CLAIMED', 'SENT', 'RETRYABLE', 'SKIPPED');

-- AlterTable
ALTER TABLE "app_settings"
ADD COLUMN "careNotificationCompactBody" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pet_notification_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "kind" "PetNotificationKind" NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "deadline_minutes" SMALLINT NOT NULL,
    "notify_before_minutes" SMALLINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_notification_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pet_notification_rules_deadline_minutes_check" CHECK ("deadline_minutes" BETWEEN 0 AND 1439),
    CONSTRAINT "pet_notification_rules_notify_before_minutes_check" CHECK ("notify_before_minutes" BETWEEN 0 AND 720),
    CONSTRAINT "pet_notification_rules_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 40)
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "care_notification_dispatches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "target_care_date" DATE NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "CareNotificationDispatchStatus" NOT NULL DEFAULT 'CLAIMED',
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "claim_token" VARCHAR(36) NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_notification_dispatches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "care_notification_dispatches_attempt_count_check" CHECK ("attempt_count" BETWEEN 1 AND 3)
);

-- CreateTable
CREATE TABLE "care_notification_deliveries" (
    "dispatch_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_notification_deliveries_pkey" PRIMARY KEY ("dispatch_id", "subscription_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pet_notification_rules_user_id_household_id_pet_id_kind_deadline_minutes_key"
ON "pet_notification_rules"("user_id", "household_id", "pet_id", "kind", "deadline_minutes");
CREATE INDEX "pet_notification_rules_user_id_household_id_pet_id_idx"
ON "pet_notification_rules"("user_id", "household_id", "pet_id");
CREATE INDEX "pet_notification_rules_household_id_enabled_idx"
ON "pet_notification_rules"("household_id", "enabled");
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");
CREATE INDEX "web_push_subscriptions_user_id_idx" ON "web_push_subscriptions"("user_id");
CREATE UNIQUE INDEX "care_notification_dispatches_user_id_household_id_target_care_date_scheduled_at_key"
ON "care_notification_dispatches"("user_id", "household_id", "target_care_date", "scheduled_at");
CREATE INDEX "care_notification_dispatches_status_next_attempt_at_idx"
ON "care_notification_dispatches"("status", "next_attempt_at");
CREATE INDEX "care_notification_dispatches_status_lease_expires_at_idx"
ON "care_notification_dispatches"("status", "lease_expires_at");
CREATE INDEX "care_notification_dispatches_household_id_target_care_date_idx"
ON "care_notification_dispatches"("household_id", "target_care_date");
CREATE INDEX "care_notification_deliveries_subscription_id_idx"
ON "care_notification_deliveries"("subscription_id");

-- AddForeignKey
ALTER TABLE "pet_notification_rules" ADD CONSTRAINT "pet_notification_rules_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pet_notification_rules" ADD CONSTRAINT "pet_notification_rules_household_id_fkey"
FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pet_notification_rules" ADD CONSTRAINT "pet_notification_rules_pet_id_fkey"
FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_notification_dispatches" ADD CONSTRAINT "care_notification_dispatches_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_notification_dispatches" ADD CONSTRAINT "care_notification_dispatches_household_id_fkey"
FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_notification_deliveries" ADD CONSTRAINT "care_notification_deliveries_dispatch_id_fkey"
FOREIGN KEY ("dispatch_id") REFERENCES "care_notification_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_notification_deliveries" ADD CONSTRAINT "care_notification_deliveries_subscription_id_fkey"
FOREIGN KEY ("subscription_id") REFERENCES "web_push_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
