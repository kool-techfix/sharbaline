-- Migration: break_glass (D-028, D-035)
-- Prisma-generated DDL first, then hand-written SQL (D-001). Hand-written objects:
--   checks    break_glass_event_reason_length, break_glass_event_window, break_glass_event_ended_in_window,
--             break_glass_review_comment
--   function  break_glass_event_guard()      only ended_at may change, once, from NULL
--   function  break_glass_review_not_self()  the reviewer is not the admin who broke the glass
--   function  audit_log_digest(bytea, audit_log)  REPLACED: also hashes break_glass_event_id when set
--   triggers  break_glass_event_guard, break_glass_event_no_delete, break_glass_event_no_truncate,
--             break_glass_review_not_self, break_glass_review_no_update_delete, break_glass_review_no_truncate
--   grants    hms_app: SELECT, INSERT on both tables, UPDATE (ended_at) on break_glass_event only
-- Safe on existing data: one nullable column on audit_log, two new tables. Old audit rows hash
-- exactly as before. Reverse: down.sql in this folder.
CREATE TYPE "BreakGlassReason" AS ENUM ('emergency_care', 'patient_request', 'complaint_investigation', 'records_correction', 'legal_regulatory', 'other');

-- CreateEnum
CREATE TYPE "BreakGlassReviewOutcome" AS ENUM ('appropriate', 'inappropriate', 'needs_follow_up');

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "break_glass_event_id" UUID;

-- CreateTable
CREATE TABLE "break_glass_event" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "reason_category" "BreakGlassReason" NOT NULL,
    "reason_details" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "break_glass_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_review" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "outcome" "BreakGlassReviewOutcome" NOT NULL,
    "comment" TEXT,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_glass_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "break_glass_event_user_id_session_id_patient_id_expires_at_idx" ON "break_glass_event"("user_id", "session_id", "patient_id", "expires_at");

-- CreateIndex
CREATE INDEX "break_glass_event_patient_id_started_at_idx" ON "break_glass_event"("patient_id", "started_at");

-- CreateIndex
CREATE INDEX "break_glass_event_started_at_idx" ON "break_glass_event"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "break_glass_review_event_id_key" ON "break_glass_review"("event_id");

-- CreateIndex
CREATE INDEX "audit_log_break_glass_event_id_idx" ON "audit_log"("break_glass_event_id");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_break_glass_event_id_fkey" FOREIGN KEY ("break_glass_event_id") REFERENCES "break_glass_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_event" ADD CONSTRAINT "break_glass_event_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_review" ADD CONSTRAINT "break_glass_review_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "break_glass_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ===================== Hand-written SQL (not managed by Prisma) =====================

ALTER TABLE "break_glass_event"
  ADD CONSTRAINT "break_glass_event_reason_length"
    CHECK (char_length(btrim("reason_details")) BETWEEN 10 AND 500),
  -- The service grants 30 minutes (D-035); the database refuses anything over an hour.
  ADD CONSTRAINT "break_glass_event_window"
    CHECK ("expires_at" > "started_at" AND "expires_at" <= "started_at" + interval '1 hour'),
  ADD CONSTRAINT "break_glass_event_ended_in_window"
    CHECK ("ended_at" IS NULL OR ("ended_at" >= "started_at" AND "ended_at" <= "expires_at"));

ALTER TABLE "break_glass_review"
  ADD CONSTRAINT "break_glass_review_comment" CHECK (
    ("comment" IS NULL OR char_length(btrim("comment")) BETWEEN 1 AND 1000)
    AND ("outcome" = 'appropriate' OR "comment" IS NOT NULL));

-- An event is evidence: nothing about it changes, except that it can be ended early, once.
CREATE FUNCTION break_glass_event_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
     OR (to_jsonb(NEW) - 'ended_at') IS DISTINCT FROM (to_jsonb(OLD) - 'ended_at') THEN
    RAISE EXCEPTION 'UPDATE on break_glass_event may only end it once' USING ERRCODE = 'HM002';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "break_glass_event_guard" BEFORE UPDATE ON "break_glass_event"
  FOR EACH ROW EXECUTE FUNCTION break_glass_event_guard();
CREATE TRIGGER "break_glass_event_no_delete" BEFORE DELETE ON "break_glass_event"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "break_glass_event_no_truncate" BEFORE TRUNCATE ON "break_glass_event"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Self-review is refused by the service too; this holds for every login (D-035).
CREATE FUNCTION break_glass_review_not_self() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "break_glass_event" e WHERE e.id = NEW.event_id AND e.user_id = NEW.reviewer_id) THEN
    RAISE EXCEPTION 'a break-glass event must be reviewed by a different admin' USING ERRCODE = 'HM005';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "break_glass_review_not_self" BEFORE INSERT ON "break_glass_review"
  FOR EACH ROW EXECUTE FUNCTION break_glass_review_not_self();
CREATE TRIGGER "break_glass_review_no_update_delete" BEFORE UPDATE OR DELETE ON "break_glass_review"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "break_glass_review_no_truncate" BEFORE TRUNCATE ON "break_glass_review"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- The audit hash also covers break_glass_event_id, but only when it is set: rows written before
-- this migration (and every row without break-glass) produce exactly the digest they had, so
-- audit_log_verify_chain() keeps passing over the whole history.
CREATE OR REPLACE FUNCTION audit_log_digest(prev bytea, r "audit_log") RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
  SELECT sha256(prev || convert_to(format(
    '%s|%L|%s|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L',
    r.seq, r.id, (extract(epoch FROM r.occurred_at) * 1000000)::bigint,
    r.actor_user_id, r.actor_role, r.session_id, r.device_id, r.ip, r.action,
    r.resource_type, r.resource_id, r.patient_id, r.outcome, r.reason_code,
    r.request_id, r.metadata
  ) || CASE WHEN r.break_glass_event_id IS NULL THEN '' ELSE format('|bg:%L', r.break_glass_event_id) END,
  'UTF8'))
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_app') THEN
    REVOKE ALL ON "break_glass_event", "break_glass_review" FROM hms_app;
    GRANT SELECT, INSERT ON "break_glass_event", "break_glass_review" TO hms_app;
    GRANT UPDATE ("ended_at") ON "break_glass_event" TO hms_app;
  END IF;
END
$$;
