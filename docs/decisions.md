# Decisions log

Append-only, like the data it describes: to change a decision, add a new entry that supersedes the old one and mark the old one `Superseded by D-NNN`. Newest entries at the bottom.

Format: **ID · Title** — Date · Status · Decided by. Then Context, Decision, Consequences.

---

## D-001 · ORM: Prisma
2026-11-02 · Accepted · Project lead

**Context.** CLAUDE.md left Prisma vs Drizzle open. The design relies on PostgreSQL features neither ORM models fully: append-only triggers, CHECK constraints, row locks (`SELECT … FOR UPDATE`), `pg_trgm` indexes and `LISTEN/NOTIFY`. Drizzle was proposed as closer to SQL.

**Decision.** Use **Prisma**, because the maintainers already know it. A team that can confidently maintain the code remotely for years matters more than Drizzle's closeness to SQL.

**Rules that come with it:**
- `prisma/schema.prisma` is the source for tables, columns, relations and plain indexes.
- Anything Prisma can't express is added as **hand-written SQL inside the generated migration**: triggers, CHECK constraints, GIN/trigram indexes, sequences, DB role grants. Every such object is listed in a comment at the top of the migration.
- **Every migration folder has a hand-reviewed `down.sql`** next to `migration.sql` (hard rule 13). Generate a starting point with `prisma migrate diff`, then add the reverse of any custom SQL by hand. A migration without a working `down.sql` fails review. CI applies up, down, up on a seeded database.
- Row locking and other SQL Prisma can't express go through `$queryRaw` / TypedSQL inside the service kernel's interactive transaction. They never go in route handlers.
- `prisma migrate deploy` runs in production. `prisma migrate dev` / `db push` never run against the on-site database.

**Consequences.** More custom SQL in migrations than with Drizzle, so reviewers check `migration.sql` and `down.sql`, not only the schema diff. AuditLog partitioning is deferred (D-012).

## D-002 · Package manager: pnpm
2026-11-02 · Accepted · Project lead

## D-003 · Patient ID format
2026-11-02 · Accepted · Project lead

**Decision.** `patient_number` = configurable hospital prefix + `-` + sequential number + **one check digit as the last digit**, e.g. `HSP-2073` + check digit. The check digit uses the **Damm algorithm**: decimal-only, it catches every single-digit error and every adjacent transposition, which Luhn does not.
- The prefix is a hospital setting. Each patient's full number is stored once at registration and **never changes**, even if the prefix setting later does.
- The sequence comes from a PostgreSQL sequence assigned on the server. Patient registration is server-only in Phase 1, so client-generated IDs are not needed for it. The row's primary key is still a client UUID.
- Search and QR scan accept the number with or without the prefix and reject a wrong check digit with a plain-language "check the number" message.
- The sample IDs in the design PNGs (e.g. `HSP-20736`) are fictional and don't match any standard algorithm. Under Damm, `HSP-2073` gets check digit 7 (`HSP-20737`). The designs don't need changing.

**Also:** a searchable, non-unique `legacy_card_number` holds the number on the existing mini cards. Paper folders stay filed by that number during the parallel run. It is not unique because old cards may have been reissued or duplicated.

## D-004 · Pharmacist does not see patient phone number
2026-11-02 · Accepted (pending client review) · Project lead

The Pharmacy-Dispensing design shows "Contact · 0803…". That breaks the pharmacist's limited view (name, age, sex, patient ID, allergies), so the phone number is left out. The project lead will raise it with the client as a possible matrix change. The design deviation is recorded here.

## D-005 · Allergy match: warn, override with reason, pharmacist acknowledges
2026-11-02 · Accepted (severe-allergy policy pending clinical sign-off) · Project lead

**Decision.** If a prescribed drug matches an active patient allergy (through `AllergenGroup`), the doctor sees a warning and **must enter an override reason** to continue. The override is audited. At dispensing, the pharmacist sees the override and **must acknowledge it** before that line can be dispensed. The acknowledgement is its own append-only record.

**Open.** Whether *severe* allergies should hard-block instead is a clinical decision. It needs sign-off from a doctor or pharmacist at the hospital. The design's "Blocked · allergy" chip becomes "Allergy warning" until then. Implement it so a hard block can be switched on per severity without a schema change.

## D-006 · Stock is batch-level, dispensed first-expiry-first-out
2026-11-02 · Accepted · Project lead

Resolves the batch-level [CONFIRM] in scope §5.1 M5. Stock is held per `StockBatch` (drug, batch number, expiry). Dispensing allocates from the unexpired batch with the earliest expiry first. **Expired batches never count toward availability** and can't be dispensed from. They leave stock through an `expire` movement.

## D-007 · Vitals and allergies are append-only
2026-11-02 · Accepted · Project lead

The matrix showed "U" for nurse and doctor. There are no in-place updates:
- **Vitals:** a correction is a new row that marks the original "entered in error" (`supersedes_id` + mandatory reason). The original stays viewable.
- **Allergies:** each row has a status of `active`, `resolved` or `entered_in_error`. Changing the status or details adds a new row that supersedes the previous one, with a reason for `entered_in_error`.
- Nothing is deleted. Both tables get the append-only trigger and INSERT-only grants.

## D-008 · Lab sees order details, not consultation notes
2026-11-02 · Accepted · Project lead

Clarifies "R (own orders)" on consultation notes. `lab` sees the test order, including the doctor's per-order **clinical information** field, plus basic patient identity (name, age, sex, patient ID). Lab never reads `VisitNoteVersion`.

## D-009 · Changing prescriptions, dispensing errors, voiding scans
2026-11-02 · Accepted · Project lead

**Prescriptions**
- **Any doctor** (not only the prescriber) can cancel or amend a prescription item **only while it is `pending`**. Amending cancels the old item and creates a new one that references it, in one transaction. The pending check and the dispensing check both lock the item row, so a cancel or amend can't race with a dispense.
- Once anything has been dispensed against an item, the only way to change it is a new prescription.
- Pharmacists **never edit prescriptions**. Per line they can dispense, partially dispense, substitute or log as unavailable. **Substitution is allowed only within the prescribed drug's alternative group and needs a reason.**

**Dispensing errors**
- The pharmacist records a **compensating stock movement** with a mandatory reason. It references the original movement and is **flagged for admin review**. The review is its own append-only record. The original movement is never changed.

**Scanned documents**
- `front_desk` and `nurse` can **void their own uploads**. `admin` can void any upload and is the only role that can **restore** one.
- A voided scan is hidden from normal views by default, **never deleted**, and kept in backups. Each void and restore is an append-only event with a reason.
- Admin voids and restores from document **metadata** (type, date, uploader, page count). Viewing the page images is clinical access and needs break-glass.
- The matrix gives `nurse` create access to scans, since nurses may upload, and only your own uploads can be voided.

## D-010 · No duplicate merge in Phase 1, but merge-ready schema
2026-11-02 · Accepted · Project lead

Merging is out of Phase 1. Patient numbers are **immutable** (enforced by a DB trigger). Duplicate overrides at registration are logged. `Patient` gets nullable `merged_into_id` and `possible_duplicate_of_id` now, so a merge feature can follow early in Phase 2. More duplicates are expected once old folders are digitized.

## D-011 · Drafts live in separate mutable tables
2026-11-02 · Accepted · Project lead

Note, prescription and lab-result drafts autosave often. They're stored in mutable `*Draft` tables, keyed per user and record, and deleted once the immutable version is saved. The append-only record contains only what was deliberately saved or released. Drafts are not part of the clinical record.

## D-012 · AuditLog not partitioned in Phase 1
2026-11-02 · Accepted · Project lead

Prisma doesn't manage partitioned tables well, and about 8 workstations won't produce enough audit volume to need it for years. Use a plain table with indexes on `(occurred_at)`, `(patient_id, occurred_at)` and `(actor_user_id, occurred_at)`. Revisit if the table passes ~50M rows.

## D-013 · Local draft autosave moves into the consultation slice
2026-11-02 · Accepted · Project lead

The scope's build order puts the availability layer at step 8. M3's acceptance test ("kill the browser mid-note, the draft is restored") needs encrypted local draft storage, so that part moves into the M3/M5b slice. Basic WAL archiving to the NAS also moves into slice 0's Compose setup, so no environment ever runs without backups.
