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

## D-014 · Migration files: `migration.sql` is the up, `down.sql` the reverse
2026-11-06 · Accepted · Project lead

Prisma only runs a file named `migration.sql`, so that file is each migration's **up**. A hand-reviewed `down.sql` sits beside it (D-001). This is what "each migration has .up.sql and .down.sql" means in practice.
- `pnpm db:migrate:down` (`scripts/db/migrate-down.ts`) runs the latest `down.sql` and deletes that migration's row from `_prisma_migrations` **in one transaction**, so a failed rollback changes nothing. Dev and test only; production rollbacks follow a runbook.
- `pnpm db:migrate:check` runs in CI. On a throwaway cluster it applies every migration, rolls each back, checks that no tables, types, functions or sequences are left, then applies everything again. It also fails if any migration lacks a `down.sql`.

## D-015 · Local and test PostgreSQL via `embedded-postgres`; PostgreSQL 18
2026-11-06 · Accepted · Project lead

Developers and CI run a real PostgreSQL from the `embedded-postgres` dev dependency (PostgreSQL 18.6 binaries), with **no Docker or system install**. The development machine has neither, and this keeps setup to `pnpm install && pnpm db:start`.
- Dev: `pnpm db:start` runs a persistent cluster in `.data/postgres` (git-ignored) on localhost:54329. Role names, passwords and the port are read from `.env`.
- Integration tests: one throwaway cluster per run, plus a migrated template database. **Each test file gets its own copy** (`CREATE DATABASE … TEMPLATE`), because append-only tables reject the TRUNCATE that per-test cleanup would need.
- Durability settings stay at their defaults (fsync on) in every environment, including tests (CLAUDE.md rule 12).
- Production uses the official `postgres:18` image through Docker Compose (deploy PR). Both setups apply the **same** role and privilege SQL from `deploy/postgres/init/`, so dev permissions match production.

## D-016 · Two database roles: `hms_owner` and `hms_app`
2026-11-06 · Accepted · Project lead

- `hms_owner` owns the schema and is used **only** by migrations (`MIGRATE_DATABASE_URL`).
- `hms_app` is the running app's role (`DATABASE_URL`). It has DML only, never DDL. Default privileges give it SELECT/INSERT/UPDATE/DELETE on new tables. **Each append-only table's migration revokes UPDATE, DELETE and TRUNCATE** from it.
- So a bug, or an injected query, in the app can't alter history or the schema even if it gets past the application code. The append-only trigger is a second layer that also stops the owner role.
- Dev only: `hms_owner` gets CREATEDB for Prisma's shadow database. The on-site server never grants it.

## D-017 · Service kernel: expected failures commit, exceptions roll back
2026-11-06 · Accepted · Project lead

Every service is built with `defineService` (`src/server/kernel`). It runs in this order: role permission check → Zod validation → one READ COMMITTED transaction (record-level `authorize`, then `run`, then the audit entry in the **same** transaction).
- A service returns an `Outcome`. **An expected failure** (wrong password, item no longer pending) is returned with `fail(...)`. The transaction **commits**, so side effects such as a failed-login counter persist, and a `failure` audit entry is written alongside.
- **An exception** means something is actually wrong. The transaction **rolls back**, an `error` (or `denied`) entry is written in a separate transaction, and the error is rethrown.
- Denials and validation failures are audited before any work is done. Validation audits record **field names only, never submitted values**.
- Every kernel service is audited, including reads and public services such as login. There is no opt-out for now.
- Logging goes through `src/server/log.ts`, which accepts only fixed non-identifying fields and never `error.message`, because database errors can echo row values.
- ESLint blocks Prisma and `@/server/db` imports outside `src/server`, and `@/server` imports in `src/lib` and `src/components`. This enforces rule 4 at lint time.

## D-018 · Audit log: append-only and hash-chained
2026-11-06 · Accepted · Project lead

`audit_log` ships in the foundation PR rather than the login PR, as the plan had it, because the kernel's tests need it.
- **Append-only:** no UPDATE/DELETE/TRUNCATE grant for `hms_app` (D-016), and the reusable `forbid_mutation()` trigger blocks them for every role, the owner included.
- **Tamper-evident:** a BEFORE INSERT trigger takes a transaction-level advisory lock, assigns `seq` **after** the lock (so `seq` order is chain order), and sets `hash = sha256(prev_hash ‖ canonical row)`. `audit_log_verify_chain()` lists any broken link.
- **Consequence 1:** audited transactions must use **READ COMMITTED**. Under REPEATABLE READ or SERIALIZABLE the trigger would read a stale previous hash and fork the chain, so it rejects them (SQLSTATE `HM001`). Stock concurrency will use row locks, not SERIALIZABLE.
- **Consequence 2:** audited writes queue up behind the chain lock until commit. That's fine for 8–15 users. Keep audit writes at the end of transactions (the kernel does) and keep transactions short.
- **Limitation:** deleting the *newest* rows can only be detected against an external anchor. The backup service will record the latest hash with each backup.
- CHECK constraints keep `action` and `reason_code` to dotted machine names and `metadata` to a JSON object, which leaves no free-text field where patient details could slip in.

## D-019 · Content Security Policy: own origin only; inline scripts allowed for now
2026-11-06 · Accepted · Project lead

All responses carry a CSP of `default-src 'self'` (fonts, images and connections are also self-only), plus `frame-ancestors 'none'`, `nosniff`, `no-referrer` and a restrictive Permissions-Policy (camera allowed for our own pages, for QR scanning). Besides limiting XSS, this **enforces the availability rule**: any accidental CDN or third-party dependency is blocked in the browser and caught by the e2e "no external requests" test.
`script-src` still allows `'unsafe-inline'`, because Next.js needs it without per-request nonces. Moving to nonces, done in `proxy.ts`, is a hardening task for slice 9; it makes every page dynamically rendered. Fonts (Inter, OFL) are committed under `public/fonts`, including the Vietnamese subset, which carries the Yoruba dotted vowels and tone marks.

## D-020 · Toolchain versions
2026-11-06 · Accepted · Project lead

- **Next.js 16.4, React 19.3, Tailwind CSS 4.3, Prisma 7.10** (with the `pg` driver adapter), **Zod 4.6, Vitest 5.1, Playwright 1.65**, all pinned exactly (`save-exact`).
- **TypeScript 6.0**, not 7.0: typescript-eslint supports up to 6.0. Revisit when it supports 7.
- **Node 22 LTS** (`.nvmrc`; Prisma needs ≥ 22.12). Node 22 leaves maintenance in April 2027, so **move to Node 24 LTS before the pilot**.
- **Playwright on macOS 12:** current Playwright Chromium no longer runs on macOS 12. Locally, run e2e against installed Google Chrome with `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`. CI (Ubuntu) uses Playwright's Chromium.
- **No runtime or build-time phoning home:** `NEXT_TELEMETRY_DISABLED=1` and `CHECKPOINT_DISABLE=1` (the Prisma update check) are set in `.env.example` and CI.
- pnpm install scripts are allowed only for the packages listed in `package.json` → `pnpm.onlyBuiltDependencies`.

## D-021 · Design PNGs are references; scope and decisions take precedence
2026-11-06 · Accepted · Project lead

**Context.** The design PNGs are prototypes and conflict with the scope in several places: the patient phone number on the pharmacist screen (D-004), "Blocked · allergy" (D-005), and the offline login screen, which is labelled "Working offline" but describes a device that can't reach the server.

**Decision.**
- `/docs/scope.md` and this log take precedence over `/docs/design/*.png`. The PNGs guide layout, hierarchy and look, and screens may be **redesigned away from them** to fit the scope.
- An element shown in a PNG that is **outside Phase 1 scope or adds risk is not built**: extra patient data, states the scope doesn't define, or collapsed connection states (rule 16). The omission is recorded here and mentioned when the work is reported.

**Applied to connection states on sign-in.** All §7.1 states stay distinct:
- **Online**: sign-in works normally.
- **Working offline**: internet down, LAN server reachable. Sign-in and all daily work continue normally, and the chip says "Working offline". This is the expected state during internet outages.
- **Server unreachable**: the device can't reach the on-site server. The login screen uses the offline PNG's layout and "new sign-in needs a connection" notice, with this title and chip instead of "Working offline".

## D-022 · Sign-in implementation (M1)
2026-11-06 · Accepted · Project lead

Implements the M1 decisions (Argon2id, 10-character minimum with a common-password check, 5 failures → 15 minutes, TOTP for doctor/pharmacist/admin, 8 recovery codes, admin-issued temporary passwords, no email reset) with these specifics:
- **Passwords:** Argon2id via `@node-rs/argon2` (prebuilt binaries, no compiler needed), m=19 MiB, t=2, p=1, to be benchmarked on the reference server in slice 9. Unicode is NFKC-normalised, and length counts code points (NIST SP 800-63B). Passwords may not contain the user's staff ID or email. The common-password list is 117,571 entries of 10+ characters from SecLists (MIT licence), bundled and read offline.
- **Account existence never leaks:**
  - Every failure path runs exactly one Argon2 verification.
  - Lockout is counted per **account** when the identifier matches one (staff ID and email share the limit) and per **typed identifier** when it doesn't, so unknown identifiers lock identically.
  - "Account disabled" is shown only after the correct password.
- **Per-IP throttle:** 30 failed attempts per 15 minutes, held in memory (single process). The client IP comes from `X-Forwarded-For` (rightmost entry, the one Caddy appended), and only when `TRUST_PROXY_HEADERS=true`. Next.js doesn't expose the socket address, so **the app port must be reachable only through the proxy**.
- **Second-factor failures** (TOTP and recovery codes) count toward the same 5-attempt lockout (proposal a). Reaching it also revokes the half-signed-in session. **Enrollment-confirmation typos do not count**: the password is already proven and the 15-minute enrollment deadline bounds the attempts.
- **TOTP:** SHA-1, 6 digits, 30 s, ±1 step. Replay is blocked by storing the last accepted step under a row lock, so two simultaneous uses of one code let exactly one through. Secrets are AES-256-GCM encrypted with the user ID as associated data, and the key is versioned.
- **Recovery codes:** 10 Crockford-base32 characters (50 bits), formatted `XXXXX-XXXXX`. Stored as HMAC-SHA256 bound to the user. Redeemed by one atomic UPDATE, so of two simultaneous uses exactly one succeeds. When ≤ 2 remain, the user is told to ask for a reset.
- **Stage order after the password:** second factor (if enrolled) → temporary-password change → forced enrollment (if any of the user's roles requires MFA; proposal d) → active. Each step has a 5-minute deadline (15 for enrollment) and **issues a new session token**.
- **Multi-role users** land on their first role in the order admin → doctor → pharmacist → nurse → lab → front_desk. Role switching comes with user management.
- **Admin account services** (revoke sessions, disable, temporary password, unlock, reset MFA) exist with tests; their screens come with the user-management slice. The last active admin can't be disabled, and admins can't disable themselves or reset their own MFA.
- **First admin:** `pnpm admin:bootstrap` on the server console. It refuses once any active admin exists (runbook: `docs/runbooks/admin-bootstrap.md`).
- **Optional MFA for other roles:** there's no self-enrollment screen yet. Add it with the user-settings work.

## D-023 · Sessions and idle lock
2026-11-06 · Accepted · Project lead

- **Server-side sessions.** The `__Host-hms_session` cookie (HttpOnly, Secure, SameSite=Lax) holds 256 random bits; only the SHA-256 is stored. Every protected request re-reads the session, so revocation and disabling take effect on the next request. A 30-second heartbeat covers idle screens (within 1 minute).
- **Absolute lifetime of 12 hours** (one shift; proposal b).
- **Idle lock after 10 minutes without keyboard or pointer input.** The heartbeat never counts as activity.
  - The browser locks at exactly 10 minutes and tells the server.
  - The server independently locks after 10 minutes plus a grace period (≤ 60 s), because the browser reports activity at most every 30 s.
  - All tabs share activity and lock state (BroadcastChannel).
  - While locked, page content is **unmounted** and the server renders only the lock screen, so a reload doesn't bypass it.
- **Unlocking needs the password only** (proposal c). 5 wrong passwords revoke the session, and failures also count toward the account lockout. The lock screen offers "Not you? Sign out" for shared workstations.
- `SESSION_IDLE_SECONDS_OVERRIDE` exists for e2e tests and can only **shorten** the timeout (5–599 s), so a mistake in production can't weaken it.
- **Device:** a long-lived random `__Host-hms_device` cookie identifies the browser for audit ("from which device") and, later, offline-cache wipe. It is not a credential.

## D-024 · Connection status on screen
2026-11-06 · Accepted · Project lead

- `/api/health` answers from the on-site server with whether **the server** can reach the internet. It probes `INTERNET_PROBE_URL` at most once a minute in the background with a 3 s timeout. The URL is **required in production**; without it, "Working offline" could never be detected.
- The browser checks every 30 s, and on focus and network events:
  - health request fails → **Server unreachable**
  - internet down → **Working offline**, where everything keeps working
  - otherwise **Online**
- The sign-in screens replace the form with the Server unreachable panel (D-021) and offer "Try connection again".

## D-025 · Every protected page checks the session itself
2026-11-06 · Accepted · Project lead

In Next.js a layout does **not** re-run when moving between pages under it, so the session check in `(staff)/layout.tsx` alone isn't enough. **Every protected page calls `requireRole()` (or `requireSignedIn()`), and every server action and route handler checks the session or goes through a kernel service.**

A related Next.js behaviour: setting a cookie in a server action re-renders the current page on the server. Pages in the middle of a sign-in flow (`/login`, `/mfa/enroll`) therefore don't redirect away when the session becomes active during the flow; the client flow navigates once it has shown what it must (recovery codes, low-codes warning). E2E tests cover both. This was found by them: the first version skipped the recovery-code screen.
