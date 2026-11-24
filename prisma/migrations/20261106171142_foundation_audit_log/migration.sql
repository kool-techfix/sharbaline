-- Migration: foundation_audit_log
-- Prisma-generated DDL first, then hand-written SQL (D-001). Hand-written objects:
--   function  forbid_mutation()            reusable guard for every append-only table
--   function  audit_log_digest(bytea, audit_log)
--   function  audit_log_chain()            BEFORE INSERT: seq + hash chain
--   function  audit_log_verify_chain()     returns broken links (empty = intact)
--   sequence  audit_log_chain_seq
--   triggers  audit_log_chain, audit_log_no_update_delete, audit_log_no_truncate
--   checks    audit_log_chain_set, audit_log_action_format, audit_log_reason_code_format,
--             audit_log_metadata_object
--   grants    hms_app: SELECT, INSERT only on audit_log
-- Reverse: down.sql in this folder.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('front_desk', 'nurse', 'doctor', 'lab', 'pharmacist', 'admin');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('success', 'failure', 'denied', 'error');

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "seq" BIGINT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_role" "Role",
    "session_id" UUID,
    "device_id" UUID,
    "ip" INET,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "patient_id" UUID,
    "outcome" "AuditOutcome" NOT NULL,
    "reason_code" TEXT,
    "request_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "prev_hash" BYTEA,
    "hash" BYTEA,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_seq_key" ON "audit_log"("seq");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_occurred_at_idx" ON "audit_log"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_patient_id_occurred_at_idx" ON "audit_log"("patient_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_action_occurred_at_idx" ON "audit_log"("action", "occurred_at");


-- ===================== Hand-written SQL (not managed by Prisma) =====================

-- Columns filled by the chain trigger are optional in schema.prisma; enforce them here.
ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_chain_set"
    CHECK ("seq" IS NOT NULL AND "prev_hash" IS NOT NULL AND "hash" IS NOT NULL),
  -- Dotted machine names only ("auth.login", "patients.read"): no room for free text,
  -- which is where patient data would leak in.
  ADD CONSTRAINT "audit_log_action_format"
    CHECK ("action" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  ADD CONSTRAINT "audit_log_reason_code_format"
    CHECK ("reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT "audit_log_metadata_object"
    CHECK (jsonb_typeof("metadata") = 'object');

-- Reusable append-only guard. Attach to every append-only table (CLAUDE.md rule 9).
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'HM002';
END
$$;

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Tamper evidence: each row's hash covers the previous row's hash plus its own content.
-- Timestamps are hashed as epoch microseconds so the digest does not depend on the
-- session TimeZone; %L quotes values and renders NULL distinctly, so fields can't shift.
CREATE FUNCTION audit_log_digest(prev bytea, r "audit_log") RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
  SELECT sha256(prev || convert_to(format(
    '%s|%L|%s|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L',
    r.seq, r.id, (extract(epoch FROM r.occurred_at) * 1000000)::bigint,
    r.actor_user_id, r.actor_role, r.session_id, r.device_id, r.ip, r.action,
    r.resource_type, r.resource_id, r.patient_id, r.outcome, r.reason_code,
    r.request_id, r.metadata
  ), 'UTF8'))
$$;

CREATE SEQUENCE "audit_log_chain_seq" AS bigint;

-- seq is taken AFTER the advisory lock, so seq order is exactly chain order. The lock is
-- held to commit, so the "previous" row is always committed. Under READ COMMITTED each
-- statement in this function sees a fresh snapshot; REPEATABLE READ / SERIALIZABLE would
-- read a stale previous hash and fork the chain, so they are rejected.
CREATE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  previous bytea;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'audit_log inserts require READ COMMITTED isolation, got %',
      current_setting('transaction_isolation') USING ERRCODE = 'HM001';
  END IF;
  PERFORM pg_advisory_xact_lock(4871201001);  -- HMS audit chain lock key
  NEW.seq := nextval('audit_log_chain_seq');
  SELECT "hash" INTO previous FROM "audit_log" ORDER BY "seq" DESC LIMIT 1;
  NEW.prev_hash := COALESCE(previous, decode(repeat('00', 32), 'hex'));
  NEW.hash := audit_log_digest(NEW.prev_hash, NEW);
  RETURN NEW;
END
$$;

CREATE TRIGGER "audit_log_chain"
  BEFORE INSERT ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- Returns one row per broken link; no rows means the chain is intact.
-- Limitation: removing the newest rows is only detectable against an external anchor
-- (the latest hash recorded in backups), added with the backup service.
CREATE FUNCTION audit_log_verify_chain()
RETURNS TABLE (broken_seq bigint, problem text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r "audit_log";
  expected_prev bytea := decode(repeat('00', 32), 'hex');
BEGIN
  FOR r IN SELECT * FROM "audit_log" a ORDER BY a."seq" LOOP
    IF r.prev_hash IS DISTINCT FROM expected_prev THEN
      broken_seq := r.seq; problem := 'prev_hash_mismatch'; RETURN NEXT;
    END IF;
    IF r.hash IS DISTINCT FROM audit_log_digest(r.prev_hash, r) THEN
      broken_seq := r.seq; problem := 'hash_mismatch'; RETURN NEXT;
    END IF;
    expected_prev := r.hash;
  END LOOP;
END
$$;

-- The app role may only append and read. Default privileges granted UPDATE/DELETE;
-- take them back. Guarded so the migration also runs where the role doesn't exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_app') THEN
    REVOKE ALL ON "audit_log" FROM hms_app;
    GRANT SELECT, INSERT ON "audit_log" TO hms_app;
    GRANT USAGE ON SEQUENCE "audit_log_chain_seq" TO hms_app;
  END IF;
END
$$;
