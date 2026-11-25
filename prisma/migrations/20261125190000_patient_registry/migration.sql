-- Migration: patient_registry (M2)
-- Prisma-generated DDL first, then hand-written SQL (D-001). Hand-written objects:
--   extension pg_trgm (normally pre-created by deploy/postgres/init/02-database.sql)
--   sequence  patient_number_seq          patient numbers (D-003), assigned by the app
--   index     patient_name_search_trgm    GIN trigram index for fuzzy name search
--   index     patient_legacy_card_upper   case-insensitive legacy card lookup
--   function  patient_identity_immutable() + trigger: patient_number/seq/created_* never change
--   function  forbid_delete()             + triggers: patient rows are never deleted (rule 9)
--   triggers  duplicate_override append-only (forbid_mutation from foundation_audit_log)
--   checks    formats and lengths on patient, next_of_kin, duplicate_override, queue_entry,
--             hospital_setting
--   data      hospital_setting patient_number_prefix = "HSP" (placeholder; D-032)
--   grants    hms_app: no DELETE/TRUNCATE on any registry table, no UPDATE on duplicate_override
-- Reverse: down.sql in this folder.

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('female', 'male');

-- CreateEnum
CREATE TYPE "PaperFolderStatus" AS ENUM ('not_digitized', 'partial', 'digitized');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('waiting', 'with_nurse', 'waiting_doctor', 'with_doctor', 'done', 'left');

-- CreateTable
CREATE TABLE "hospital_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "patient" (
    "id" UUID NOT NULL,
    "patient_number" TEXT NOT NULL,
    "patient_seq" BIGINT NOT NULL,
    "legacy_card_number" TEXT,
    "surname" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "other_names" TEXT,
    "sex" "Sex" NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "dob_is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "phone_e164" TEXT,
    "address" TEXT,
    "name_search" TEXT NOT NULL,
    "paper_folder_status" "PaperFolderStatus" NOT NULL DEFAULT 'not_digitized',
    "priority_folder" BOOLEAN NOT NULL DEFAULT false,
    "photo_storage_key" TEXT,
    "consent_version" TEXT NOT NULL,
    "consent_recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "consent_recorded_by_id" UUID NOT NULL,
    "possible_duplicate_of_id" UUID,
    "merged_into_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,

    CONSTRAINT "patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "next_of_kin" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone_e164" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "next_of_kin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_override" (
    "id" UUID NOT NULL,
    "new_patient_id" UUID NOT NULL,
    "suspected_patient_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "confirmed_by_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entry" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "queue_date" DATE NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'waiting',
    "added_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,

    CONSTRAINT "queue_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_patient_number_key" ON "patient"("patient_number");

-- CreateIndex
CREATE UNIQUE INDEX "patient_patient_seq_key" ON "patient"("patient_seq");

-- CreateIndex
CREATE INDEX "patient_legacy_card_number_idx" ON "patient"("legacy_card_number");

-- CreateIndex
CREATE INDEX "patient_phone_e164_idx" ON "patient"("phone_e164");

-- CreateIndex
CREATE INDEX "patient_date_of_birth_idx" ON "patient"("date_of_birth");

-- CreateIndex
CREATE INDEX "next_of_kin_patient_id_idx" ON "next_of_kin"("patient_id");

-- CreateIndex
CREATE INDEX "duplicate_override_new_patient_id_idx" ON "duplicate_override"("new_patient_id");

-- CreateIndex
CREATE INDEX "duplicate_override_suspected_patient_id_idx" ON "duplicate_override"("suspected_patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entry_queue_date_patient_id_key" ON "queue_entry"("queue_date", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entry_queue_date_position_key" ON "queue_entry"("queue_date", "position");

-- AddForeignKey
ALTER TABLE "patient" ADD CONSTRAINT "patient_possible_duplicate_of_id_fkey" FOREIGN KEY ("possible_duplicate_of_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient" ADD CONSTRAINT "patient_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "next_of_kin" ADD CONSTRAINT "next_of_kin_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_override" ADD CONSTRAINT "duplicate_override_new_patient_id_fkey" FOREIGN KEY ("new_patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_override" ADD CONSTRAINT "duplicate_override_suspected_patient_id_fkey" FOREIGN KEY ("suspected_patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================== Hand-written SQL (not managed by Prisma) =====================

-- Fuzzy name search. Created by the database init as a superuser on the on-site server;
-- IF NOT EXISTS makes this a no-op there (D-032).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "patient_name_search_trgm" ON "patient" USING GIN ("name_search" gin_trgm_ops);
-- Old cards are typed in any case ("mc-77812" = "MC-77812").
CREATE INDEX "patient_legacy_card_upper" ON "patient" (upper("legacy_card_number"));

-- Patient numbers (D-003): the app takes nextval() inside the registration transaction and
-- appends the Damm check digit. Gaps after a rollback are harmless.
CREATE SEQUENCE "patient_number_seq" AS BIGINT START WITH 1000 MINVALUE 1 NO CYCLE;

ALTER TABLE "patient"
  ADD CONSTRAINT "patient_number_format" CHECK ("patient_number" ~ '^[A-Z]{2,6}-[0-9]{3,}$'),
  ADD CONSTRAINT "patient_seq_positive" CHECK ("patient_seq" > 0),
  ADD CONSTRAINT "patient_names_length" CHECK (
    char_length(btrim("surname")) BETWEEN 1 AND 100
    AND char_length(btrim("first_name")) BETWEEN 1 AND 100
    AND ("other_names" IS NULL OR char_length(btrim("other_names")) BETWEEN 1 AND 100)),
  ADD CONSTRAINT "patient_name_search_set" CHECK (char_length("name_search") > 0),
  ADD CONSTRAINT "patient_phone_e164" CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\+234[0-9]{8,10}$'),
  ADD CONSTRAINT "patient_dob_range" CHECK ("date_of_birth" >= DATE '1880-01-01'),
  ADD CONSTRAINT "patient_legacy_card_length" CHECK (
    "legacy_card_number" IS NULL OR char_length(btrim("legacy_card_number")) BETWEEN 1 AND 40),
  ADD CONSTRAINT "patient_address_length" CHECK ("address" IS NULL OR char_length("address") <= 300),
  ADD CONSTRAINT "patient_consent_version" CHECK (char_length("consent_version") BETWEEN 1 AND 40),
  ADD CONSTRAINT "patient_not_own_duplicate" CHECK ("possible_duplicate_of_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "patient_not_merged_into_self" CHECK ("merged_into_id" IS DISTINCT FROM "id");

ALTER TABLE "next_of_kin"
  ADD CONSTRAINT "next_of_kin_lengths" CHECK (
    char_length(btrim("name")) BETWEEN 1 AND 120 AND char_length(btrim("relationship")) BETWEEN 1 AND 60),
  ADD CONSTRAINT "next_of_kin_phone_e164" CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\+234[0-9]{8,10}$');

ALTER TABLE "duplicate_override"
  ADD CONSTRAINT "duplicate_override_score" CHECK ("score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "duplicate_override_distinct" CHECK ("new_patient_id" <> "suspected_patient_id");

ALTER TABLE "queue_entry"
  ADD CONSTRAINT "queue_entry_position_positive" CHECK ("position" > 0);

ALTER TABLE "hospital_setting"
  ADD CONSTRAINT "hospital_setting_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]*$');

-- A patient's number and registration facts never change (D-003). Applies to every role.
CREATE FUNCTION patient_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.patient_number IS DISTINCT FROM OLD.patient_number
     OR NEW.patient_seq IS DISTINCT FROM OLD.patient_seq
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id THEN
    RAISE EXCEPTION 'patient number and registration details cannot change' USING ERRCODE = 'HM003';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "patient_identity_immutable"
  BEFORE UPDATE ON "patient"
  FOR EACH ROW EXECUTE FUNCTION patient_identity_immutable();

-- Nothing patient-related is ever hard-deleted (CLAUDE.md rule 9). Triggers, not only grants,
-- so it holds for owner and superuser logins too (e.g. the shared test database, D-031).
CREATE FUNCTION forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: patient records are never deleted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'HM004';
END
$$;

CREATE TRIGGER "patient_no_delete" BEFORE DELETE ON "patient"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER "patient_no_truncate" BEFORE TRUNCATE ON "patient"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER "next_of_kin_no_delete" BEFORE DELETE ON "next_of_kin"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER "next_of_kin_no_truncate" BEFORE TRUNCATE ON "next_of_kin"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER "queue_entry_no_delete" BEFORE DELETE ON "queue_entry"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER "queue_entry_no_truncate" BEFORE TRUNCATE ON "queue_entry"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();

-- Duplicate overrides are evidence of a decision: append-only.
CREATE TRIGGER "duplicate_override_no_update_delete" BEFORE UPDATE OR DELETE ON "duplicate_override"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "duplicate_override_no_truncate" BEFORE TRUNCATE ON "duplicate_override"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Placeholder prefix until the hospital confirms its own (D-032). Must be set before go-live:
-- issued numbers never change.
INSERT INTO "hospital_setting" ("key", "value") VALUES ('patient_number_prefix', '"HSP"');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_app') THEN
    REVOKE DELETE, TRUNCATE ON "patient", "next_of_kin", "queue_entry", "duplicate_override", "hospital_setting"
      FROM hms_app;
    REVOKE UPDATE ON "duplicate_override" FROM hms_app;
  END IF;
END
$$;
