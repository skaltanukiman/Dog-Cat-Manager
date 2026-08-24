ALTER TABLE "users"
ADD COLUMN "onboarding_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
ADD CONSTRAINT "users_onboarding_version_nonnegative_check"
CHECK ("onboarding_version" >= 0);
