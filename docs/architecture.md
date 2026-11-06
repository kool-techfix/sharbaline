# HMS Phase 1 – Architecture

Status: v0.1, approved for slice 0 · Companion to `scope.md` (requirements) and `decisions.md` (why). If this file and the code disagree, fix one of them in the same change.

---

## 1. Folder structure

```
/docs/
  scope.md  architecture.md  decisions.md  design/*.png
  runbooks/                 failover, restore, power loss, user lockout
/src/
  app/
    (auth)/login, mfa, unlock/            no sidebar; usable when the server is unreachable
    (staff)/layout.tsx                    Sidebar + TopBar + ConnectionChip, role-based nav
      front-desk/   search, register, queue, patients/[patientId]/card
      nurse/        queue, visits/[visitId]/vitals
      consultation/[visitId]/  notes, vitals, diagnosis, tests, prescriptions
      patients/[patientId]/    timeline, documents      shared read views, permission-gated
      lab/          queue, orders/[orderId]
      pharmacy/     dispensing, stock, stock-take, reports
      admin/        users, audit, break-glass, stock-reviews, documents, status, reports
      */_components/                      UI used only by that route
    api/                                  only where server actions don't fit:
      files/  events/ (SSE)  health/  sync/
  components/
    ui/                     shadcn primitives
    Sidebar, TopBar, ConnectionChip, StatusChip, PatientHeader, AllergyChips, …
  server/
    config/        env.ts: Zod-validated environment (names, never values, in errors)
    db/            Prisma client (as hms_app), withTransaction() (READ COMMITTED)
    kernel/        defineService(): permission → Zod → transaction → audit. The only write path (D-017).
    log.ts         the only logger; fixed non-identifying fields
    permissions/   matrix.ts (mirrors scope §4.1), breakGlass.ts
    audit/
    auth/          password (argon2id), TOTP, sessions, rate limiting
    services/      users/ patients/ queue/ visits/ notes/ vitals/ allergies/ lab/ drugs/
                   stock/ prescriptions/ dispensing/ documents/ reports/ system/
    storage/       FileStore interface → local disk now, S3-compatible later
    realtime/      Postgres LISTEN/NOTIFY → SSE
  lib/
    validation/    Zod schemas shared by forms and services (no server imports)
    domain/        pure rules: Damm check digit, availability, FEFO allocation,
                   duplicate scoring, Lagos dates
    offline/       connection-state machine, encrypted IndexedDB cache, local draft store
    i18n/
  messages/en.json
  sw.ts            service worker
/prisma/
  schema.prisma
  migrations/<timestamp>_<name>/migration.sql + down.sql     (D-001, D-014)
  seed/            deterministic SYNTHETIC data generator
/scripts/db/       embedded PostgreSQL for dev/tests, down-migrations, migration check (D-015)
/deploy/
  postgres/init/01-roles.sql, 02-database.sql   shared by Docker init and scripts/db (D-016)
  postgres/postgresql.conf                      durability settings
  compose.yaml  proxy/Caddyfile  backup/  monitor-agent/  standby/   (deploy PR)
/tests/
  integration/helpers/   (createTestDatabase: per-file DB copied from a migrated template)
  permission-matrix/   e2e/
  (unit tests live next to source as *.test.ts)
```

---

## 2. Database schema (PostgreSQL via Prisma)

### 2.1 Conventions
- **Primary keys: client-generated UUIDv7.** Creates use `INSERT … ON CONFLICT (id) DO NOTHING`. If the row exists with the same actor and payload hash, the stored row is returned; otherwise the request gets 409.
- **`timestamptz`** everywhere (UTC). Lagos-local dates are derived only for the queue and reports.
- **Append-only tables** (marked `[AO]`): a trigger rejects UPDATE/DELETE, and the app DB role has INSERT + SELECT only. Corrections are new rows that reference the original.
- **Cached columns** (marked `(cache)`) are maintained in the same transaction as the append-only rows they summarise. Invariant tests check them.
- Custom SQL (triggers, CHECKs, trigram indexes, sequences, grants) lives in migrations, with a matching `down.sql` (D-001).

### 2.2 Users, auth, audit
```
User              id, staff_id UNIQUE, email UNIQUE, display_name, password_hash (argon2id),
                  must_change_password, failed_login_count, locked_until, disabled_at, created_at
UserRole          PK(user_id, role)   role enum: front_desk|nurse|doctor|lab|pharmacist|admin
MfaCredential     id, user_id, secret_encrypted, enabled_at, recovery_codes_hashed[], reset_at
Session           id, token_hash, user_id, device_id, active_role, created_at, last_seen_at,
                  locked_at, expires_at, revoked_at        checked per request
Device            id, label, registered_at, last_seen_at, wipe_requested_at
AuditLog [AO]     id, seq (chain order), occurred_at, actor_user_id, actor_role, session_id,
                  device_id, ip, action (dotted name, CHECK), resource_type, resource_id,
                  patient_id?, outcome (success|failure|denied|error), reason_code (CHECK),
                  request_id, metadata jsonb (object; field names/counts only),
                  prev_hash, hash                          (built in foundation PR; D-018)
                  break_glass_event_id? is added with break-glass
BreakGlassEvent [AO]   id, user_id, patient_id, reason, started_at, expires_at
BreakGlassReview [AO]  id, event_id, reviewer_id, outcome, comment, reviewed_at
HospitalSetting   key PK, value jsonb, updated_by, updated_at     (patient_id_prefix, thresholds…)
```
Permissions are defined in code (`server/permissions/matrix.ts`). The role × resource test suite is generated from that matrix.

### 2.3 Patients and queue
```
Patient           id, patient_number UNIQUE (immutable, trigger-enforced; D-003),
                  patient_seq (from sequence), legacy_card_number? (indexed, non-unique),
                  surname, first_name, other_names, sex, date_of_birth, dob_is_estimated,
                  phone_e164, address, name_search (normalised; pg_trgm GIN),
                  paper_folder_status (not_digitized|partial|digitized), priority_folder,
                  photo_storage_key?, consent_version, consent_recorded_at, consent_recorded_by,
                  possible_duplicate_of_id?, merged_into_id?     (D-010; merge is Phase 2)
                  created_at, created_by, updated_at
NextOfKin         id, patient_id, name, relationship, phone_e164
PatientAllergy [AO]
                  id, patient_id, allergen_group_id? | free_text, reaction, severity,
                  status (active|resolved|entered_in_error), reason?, supersedes_id?,
                  recorded_by, recorded_at                         (D-007)
DuplicateOverride [AO]  id, new_patient_id, suspected_patient_id, score, confirmed_by, at
QueueEntry        id, patient_id, queue_date (Lagos), position,
                  status (waiting|with_nurse|waiting_doctor|with_doctor|done|left), updated_at
```
Search: patient number (with or without prefix, check digit validated), `legacy_card_number`, phone, or trigram name match. Duplicate scoring (name similarity + DOB with tolerance if estimated + phone) is a pure function in `lib/domain`.

### 2.4 Visits, vitals, notes
```
Visit             id, patient_id, queue_entry_id?, attending_doctor_id?, visit_type,
                  status (open|closed), opened_at, closed_at
Vitals [AO]       id, visit_id, patient_id, temperature_c, pulse_bpm, resp_rate, bp_systolic,
                  bp_diastolic, spo2_pct, weight_kg, height_cm, note?,
                  entered_in_error bool, error_reason?, supersedes_id?,
                  recorded_by, recorded_at             CHECKs on plausible ranges (D-007)
VisitNoteVersion [AO]
                  id, visit_id, version_no, parent_version_id?, presenting_complaint, history,
                  examination, diagnosis_text, diagnosis_code?, plan, author_id, created_at,
                  is_conflict
NoteDraft         PK(visit_id, user_id), content jsonb, base_version_id, updated_at   (D-011)
```
Concurrent edits: each save sends the `parent_version_id` it was based on. If that version is no longer the newest, the new row is still stored with `is_conflict = true` and the UI shows both versions. Nothing is silently overwritten.

A vitals correction inserts a new row with `supersedes_id` pointing at the original. The original is shown as "entered in error" because a superseding row exists. The flag on the new row records why.

### 2.5 Lab
```
TestCatalogItem   id, code, name, specimen_type, result_template jsonb?, is_active
TestOrder         id, visit_id, patient_id, test_id, ordered_by, clinical_info, priority,
                  status (pending|in_progress|completed|cancelled), created_at, status_changed_at
TestResultDraft   PK(order_id), content jsonb, updated_by, updated_at
TestResult [AO]   id, order_id NOT NULL FK, result_text, structured jsonb?, attachment_key?,
                  attachment_sha256?, supersedes_id?, entered_by, released_at
ResultSeen        PK(result_id, user_id), seen_at
```
Lab reads `TestOrder` (including `clinical_info`) and patient identity only, never `VisitNoteVersion` (D-008). Releasing a result inserts the `TestResult` row and sends a NOTIFY → SSE to the ordering doctor (target ≤ 10 s).

### 2.6 Pharmacy
```
Drug              id, generic_name, brand_name?, strength, form, dispensing_unit,
                  alternative_group_id?, low_stock_threshold, is_active
DrugAlternativeGroup  id, name
AllergenGroup     id, name
DrugAllergen      PK(drug_id, allergen_group_id)
StockBatch        id, drug_id, batch_number, expiry_date, received_at, supplier?,
                  quantity_on_hand int CHECK (>= 0) (cache)
                  UNIQUE(drug_id, batch_number, expiry_date)
StockMovement [AO]
                  id, batch_id, drug_id, type (receive|dispense|adjust|expire),
                  quantity_delta int (CHECK sign matches type), reason,
                  dispense_record_id?, stock_take_id?, corrects_movement_id?,
                  requires_review bool, actor_id, occurred_at
StockMovementReview [AO]  id, movement_id, reviewer_id (admin), outcome, comment, reviewed_at
StockTake         id, started_by, started_at, completed_at
Prescription      id, rx_number, visit_id, patient_id, prescriber_id, sent_at
PrescriptionItem  id, prescription_id, drug_id, dose, route, frequency, duration_days,
                  quantity_prescribed, instructions,
                  availability_at_prescribing (in|low|out),
                  allergy_override_reason?, supersedes_item_id?,
                  status (pending|dispensed|partial|substituted|unavailable|cancelled),
                  quantity_dispensed (cache), cancelled_by?, cancelled_at?, cancel_reason?
PrescriptionDraft PK(visit_id, user_id), content jsonb, updated_at
AllergyOverrideAck [AO]  id, prescription_item_id, pharmacist_id, acknowledged_at
DispenseRecord [AO]
                  id, prescription_item_id, outcome (dispensed|partial|substituted|unavailable),
                  dispensed_drug_id, quantity, substitution_reason?, note?,
                  pharmacist_id, occurred_at
UnfilledEvent [AO]
                  id, prescription_item_id, drug_id, quantity_short,
                  source (at_prescribing|at_dispensing), occurred_at
```

**What the database and the service enforce:**
- **Stock never goes negative.** A dispense locks the drug's unexpired batches with `SELECT … FOR UPDATE ORDER BY expiry_date` (FEFO; D-006). In one transaction it allocates the quantity, inserts the movements, updates the `quantity_on_hand` cache, inserts the `DispenseRecord`, updates the item status and writes the audit entry. `CHECK (quantity_on_hand >= 0)` is the database backstop.
- **Ledger invariant.** For every batch, `quantity_on_hand = SUM(quantity_delta)`. It's covered by tests, and a nightly job checks it and alerts on drift.
- **Availability** (`in`/`low`/`out`) is computed only from unexpired batches against `low_stock_threshold`.
- **Item state changes** (cancel, amend, dispense) lock the `PrescriptionItem` row. Cancel and amend require `status = pending` and no `DispenseRecord` (D-009).
- **Substitution:** `dispensed_drug_id` must share the item drug's `alternative_group_id`, and `substitution_reason` is required.
- **Allergy override:** if `allergy_override_reason` is set, an `AllergyOverrideAck` must exist before any `DispenseRecord` for that item (D-005).
- **Dispensing errors:** an `adjust` movement with `corrects_movement_id` and `requires_review = true`. It appears in admin's review queue.
- **The prescriber role is never involved after sending.** Pharmacists never update the prescribing fields of `PrescriptionItem`.

### 2.7 Scanned documents and system
```
ScannedDocument   id, patient_id, visit_id?, document_type, document_date, page_count,
                  status (uploading|verified|failed), is_voided (cache),
                  uploaded_by, created_at
ScannedPage       id, document_id, page_index, storage_key, sha256, size_bytes, mime_type, rotation
DocumentVoidEvent [AO]  id, document_id, action (void|restore), reason, actor_id, occurred_at
BackupRun         id, kind (wal|nightly|restore_test), target (nas|cloud), started_at,
                  finished_at, outcome, detail
SyncState         target PK, last_success_at, pending_count, last_error_code
```
Voiding (D-009): uploaders (`front_desk`, `nurse`) can void their own uploads; admin can void or restore any. Voided documents are excluded from default queries but never deleted. Admin works from metadata only, and viewing pages needs break-glass.

---

## 3. Build order

Each slice: its own branch → plan → UI + API + DB → tests → review → merge.

| # | Slice | Contents |
|---|---|---|
| 0 | **Foundations** | Next.js + strict TS, pnpm, ESLint, Vitest against real Postgres, Playwright, CI (incl. migrate up/down/up). Docker Compose (`app`, `postgres` with durable config, `proxy` with LAN TLS) and basic WAL archiving to the NAS (D-013). Design tokens and shared components. `defineService` kernel, append-only trigger helper, audit writer, each with tests. |
| 1 | **M1 Auth, roles, audit** | Login, TOTP, auto-lock/unlock, sessions, lockout, admin users, break-glass and its review. Permission-matrix test generator. |
| 2 | **M2 Patient registry** | Patient numbers (prefix + sequence + Damm digit), legacy card number, registration, duplicate warning and override log, search, QR scan, CR80 card, daily queue. 100k synthetic seed to check search < 1 s. |
| 3 | **M5a Pharmacy core** | *Needs the re-exported Pharmacy-Stock.png.* Drug catalogue, alternative and allergen groups, batches, ledger, receive, stock-take, adjust, expire, compensating entries and admin review, alerts. SSE realtime channel. Concurrency and invariant tests. |
| 4 | **M3 Consultation + M5b Prescribing/Dispensing** | Visits, nurse vitals (with entered-in-error), allergies, versioned notes and conflict handling, encrypted local draft autosave (D-013), prescribing with live availability, alternatives and allergy override, cancel/amend while pending, dispensing queue with acknowledge/dispense/partial/substitute/unavailable, unfilled log. |
| 5 | **M4 Lab** | Test catalogue, order queue, result drafts, release, SSE to the doctor, "new result" indicator. |
| 6 | **M6 Scanned documents** | Upload with background progress, checksum check, lazy-loaded viewer, folder status and priority, void/restore. |
| 7 | **M7 Admin dashboard and reports** | Status cards, audit viewer, filled vs unfilled, stock and expiry reports. |
| 8 | **Availability layer** | PWA read-only cache (role-scoped, encrypted, expiring, wiped on logout), the full four-state connection chip, standby replication, cloud backup, restore-test automation, monitor agent. |
| 9 | **Hardening** | Performance on reference hardware, chaos tests, restore drill against RTO, staging pilot, parallel run. |

---

## 4. Open items carried forward
- Severe-allergy hard block: needs clinical sign-off (D-005).
- Pharmacist phone visibility: client review (D-004).
- Lab read access to allergies: scope §4.1 still gives `lab` R on allergies. D-008 describes lab's view as order details plus basic identity, so confirm whether lab should keep allergy access.
- Scope [CONFIRM] items not decided here: MFA for other roles, photo capture, retention period, languages, RPO/RTO.
