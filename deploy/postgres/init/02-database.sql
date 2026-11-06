-- Per-database privileges. Run as a superuser while connected to the HMS database,
-- after the database has been created with OWNER hms_owner.

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO hms_owner;
GRANT USAGE ON SCHEMA public TO hms_app;

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO hms_owner, hms_app', current_database());
END
$$;

-- Objects created later by migrations (running as hms_owner) are usable by hms_app.
ALTER DEFAULT PRIVILEGES FOR ROLE hms_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hms_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hms_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hms_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO hms_app;
