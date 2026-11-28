-- Reverse of consultation: dev/test or a reviewed rollback only. Drops every visit, vitals,
-- allergy and note. The guards are triggers on the tables, so they go with them.
DROP TABLE IF EXISTS "note_draft";
DROP TABLE IF EXISTS "visit_note_version";
DROP TABLE IF EXISTS "patient_allergy";
DROP TABLE IF EXISTS "vitals";
DROP TABLE IF EXISTS "visit";
DROP FUNCTION IF EXISTS clinical_same_lineage();
DROP FUNCTION IF EXISTS visit_guard();
DROP TYPE IF EXISTS "AllergyStatus";
DROP TYPE IF EXISTS "AllergySeverity";
DROP TYPE IF EXISTS "AllergyKind";
DROP TYPE IF EXISTS "VisitStatus";
DROP TYPE IF EXISTS "VisitType";
