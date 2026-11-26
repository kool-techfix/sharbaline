-- Reverse of break_glass: dev/test or a reviewed rollback only. Drops every break-glass event
-- and review. Audit rows written under break-glass lose their event id, so after this
-- audit_log_verify_chain() reports them as hash_mismatch: never roll back a database that
-- has recorded real break-glass access.
CREATE OR REPLACE FUNCTION audit_log_digest(prev bytea, r "audit_log") RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
  SELECT sha256(prev || convert_to(format(
    '%s|%L|%s|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L|%L',
    r.seq, r.id, (extract(epoch FROM r.occurred_at) * 1000000)::bigint,
    r.actor_user_id, r.actor_role, r.session_id, r.device_id, r.ip, r.action,
    r.resource_type, r.resource_id, r.patient_id, r.outcome, r.reason_code,
    r.request_id, r.metadata
  ), 'UTF8'))
$$;
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_break_glass_event_id_fkey";
DROP INDEX IF EXISTS "audit_log_break_glass_event_id_idx";
ALTER TABLE "audit_log" DROP COLUMN IF EXISTS "break_glass_event_id";
DROP TRIGGER IF EXISTS "break_glass_review_no_truncate" ON "break_glass_review";
DROP TRIGGER IF EXISTS "break_glass_review_no_update_delete" ON "break_glass_review";
DROP TRIGGER IF EXISTS "break_glass_review_not_self" ON "break_glass_review";
DROP TRIGGER IF EXISTS "break_glass_event_no_truncate" ON "break_glass_event";
DROP TRIGGER IF EXISTS "break_glass_event_no_delete" ON "break_glass_event";
DROP TRIGGER IF EXISTS "break_glass_event_guard" ON "break_glass_event";
DROP TABLE IF EXISTS "break_glass_review";
DROP TABLE IF EXISTS "break_glass_event";
DROP FUNCTION IF EXISTS break_glass_review_not_self();
DROP FUNCTION IF EXISTS break_glass_event_guard();
DROP TYPE IF EXISTS "BreakGlassReviewOutcome";
DROP TYPE IF EXISTS "BreakGlassReason";
