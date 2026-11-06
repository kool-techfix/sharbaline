-- Cluster-level roles for the HMS. Run once per cluster as a superuser.
-- Uses psql variables so the same file serves the Docker init script (psql -v)
-- and the dev/test runner (scripts/db/bootstrap.ts substitutes them safely).
--
--   hms_owner  owns the schema; used only by migrations.
--   hms_app    used by the running app: DML only, never DDL. Append-only tables
--              additionally revoke UPDATE/DELETE/TRUNCATE from it in their migration.

CREATE ROLE hms_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE hms_app LOGIN PASSWORD :'app_password';
