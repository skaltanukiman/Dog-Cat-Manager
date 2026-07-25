-- Keep the contact polling fallback independent from process-local SSE state.
-- Business data and this monotonically increasing revision are updated in one transaction.
ALTER TABLE "contact_inquiries"
ADD COLUMN "realtime_revision" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "realtime_actor_client_id" VARCHAR(128),
ADD COLUMN "realtime_actor_user_id" TEXT;
