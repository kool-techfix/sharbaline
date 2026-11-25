-- Reverse of patient_registry. Drops every patient and queue row: dev/test or a reviewed
-- rollback only. The delete guards are triggers, so they go first. pg_trgm stays: it belongs
-- to the database init, not to this migration.
DROP TRIGGER IF EXISTS "patient_no_delete" ON "patient";
DROP TRIGGER IF EXISTS "patient_no_truncate" ON "patient";
DROP TRIGGER IF EXISTS "next_of_kin_no_delete" ON "next_of_kin";
DROP TRIGGER IF EXISTS "next_of_kin_no_truncate" ON "next_of_kin";
DROP TRIGGER IF EXISTS "queue_entry_no_delete" ON "queue_entry";
DROP TRIGGER IF EXISTS "queue_entry_no_truncate" ON "queue_entry";
DROP INDEX IF EXISTS "patient_legacy_card_upper";
DROP TABLE IF EXISTS "queue_entry";
DROP TABLE IF EXISTS "duplicate_override";
DROP TABLE IF EXISTS "next_of_kin";
DROP TABLE IF EXISTS "patient";
DROP TABLE IF EXISTS "hospital_setting";
DROP SEQUENCE IF EXISTS "patient_number_seq";
DROP FUNCTION IF EXISTS forbid_delete();
DROP FUNCTION IF EXISTS patient_identity_immutable();
DROP TYPE IF EXISTS "QueueStatus";
DROP TYPE IF EXISTS "PaperFolderStatus";
DROP TYPE IF EXISTS "Sex";
