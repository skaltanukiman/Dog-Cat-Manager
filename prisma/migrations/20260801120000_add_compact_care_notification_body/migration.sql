-- Existing users keep the current notification body until they explicitly enable compact display.
ALTER TABLE "app_settings"
  ADD COLUMN "careNotificationCompactBody" BOOLEAN NOT NULL DEFAULT false;
