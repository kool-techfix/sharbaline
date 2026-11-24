-- Reverse of auth_login_mfa. Drops all accounts and sessions: dev/test or a reviewed rollback only.
DROP INDEX IF EXISTS "mfa_secret_one_active_per_user";
DROP TABLE IF EXISTS "session";
DROP TABLE IF EXISTS "device";
DROP TABLE IF EXISTS "recovery_code";
DROP TABLE IF EXISTS "mfa_secret";
DROP TABLE IF EXISTS "user_role";
DROP TABLE IF EXISTS "login_throttle";
DROP TABLE IF EXISTS "user";
DROP TYPE IF EXISTS "MfaStatus";
DROP TYPE IF EXISTS "SessionStage";
