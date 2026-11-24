-- Reverse of foundation_audit_log. Drops the audit log entirely: only ever run on
-- dev/test databases or as part of a reviewed rollback (docs/runbooks).
DROP TRIGGER IF EXISTS "audit_log_chain" ON "audit_log";
DROP TRIGGER IF EXISTS "audit_log_no_truncate" ON "audit_log";
DROP TRIGGER IF EXISTS "audit_log_no_update_delete" ON "audit_log";
DROP FUNCTION IF EXISTS audit_log_verify_chain();
DROP FUNCTION IF EXISTS audit_log_chain();
DROP FUNCTION IF EXISTS audit_log_digest(bytea, "audit_log");
DROP FUNCTION IF EXISTS forbid_mutation();
DROP TABLE IF EXISTS "audit_log";
DROP SEQUENCE IF EXISTS "audit_log_chain_seq";
DROP TYPE IF EXISTS "AuditOutcome";
DROP TYPE IF EXISTS "Role";
