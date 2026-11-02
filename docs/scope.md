# Hospital Management System (HMS) – Phase 1 Engineering Scope

Status: Draft v0.1 · Audience: developers (and Claude Code) · Companion to the client-facing Scope of Work.
Place this file at `/docs/scope.md`. Anything marked **[CONFIRM]** needs a decision or client input.

---

## 1. Why this exists

Two observed problems at the client hospital drive Phase 1:

1. **Paper patient folders.** One physical folder per patient on shelves, found via a mini card, handed to the doctor. Single copy, can be lost, misfiled or damaged (some folders are already torn/old), no backup, and only the folder's contents are visible to the doctor.
2. **No link between doctors and pharmacy.** Doctors prescribe without seeing pharmacy stock. Patients reach the pharmacy and find a drug unavailable. Nothing records the unmet demand.

## 2. Guiding principles (these are requirements, not slogans)

| Principle | Engineering meaning |
|---|---|
| **Availability** | Records reachable at all times: internet down, slow network, power interruptions, single-machine failure. No single failure loses data or stops the hospital working. |
| **Accessibility** | Simple role-specific screens, minimal typing, works on modest laptops and slow networks, WCAG 2.1 AA, large touch/click targets. |
| **Security** | Least-privilege access, every access audited, encryption in transit and at rest, NDPA-aligned handling of patient data. |

When principles conflict (e.g. offline cache vs. data-at-rest risk), security wins by default and the trade-off is recorded in `/docs/decisions.md`.

## 3. Operating context

- The **hospital owns the hardware and runs the system daily**. **We develop and maintain** the software remotely.
- Target deployment: a small **on-site server** on the hospital LAN (primary) plus a **standby server** (replica), a local backup NAS, and an **encrypted cloud backup/sync copy**.
- The hospital has a backup generator. UPS units bridge the switchover gap. Power can still drop abruptly, so crash-safety is mandatory.
- Internet is unreliable. The LAN is the system's backbone; the cloud is for backup and remote support, not for live operation.
- Reference hardware: Dell PowerEdge T160 (primary and standby), Synology DS225+ (backup), APC Smart-UPS SMT1500IC, TP-Link Omada networking, ThinkPad-class laptops, Zebra DS2208 scanners, Zebra ZC300 card printer, Epson V600 flatbed and Ricoh fi-8150 document scanners.
- Baseline size: about 8 workstations. **[CONFIRM]** patient volume, department counts, in-house pharmacy/lab.

## 4. Users and roles

| Role | Primary job in the system |
|---|---|
| `front_desk` | Register patients, find records, print cards, manage the daily queue |
| `nurse` | Record vitals, view the patient record, assist consultation |
| `doctor` | Review history, write notes/diagnosis, order tests, prescribe |
| `lab` | Work the test queue, enter/attach results |
| `pharmacist` | Manage stock, dispense prescriptions, log unavailable items |
| `admin` | Manage users, view audit log and system status; no routine clinical access |

### 4.1 Permission matrix

C = create, R = read, U = update, C\* = correct by appending a new row (never an in-place edit; see D-007), – = none. Decision references (D-NNN) point to `/docs/decisions.md`.

| Resource | front_desk | nurse | doctor | lab | pharmacist | admin |
|---|---|---|---|---|---|---|
| Patient demographics | C R U | R | R U | R (basic identity) | R (limited) | R |
| Allergies / alerts | R | C R C\* | C R C\* | R | R | – |
| Visit / consultation notes | – | R | C R U | – | – | – |
| Vitals | – | C R C\* | R | – | – | – |
| Test orders (incl. clinical information) | – | R | C R | R U | – | – |
| Test results | – | R | R | C R U | – | – |
| Prescriptions | – | R | C R, cancel/amend while pending | – | R, dispense | – |
| Allergy override acknowledgement | – | – | – | – | C R | – |
| Drug catalogue and stock | – | R | R (availability only) | – | C R U | R |
| Stock corrections flagged for review | – | – | – | – | C R | R, review |
| Scanned documents | C R, void own | C R, void own | R | – | – | Metadata R, void any, restore |
| Users and roles | – | – | – | – | – | C R U |
| Audit log | – | – | – | – | – | R |
| System status | – | – | – | – | – | R |

- **Pharmacist "limited" view of demographics:** name, age, sex, patient ID, allergies. Nothing else, and specifically **no phone number**, even though the Pharmacy-Dispensing design shows one (D-004; raising with the client as a possible matrix change).
- **Lab "basic identity":** name, age, sex, patient ID. Lab sees the test order including the doctor's clinical-information field for that order, and **never the consultation notes** (D-008).
- **Vitals and allergies are append-only** (D-007). A vitals correction is a new row marking the original "entered in error" with a reason. Allergies carry a status (active, resolved, entered in error); changes add a new row. Nothing is deleted.
- **Prescriptions** (D-009): any doctor can cancel or amend an item only while it is still pending; after any dispensing, a change is a new prescription. Pharmacists dispense, partially dispense, substitute (same alternative group only, with a reason) or log as unavailable, and never edit prescriptions.
- **Allergy override** (D-005): prescribing a drug that matches an active allergy requires an override reason; the pharmacist must acknowledge the override before dispensing that line. Whether severe allergies hard-block needs hospital clinical sign-off.
- **Dispensing errors** (D-009): the pharmacist records a compensating stock movement with a reason; it is flagged for admin review. The original movement is never changed.
- **Scanned documents** (D-009): front_desk and nurse can void their own uploads; admin can void any and is the only role that can restore. Voided scans are hidden by default and never deleted. Admin works from metadata; viewing page images is clinical access and needs break-glass.
- Admin reading a clinical record is a **break-glass** action: requires a reason, is flagged, and is reviewed.
- Permissions are enforced server-side on every endpoint. Hiding UI is not enforcement.

## 5. Phase 1 scope

### 5.1 In scope

#### M1. Authentication, roles, audit (build first)
- Email/staff-ID + password login. **MFA** (TOTP) required for `doctor`, `pharmacist`, `admin`; strongly encouraged for others **[CONFIRM]**.
- Session auto-lock after inactivity (default 10 min), quick re-unlock with password.
- Role-based navigation and server-side permission checks.
- Append-only **audit log**: who, what, which record, when, from which device, outcome. Written for reads of patient records as well as changes.
- **Break-glass** access flow with mandatory reason and later review.
- Admin console: create/disable users, assign roles, reset MFA.

**Acceptance criteria**
- A user without the permission receives 403 for every protected endpoint (automated test per role × resource).
- Every patient-record read and write produces an audit entry; audit entries cannot be edited or deleted via the app.
- Disabling a user terminates their active sessions within 1 minute.

#### M2. Patient registry
- Unique, immutable patient ID: configurable hospital prefix + sequential number + Damm check digit as the last digit (e.g. `HSP-2073` + check digit; D-003), and a **QR code** encoding the ID only (no personal data).
- Searchable `legacyCardNumber` for the number on existing mini cards; paper folders stay filed by it during the parallel run (D-003).
- Registration form: name, sex, date of birth, phone, address, next of kin, optional photo **[CONFIRM]**.
- Search by name (fuzzy), phone, ID, or QR scan.
- **Duplicate detection** at registration (name + DOB + phone similarity) with a warning and link to the possible match.
- Printable patient card (CR80) with name, ID and QR.
- Daily queue: add a patient to today's queue, see queue status.

**Acceptance criteria**
- Search returns results in under 1 s with 100,000 patients on reference hardware.
- Scanning a QR card opens the correct patient in under 2 s.
- Registering a likely duplicate always shows the warning; the user can still proceed with explicit confirmation (logged). Merging duplicates is Phase 2; the schema carries `possibleDuplicateOf` and `mergedInto` now (D-010).

#### M3. Consultation
- Patient header: name, age, sex, ID, allergies as prominent chips.
- **Visit history timeline** (all previous visits, newest first, expandable).
- Record: complaints, vitals (from nurse), examination notes, diagnosis.
- Order tests (from a catalogue) and write prescriptions (see M5 for stock integration).
- **Draft autosave** (server when reachable, local when not) with visible "Saved" indicator.
- Notes are **versioned/append-only**: edits create a new version; prior versions remain viewable by authorized roles.

**Acceptance criteria**
- Killing the browser mid-note and reopening restores the draft.
- Two users editing the same visit cannot silently overwrite each other (conflict shown, both versions kept).

#### M4. Test orders and results (basic)
- Doctor creates test orders; lab sees a queue (Pending, In progress, Completed).
- Lab enters a result (structured text and/or file attachment) and releases it to the doctor.
- Doctor sees results in the patient's timeline with a "new result" indicator.

**Acceptance criteria**
- A result can only be attached to an existing order, and only `lab` can create results.
- Released results appear in the ordering doctor's view without page refresh within 10 s on LAN.

#### M5. Pharmacy stock and prescriptions (core value, build early)
- Drug catalogue (name, strength, form, unit), stock held per **batch** with quantity and **expiry**; dispensed first-expiry-first-out; expired batches never count as available (D-006).
- Stock movements are an **append-only ledger** (receive, dispense, adjust, expire) with reason and user.
- While prescribing, the doctor sees **live availability** per drug: `In stock`, `Low stock`, `Out of stock`, with suggested alternatives (same generic/class defined in the catalogue).
- Pharmacist dispensing queue of electronic prescriptions. Per line: **Dispense**, **Partial**, **Substitute**, or **Log as unavailable**.
- Dispensing decrements stock **atomically** with the dispensing record.
- Alerts: low stock (per-drug threshold), expiring soon (default 90 days).
- **Unfilled prescription log** and report (what was prescribed but unavailable, how often).
- Guided stock count (initial stock take) and adjustment flow.

**Acceptance criteria**
- Stock quantity can never go negative, including under concurrent dispensing (concurrency test).
- Every stock change is traceable to a ledger entry; the sum of the ledger equals the current quantity (invariant test).
- Prescribing an out-of-stock drug is allowed but shows the warning and alternatives, and the shortage is logged.

#### M6. Scanned documents (digitized folders)
- Upload images/PDFs from scanners and attach them to a patient (and optionally a visit), with document type and date.
- Viewer with thumbnails, zoom, rotate, and page ordering.
- Backfill workflow: when a returning patient arrives and has a paper folder, staff scan it and attach during/after the visit. Track a per-patient flag: `paper folder digitized: yes / partial / no`.
- Torn/old folders are prioritized (flag on patient record).
- Files stored on server disk (or S3-compatible store behind an interface), checksummed, included in backups.

**Acceptance criteria**
- Uploading a 20-page scan completes without blocking other work, and the file's checksum is verified after write.
- Scanned documents are visible only to `front_desk`, `nurse`, `doctor`, and are audited on view.

#### M7. Admin and system status
- Dashboard cards: connection state, last sync, last successful backup, next backup, disk usage, UPS/power state if reported, server health.
- Audit log viewer with filters (user, patient, date, action).
- Reports: daily visits, prescriptions filled vs. unfilled, stock levels and expiring items.
- Alert banner for failures (e.g. backup failed).

### 5.2 Out of scope for Phase 1
- Billing, invoicing, insurance/HMO claims
- Inpatient, ward and bed management
- Lab/radiology equipment integration
- Patient portal; automated SMS/WhatsApp reminders
- Full upfront digitization of all historical paper folders
- Full offline **writes** on every device (Phase 1 provides a read-only offline cache; see section 7)

## 6. Architecture

### 6.1 Overview
Web application (installable PWA) served by the on-site server. Workstations use a browser over the LAN. Cloud is a backup and sync target, never required for daily operation.

```
Workstations (browser/PWA) ──LAN──> Reverse proxy ──> App ──> PostgreSQL (primary)
                                                       │            │
                                                       │            └─ WAL archive ─> NAS + encrypted cloud
                                                       └─ File store ─ checksummed ─> NAS + encrypted cloud
Standby server <── streaming replication ── PostgreSQL (primary)
```

### 6.2 Proposed stack **[CONFIRM]**
- Next.js (App Router) + TypeScript, Tailwind CSS, shadcn/ui
- PostgreSQL with Prisma (D-001); pnpm (D-002)
- Zod for validation on every input boundary
- Playwright (e2e), Vitest (unit/integration)
- Docker Compose for the on-site deployment: `app`, `postgres`, `proxy` (e.g. Caddy), `backup`, `monitor-agent`
- PWA with a service worker and IndexedDB for the offline read cache
- Self-hosted authentication logic (no dependence on a third-party identity service being reachable)

### 6.3 Key design rules
- **LAN-first:** no feature may require internet access to function. Anything that calls out to the internet must fail soft and queue.
- **Client-generated UUIDs** for all created records, so retried requests are idempotent and never duplicate.
- **Append-only** for clinical notes, results, audit entries and stock ledger. Corrections are new entries that reference the old one.
- **Single write path:** all mutations go through service-layer functions that enforce permissions, validate input, write audit entries, and run in a transaction.
- Time stored in UTC, displayed in `Africa/Lagos`.
- PHI never appears in logs, error messages, URLs or analytics.

### 6.4 Data model (conceptual, Phase 1)
- `User`, `Role`, `Session`, `MfaSecret`
- `Patient` (demographics, `legacyCardNumber`, `paperFolderStatus`, `priorityFolder`, `possibleDuplicateOf`, `mergedInto`), `PatientAllergy` (append-only, status active/resolved/entered in error)
- `QueueEntry`
- `Visit`, `VisitNoteVersion`, `Vitals`
- `TestCatalogItem`, `TestOrder`, `TestResult`
- `Drug`, `DrugAlternativeGroup`, `AllergenGroup`, `StockBatch`, `StockMovement`, `StockMovementReview`
- `Prescription`, `PrescriptionItem` (status: pending, dispensed, partial, substituted, unavailable, cancelled), `DispenseRecord`, `AllergyOverrideAck`
- `UnfilledPrescriptionLog` (derived or stored)
- `ScannedDocument`, `ScannedPage`, `DocumentVoidEvent`
- Full field-level schema: `/docs/architecture.md` §2
- `AuditLog`, `BreakGlassEvent`
- `SyncState` (cloud sync cursors, last backup status)

## 7. Availability design

### 7.1 Connection states (must match the UI connection chip)
| State | Meaning | Behavior |
|---|---|---|
| **Online** | Device reaches server; server reaches cloud | Normal |
| **Working offline** | Device reaches server on LAN; internet is down | Fully functional; cloud sync queues and shows "Last synced" |
| **Server unreachable** | Device cannot reach the on-site server | Read-only cache of recent patients and today's queue; drafts saved locally; clear banner; writes queue where safe (drafts only in Phase 1) |
| **Syncing N changes** | Reconnecting | Shows progress; never blocks work |

### 7.2 Failure handling
- **Internet down:** nothing changes for users; sync resumes automatically.
- **Primary server fails:** standby promoted (documented runbook, target RTO 1 hour); workstations fall back to read-only cache meanwhile.
- **Power cut:** UPS bridges to generator; PostgreSQL runs with WAL and safe settings (never disable `fsync`); mirrored disks; graceful shutdown triggered at low UPS battery.

### 7.3 Targets **[CONFIRM with client]**
- RPO ≤ 15 minutes; RTO ≤ 1 hour; availability 99.5% monthly during hospital operating hours.

### 7.4 Backups (3-2-1)
- Continuous WAL archiving plus nightly full backup; file store synced incrementally.
- Copies: primary, NAS, encrypted cloud (plus rotated offline drives).
- Monthly automated **restore test** into a scratch environment, with the result reported on the admin dashboard.
- A failed or stale backup raises an alert within 24 hours (target: same day).

## 8. Security requirements

- TLS on the LAN (internal CA or equivalent). No plain HTTP.
- Encryption at rest: full-disk encryption on server and laptops; encrypted cloud backups with keys not stored alongside the data.
- Password policy and breach-resistant hashing (Argon2id or bcrypt with a sound cost), rate limiting and lockout on login.
- CSRF protection, secure/HttpOnly cookies, strict security headers, input validation on all boundaries.
- Offline cache on devices is **encrypted**, scoped to the user's role, expires automatically, and is wiped on logout; remote wipe supported **[CONFIRM mechanism]**.
- No clinical detail in SMS/WhatsApp or any message channel in Phase 1 (out of scope anyway).
- Secrets via environment/secret store, never in the repo.
- Developer access to production is least-privilege, logged, and via VPN. **No real patient data in dev/test**; seed data is synthetic.
- NDPA alignment: lawful basis and consent capture, data minimization, retention rules **[CONFIRM period]**, breach-response procedure. The hospital is data controller and we are data processor (DPA required before go-live).
- Data export: the hospital can export all of its data in an open format at any time.

## 9. Accessibility and UX requirements

- Primary target: laptops at 1366×768, Chrome/Edge current versions. Secondary: tablet.
- WCAG 2.1 AA contrast, visible focus, full keyboard operation for forms and tables.
- Body text ≥ 16 px, click targets ≥ 44 px.
- Minimal typing: search-and-select, quick-pick chips, sensible defaults.
- English first; structure strings for later translation (Hausa, Yoruba, Igbo, Pidgin possible) **[CONFIRM]**.
- Pages must remain usable on slow LAN/Wi-Fi: no large blocking bundles; lazy-load heavy components such as the document viewer.
- Design references: `/docs/design/*.png`. Match layout and hierarchy; deviations are noted in `/docs/decisions.md`.

## 10. Non-functional targets

- Page interaction under 200 ms perceived on LAN for common actions; search under 1 s.
- Server runs comfortably on reference hardware with 8–15 concurrent users.
- Zero data loss for acknowledged writes (a write confirmed to the user is durable).
- Automated tests run in CI; main branch always deployable.

## 11. Build order (vertical slices)

1. Repo, tooling, CI, Docker Compose, design tokens and component library
2. M1 Auth, roles, audit, admin user management
3. M2 Patient registry and QR card
4. M5 Pharmacy stock and prescription logic (data and API), then M3 consultation UI on top
5. M4 Lab
6. M6 Scanned documents
7. M7 Admin dashboard and reports
8. Availability layer: PWA read-only cache, connection chip logic, backup and restore automation, monitoring agent
9. Hardening, performance, crash/restore drills, staging pilot, parallel run

Each slice: plan → implement (UI + API + DB) → tests → review → merge.

## 12. Testing requirements

- Unit tests for stock arithmetic, permission rules, duplicate detection.
- Integration tests for every service-layer mutation (permissions, validation, audit entry created, transaction rollback on failure).
- Role × endpoint authorization test matrix.
- Concurrency tests for dispensing and note editing.
- E2E (Playwright) for: registration → consultation → prescription → dispensing; lab order → result; offline/server-unreachable behavior.
- Chaos checks on staging: kill the database mid-transaction, cut the network, restart containers; verify no corruption and no lost acknowledged writes.
- Restore drill from backup against the RTO.

## 13. Definition of done (per slice)

- Matches the relevant design PNG (or deviations documented)
- Server-side permission checks and audit entries present
- Tests written and passing, including the permission matrix for new endpoints
- No PHI in logs; no real data used
- Works at 1366×768, keyboard-operable, AA contrast
- Migration is reversible; seed data updated
- `CLAUDE.md` and `/docs/decisions.md` updated if conventions or decisions changed

## 14. Open questions for the client

1. Number of workstations and daily patient volume, by department
2. Is the pharmacy in-house and who owns the initial stock count?
3. Is the lab in-house? What tests are in the catalogue?
4. Generator start: automatic with transfer switch, or manual?
5. Second internet line possible?
6. Retention period for records; consent wording and process
7. Photo capture at registration: yes/no
8. Languages needed beyond English
9. Who is the on-site super-user and administrator?
10. Acceptable downtime windows for updates

## 15. Deferred to Phase 2 (for planning only)

Billing and insurance, inpatient/ward management, lab equipment integration, patient reminders and portal, full offline writes with automatic conflict resolution on every device, analytics and multi-facility support.
