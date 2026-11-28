-- Migration: consultation (M3; D-007, D-011, D-037)
-- Prisma-generated DDL first, then hand-written SQL (D-001). Hand-written objects:
--   index     visit_one_open_per_patient (partial unique)
--   checks    visit_closed_consistent, vitals_*, patient_allergy_*, visit_note_version_*, note_draft_content_object
--   function  visit_guard()            identity fixed; a closed visit never changes again
--   function  clinical_same_lineage()  a correction/new version stays on the same patient/visit
--   triggers  append-only guards on vitals, patient_allergy, visit_note_version; no deletes on visit;
--             visit_guard; *_same_lineage
--   grants    hms_app: no UPDATE/DELETE/TRUNCATE on the append-only tables; no DELETE/TRUNCATE on
--             visit; full DML on note_draft (drafts are deleted when saved, D-011)
-- Safe on existing data: new tables only. Reverse: down.sql in this folder.
CREATE TYPE "VisitType" AS ENUM ('outpatient', 'follow_up', 'emergency');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "AllergyKind" AS ENUM ('allergy', 'no_known_allergies');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('mild', 'moderate', 'severe', 'unknown');

-- CreateEnum
CREATE TYPE "AllergyStatus" AS ENUM ('active', 'resolved', 'entered_in_error');

-- CreateTable
CREATE TABLE "visit" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "queue_entry_id" UUID,
    "visit_type" "VisitType" NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'open',
    "attending_doctor_id" UUID,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by_id" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by_id" UUID,

    CONSTRAINT "visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vitals" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "temperature_c" DECIMAL(4,1),
    "pulse_bpm" INTEGER,
    "resp_rate" INTEGER,
    "bp_systolic" INTEGER,
    "bp_diastolic" INTEGER,
    "spo2_pct" INTEGER,
    "weight_kg" DECIMAL(5,1),
    "height_cm" DECIMAL(4,1),
    "note" TEXT,
    "supersedes_id" UUID,
    "error_reason" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_allergy" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" "AllergyKind" NOT NULL,
    "allergen" TEXT,
    "reaction" TEXT,
    "severity" "AllergySeverity",
    "status" "AllergyStatus" NOT NULL,
    "supersedes_id" UUID,
    "reason" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_note_version" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "parent_version_id" UUID,
    "presenting_complaint" TEXT,
    "history" TEXT,
    "examination" TEXT,
    "diagnosis_text" TEXT,
    "plan" TEXT,
    "is_conflict" BOOLEAN NOT NULL DEFAULT false,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_note_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_draft" (
    "visit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "base_version_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_draft_pkey" PRIMARY KEY ("visit_id","user_id")
);

-- CreateIndex
CREATE INDEX "visit_patient_id_opened_at_idx" ON "visit"("patient_id", "opened_at");

-- CreateIndex
CREATE INDEX "visit_queue_entry_id_idx" ON "visit"("queue_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "vitals_supersedes_id_key" ON "vitals"("supersedes_id");

-- CreateIndex
CREATE INDEX "vitals_visit_id_recorded_at_idx" ON "vitals"("visit_id", "recorded_at");

-- CreateIndex
CREATE INDEX "vitals_patient_id_recorded_at_idx" ON "vitals"("patient_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_allergy_supersedes_id_key" ON "patient_allergy"("supersedes_id");

-- CreateIndex
CREATE INDEX "patient_allergy_patient_id_recorded_at_idx" ON "patient_allergy"("patient_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "visit_note_version_visit_id_version_no_key" ON "visit_note_version"("visit_id", "version_no");

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "vitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergy" ADD CONSTRAINT "patient_allergy_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergy" ADD CONSTRAINT "patient_allergy_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "patient_allergy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_note_version" ADD CONSTRAINT "visit_note_version_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_note_version" ADD CONSTRAINT "visit_note_version_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "visit_note_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_draft" ADD CONSTRAINT "note_draft_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ===================== Hand-written SQL (not managed by Prisma) =====================

CREATE UNIQUE INDEX "visit_one_open_per_patient" ON "visit" ("patient_id") WHERE "status" = 'open';

ALTER TABLE "visit"
  ADD CONSTRAINT "visit_closed_consistent" CHECK (
    ("status" = 'closed') = ("closed_at" IS NOT NULL AND "closed_by_id" IS NOT NULL)
    AND ("closed_at" IS NULL OR "closed_at" >= "opened_at"));

-- Plausible ranges catch typos (37 typed as 3.7 or 370). Pending clinical sign-off (D-037).
ALTER TABLE "vitals"
  ADD CONSTRAINT "vitals_temperature_range" CHECK ("temperature_c" IS NULL OR "temperature_c" BETWEEN 30 AND 45),
  ADD CONSTRAINT "vitals_pulse_range" CHECK ("pulse_bpm" IS NULL OR "pulse_bpm" BETWEEN 20 AND 250),
  ADD CONSTRAINT "vitals_resp_range" CHECK ("resp_rate" IS NULL OR "resp_rate" BETWEEN 4 AND 80),
  ADD CONSTRAINT "vitals_bp_range" CHECK (
    ("bp_systolic" IS NULL) = ("bp_diastolic" IS NULL)
    AND ("bp_systolic" IS NULL OR ("bp_systolic" BETWEEN 50 AND 260 AND "bp_diastolic" BETWEEN 20 AND 160
                                   AND "bp_systolic" > "bp_diastolic"))),
  ADD CONSTRAINT "vitals_spo2_range" CHECK ("spo2_pct" IS NULL OR "spo2_pct" BETWEEN 50 AND 100),
  ADD CONSTRAINT "vitals_weight_range" CHECK ("weight_kg" IS NULL OR "weight_kg" BETWEEN 0.3 AND 400),
  ADD CONSTRAINT "vitals_height_range" CHECK ("height_cm" IS NULL OR "height_cm" BETWEEN 20 AND 250),
  ADD CONSTRAINT "vitals_note_length" CHECK ("note" IS NULL OR char_length(btrim("note")) BETWEEN 1 AND 500),
  ADD CONSTRAINT "vitals_correction_reason" CHECK (
    ("supersedes_id" IS NULL) = ("error_reason" IS NULL)
    AND ("error_reason" IS NULL OR char_length(btrim("error_reason")) BETWEEN 3 AND 500)
    AND "supersedes_id" IS DISTINCT FROM "id"),
  -- A first entry measures something; a correction may only strike the original out.
  ADD CONSTRAINT "vitals_has_measurement" CHECK (
    "supersedes_id" IS NOT NULL
    OR num_nonnulls("temperature_c", "pulse_bpm", "resp_rate", "bp_systolic", "spo2_pct", "weight_kg", "height_cm") > 0);

ALTER TABLE "patient_allergy"
  ADD CONSTRAINT "patient_allergy_kind_fields" CHECK (
    ("kind" = 'allergy') = ("allergen" IS NOT NULL)
    AND ("kind" = 'allergy' OR ("reaction" IS NULL AND "severity" IS NULL))),
  ADD CONSTRAINT "patient_allergy_lengths" CHECK (
    ("allergen" IS NULL OR char_length(btrim("allergen")) BETWEEN 1 AND 100)
    AND ("reaction" IS NULL OR char_length(btrim("reaction")) BETWEEN 1 AND 200)
    AND ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 3 AND 500)),
  ADD CONSTRAINT "patient_allergy_error_reason" CHECK ("status" <> 'entered_in_error' OR "reason" IS NOT NULL),
  ADD CONSTRAINT "patient_allergy_not_self" CHECK ("supersedes_id" IS DISTINCT FROM "id");

ALTER TABLE "visit_note_version"
  ADD CONSTRAINT "visit_note_version_positive" CHECK ("version_no" > 0),
  ADD CONSTRAINT "visit_note_version_lengths" CHECK (
    char_length(coalesce("presenting_complaint", '')) <= 10000 AND char_length(coalesce("history", '')) <= 10000
    AND char_length(coalesce("examination", '')) <= 10000 AND char_length(coalesce("diagnosis_text", '')) <= 10000
    AND char_length(coalesce("plan", '')) <= 10000),
  ADD CONSTRAINT "visit_note_version_not_empty" CHECK (
    num_nonnulls("presenting_complaint", "history", "examination", "diagnosis_text", "plan") > 0),
  ADD CONSTRAINT "visit_note_version_not_own_parent" CHECK ("parent_version_id" IS DISTINCT FROM "id");

ALTER TABLE "note_draft"
  ADD CONSTRAINT "note_draft_content_object" CHECK (jsonb_typeof("content") = 'object');

-- A visit's identity never changes, and once closed nothing about it changes (rule 9).
CREATE FUNCTION visit_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.opened_by_id IS DISTINCT FROM OLD.opened_by_id THEN
    RAISE EXCEPTION 'a visit''s patient and opening details cannot change' USING ERRCODE = 'HM003';
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'a closed visit cannot change' USING ERRCODE = 'HM003';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "visit_guard" BEFORE UPDATE ON "visit"
  FOR EACH ROW EXECUTE FUNCTION visit_guard();

-- Corrections and new note versions stay with their original: same patient (and visit).
CREATE FUNCTION clinical_same_lineage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ok boolean := true;
BEGIN
  -- Branch on the table first: NEW only has the columns of the table that fired, and plpgsql
  -- doesn't short-circuit AND, so a column check must never sit beside a table check.
  IF TG_TABLE_NAME = 'vitals' THEN
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT (v.visit_id = NEW.visit_id AND v.patient_id = NEW.patient_id) INTO ok FROM vitals v WHERE v.id = NEW.supersedes_id;
    ELSE
      SELECT (v.patient_id = NEW.patient_id) INTO ok FROM visit v WHERE v.id = NEW.visit_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'patient_allergy' THEN
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT (a.patient_id = NEW.patient_id) INTO ok FROM patient_allergy a WHERE a.id = NEW.supersedes_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'visit_note_version' THEN
    IF NEW.parent_version_id IS NOT NULL THEN
      SELECT (n.visit_id = NEW.visit_id) INTO ok FROM visit_note_version n WHERE n.id = NEW.parent_version_id;
    END IF;
  END IF;
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION '% must stay with the same patient and visit as the row it follows', TG_TABLE_NAME
      USING ERRCODE = 'HM006';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "vitals_same_lineage" BEFORE INSERT ON "vitals"
  FOR EACH ROW EXECUTE FUNCTION clinical_same_lineage();
CREATE TRIGGER "patient_allergy_same_lineage" BEFORE INSERT ON "patient_allergy"
  FOR EACH ROW EXECUTE FUNCTION clinical_same_lineage();
CREATE TRIGGER "visit_note_version_same_lineage" BEFORE INSERT ON "visit_note_version"
  FOR EACH ROW EXECUTE FUNCTION clinical_same_lineage();

-- Append-only clinical tables (rule 9). Triggers, so it holds for every login.
CREATE TRIGGER "vitals_no_update_delete" BEFORE UPDATE OR DELETE ON "vitals"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "vitals_no_truncate" BEFORE TRUNCATE ON "vitals"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "patient_allergy_no_update_delete" BEFORE UPDATE OR DELETE ON "patient_allergy"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "patient_allergy_no_truncate" BEFORE TRUNCATE ON "patient_allergy"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "visit_note_version_no_update_delete" BEFORE UPDATE OR DELETE ON "visit_note_version"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "visit_note_version_no_truncate" BEFORE TRUNCATE ON "visit_note_version"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "visit_no_delete" BEFORE DELETE ON "visit"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER "visit_no_truncate" BEFORE TRUNCATE ON "visit"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "vitals", "patient_allergy", "visit_note_version" FROM hms_app;
    REVOKE DELETE, TRUNCATE ON "visit" FROM hms_app;
    REVOKE TRUNCATE ON "note_draft" FROM hms_app;
  END IF;
END
$$;
