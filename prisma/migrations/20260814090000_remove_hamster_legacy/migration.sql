BEGIN;

-- Destructive cleanup is allowed only after every removed legacy table is confirmed empty.
DO $legacy_table_preflight$
DECLARE
  legacy_table TEXT;
  legacy_row_count BIGINT;
BEGIN
  FOREACH legacy_table IN ARRAY ARRAY[
    'hamsters',
    'cleaning_records',
    'feeding_records',
    'water_replacement_records',
    'weight_records',
    'dashboard_hamsters',
    'hamster_records',
    'health_record_details',
    'medical_visit_details',
    'memory_record_details',
    'memory_record_hamsters',
    'memory_record_images',
    'web_push_subscriptions',
    'care_notification_dispatches'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM %I', legacy_table) INTO legacy_row_count;

    IF legacy_row_count > 0 THEN
      RAISE EXCEPTION
        'Legacy removal aborted: table % contains % row(s). Review and migrate or remove the data manually before retrying.',
        legacy_table,
        legacy_row_count;
    END IF;
  END LOOP;
END;
$legacy_table_preflight$;

-- PostgreSQL enum values cannot be removed in place. Abort instead of deleting historical activity rows.
DO $legacy_activity_preflight$
DECLARE
  legacy_activity_count BIGINT;
BEGIN
  SELECT count(*)
  INTO legacy_activity_count
  FROM "household_activities"
  WHERE "event_type"::TEXT = ANY (ARRAY[
    'HAMSTER_CREATED',
    'HAMSTER_DELETED',
    'WEIGHT_CREATED',
    'WEIGHT_UPDATED',
    'WEIGHT_DELETED',
    'WEIGHTS_BULK_DELETED',
    'WEIGHT_CSV_APP_IMPORTED',
    'WEIGHT_CSV_GAS_IMPORTED',
    'CLEANING_MONTH_SAVED',
    'HEALTH_RECORD_CREATED',
    'HEALTH_RECORD_UPDATED',
    'HEALTH_RECORD_DELETED',
    'MEDICAL_RECORD_CREATED',
    'MEDICAL_RECORD_UPDATED',
    'MEDICAL_RECORD_DELETED',
    'MEMORY_RECORD_CREATED',
    'MEMORY_RECORD_UPDATED',
    'MEMORY_RECORD_DELETED',
    'HAMSTER_PROFILE_IMAGE_UPDATED',
    'HAMSTER_ACTIVE_STATUS_UPDATED',
    'FEEDING_MARKED',
    'FEEDING_UNMARKED',
    'WATER_REPLACEMENT_MARKED',
    'WATER_REPLACEMENT_UNMARKED'
  ]);

  IF legacy_activity_count > 0 THEN
    RAISE EXCEPTION
      'Legacy removal aborted: household_activities contains % legacy event row(s). Review the rows manually before retrying.',
      legacy_activity_count;
  END IF;
END;
$legacy_activity_preflight$;

DROP TABLE "memory_record_images";
DROP TABLE "memory_record_hamsters";
DROP TABLE "health_record_details";
DROP TABLE "medical_visit_details";
DROP TABLE "memory_record_details";
DROP TABLE "hamster_records";
DROP TABLE "dashboard_hamsters";
DROP TABLE "feeding_records";
DROP TABLE "water_replacement_records";
DROP TABLE "cleaning_records";
DROP TABLE "weight_records";
DROP TABLE "care_notification_dispatches";
DROP TABLE "web_push_subscriptions";
DROP TABLE "hamsters";

DROP TYPE "HamsterRecordType";
DROP TYPE "CareNotificationDispatchStatus";

ALTER TABLE "app_settings"
  DROP COLUMN "hamsterSelectorMode",
  DROP COLUMN "recordTimelineDefaultScope",
  DROP COLUMN "cleaningMobileDefaultDateFilter",
  DROP COLUMN "feedingNotificationEnabled",
  DROP COLUMN "feedingDeadlineMinutes",
  DROP COLUMN "feedingNotifyBeforeMinutes",
  DROP COLUMN "waterNotificationEnabled",
  DROP COLUMN "waterDeadlineMinutes",
  DROP COLUMN "waterNotifyBeforeMinutes",
  DROP COLUMN "careNotificationCompactBody";

ALTER TABLE "households" DROP COLUMN "demo_slug";

ALTER TABLE "household_activities"
  ALTER COLUMN "event_type" TYPE TEXT USING "event_type"::TEXT;

DROP TYPE "HouseholdActivityEvent";

CREATE TYPE "HouseholdActivityEvent" AS ENUM (
  'HOUSEHOLD_NAME_UPDATED',
  'INVITATION_CREATED',
  'INVITATION_REVOKED',
  'MEMBER_JOINED',
  'MEMBER_ROLE_UPDATED',
  'MEMBER_REMOVED',
  'MEMBER_LEFT',
  'OWNERSHIP_TRANSFERRED_AND_LEFT',
  'PET_WEIGHT_CREATED',
  'PET_WEIGHT_UPDATED',
  'PET_WEIGHT_DELETED',
  'PET_FEEDING_CREATED',
  'PET_FEEDING_UPDATED',
  'PET_FEEDING_DELETED',
  'PET_WATER_CREATED',
  'PET_WATER_UPDATED',
  'PET_WATER_DELETED',
  'PET_WALK_CREATED',
  'PET_WALK_UPDATED',
  'PET_WALK_DELETED',
  'PET_LITTER_CREATED',
  'PET_LITTER_UPDATED',
  'PET_LITTER_DELETED',
  'PET_HEALTH_RECORD_CREATED',
  'PET_HEALTH_RECORD_UPDATED',
  'PET_HEALTH_RECORD_DELETED',
  'PET_MEDICAL_RECORD_CREATED',
  'PET_MEDICAL_RECORD_UPDATED',
  'PET_MEDICAL_RECORD_DELETED',
  'PET_MEDICATION_RECORD_CREATED',
  'PET_MEDICATION_RECORD_UPDATED',
  'PET_MEDICATION_RECORD_DELETED',
  'PET_VACCINATION_RECORD_CREATED',
  'PET_VACCINATION_RECORD_UPDATED',
  'PET_VACCINATION_RECORD_DELETED',
  'PET_MEMORY_RECORD_CREATED',
  'PET_MEMORY_RECORD_UPDATED',
  'PET_MEMORY_RECORD_DELETED'
);

ALTER TABLE "household_activities"
  ALTER COLUMN "event_type" TYPE "HouseholdActivityEvent"
  USING "event_type"::"HouseholdActivityEvent";

COMMIT;
