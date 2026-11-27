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
- **Per-IP throttle:** 30 failed attempts per 15 minutes, held in memory (single process). The client IP comes from `X-Forwarded-For` (rightmost entry, the one Caddy appended), and only when `TRUST_PROXY_HEADERS=true`. Next.js doesn't expose the socket address, so **the app port must be reachable only through the proxy**. `TRUST_PROXY_HEADERS=true` is **required in production** (2026-11-24). Requests with no known IP are not throttled per IP: a shared bucket would let one person block sign-in at every workstation. Per-account lockout still applies to them.
- **Second-factor failures** (TOTP and recovery codes) count toward the same 5-attempt lockout (proposal a). Reaching it also revokes the half-signed-in session. A correct password does **not** reset that count while a second factor is still to prove; only a successful code does (2026-11-24 fix: otherwise someone with the password could guess codes indefinitely, 4 per sign-in). Second-factor failures also count toward the per-IP throttle. **Enrollment-confirmation typos do not count**: the password is already proven and the 15-minute enrollment deadline bounds the attempts.
- **TOTP:** SHA-1, 6 digits, 30 s, ±1 step. Replay is blocked by storing the last accepted step under a row lock, so two simultaneous uses of one code let exactly one through. Secrets are AES-256-GCM encrypted with the user ID as associated data, and the key is versioned.
- **Recovery codes:** 10 Crockford-base32 characters (50 bits), formatted `XXXXX-XXXXX`. Stored as HMAC-SHA256 bound to the user. Redeemed by one atomic UPDATE, so of two simultaneous uses exactly one succeeds. When ≤ 2 remain, the user is told to ask for a reset.
- **Stage order after the password:** second factor (if enrolled) → temporary-password change → forced enrollment (if any of the user's roles requires MFA; proposal d) → active. Each step has a 5-minute deadline (15 for enrollment) and **issues a new session token**.
- **Multi-role users** land on their first role in the order admin → doctor → pharmacist → nurse → lab → front_desk. Role switching: D-026.
- **Admin account services** (revoke sessions, disable, temporary password, unlock, reset MFA) exist with tests; their screens come with the user-management slice. The last active admin can't be disabled, and admins can't disable themselves or reset their own MFA.
- **First admin:** `pnpm admin:bootstrap` on the server console. It refuses once any active admin exists (runbook: `docs/runbooks/admin-bootstrap.md`).
- **Optional MFA for other roles:** self-enrollment from "My account" (D-029).

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

**Locked sessions are refused by the page guard too** (2026-11-24, post-merge review of M1). `requireRole()` and `requireSignedIn()` redirect an idle-locked session to `/locked`. Only the staff layout and the `/locked` page pass `allowLocked`, and both render nothing but the lock screen. Before this, the guards let locked sessions through and only the layout swapped the page for the lock screen. On a soft navigation Next.js fetches just the page, so a page would have rendered its data for a locked session. On a full load the layout leaves the page out, so the URL stays put and the lock screen shows in place. After unlocking from `/locked`, the user lands on their role's home.

A related Next.js behaviour: setting a cookie in a server action re-renders the current page on the server. Pages in the middle of a sign-in flow (`/login`, `/mfa/enroll`) therefore don't redirect away when the session becomes active during the flow; the client flow navigates once it has shown what it must (recovery codes, low-codes warning). E2E tests cover both. This was found by them: the first version skipped the recovery-code screen.

## D-026 · Role-based navigation and role switching
2026-11-25 · Accepted · Project lead

- The staff layout has a shared `Sidebar` (`src/components/Sidebar.tsx`). Its links come from `navFor(role)` for the session's **active role**. Hiding links is only convenience: every page still checks the role (D-025).
- Staff with more than one role see **one button per other role**. A switch is a plain form post to the `auth.role_switch` service:
  - Accepted only for an active, unlocked session and a role the account holds.
  - The active role decides every permission check, so a switch is a privilege change. It **issues a new session token** and is audited under the new role with `from_role` and `to_role`.
  - It lands on the new role's home page.
- Sign-in still starts in the first role by priority (D-022).

## D-027 · Generated permission-matrix tests
2026-11-25 · Accepted · Project lead

- `defineService` attaches `meta` (action and permission) to every service. `tests/permission-matrix` imports every module under `src/server/services` and runs **each role plus an anonymous caller** against each protected service:
  - Roles the matrix denies must get `ForbiddenError` and exactly one `denied` audit entry.
  - Allowed roles must get past the role check.
- `tests/permission-matrix/fixtures.ts` gives each protected service its **expected permission** and a valid input. The suite fails when a protected service has no fixture, when a service's permission differs from its fixture, or when a public service isn't listed in `PUBLIC_SERVICES` with a reason. Adding a service or changing its access is therefore always visible in review.
- Pages: a generated test checks every role against every role page (`requireRole`). A static test checks that every page under `(staff)` calls a guard itself, and that every API route checks the session or is listed as public.

## D-028 · Break-glass is built right after M2
2026-11-25 · Accepted · Project lead

Break-glass opens one **patient's** clinical record with a reason, flagged for review (scope §4.1, §5 M1). Its events reference `patient_id`, and no patient or clinical tables exist until M2. It is therefore built as its own slice **immediately after M2**:
- the event and review tables, with a real foreign key
- kernel support for break-glass access
- a reason dialog on the patient page
- an admin review screen

M1 is complete apart from this item. Until it ships, admin has no clinical access at all, which is the safe default.

## D-029 · Admin user management and "My account"
2026-11-25 · Accepted · Project lead

Completes M1 apart from break-glass (D-028). All of it runs through kernel services, so the generated permission suite covers it (D-027).

**Users (`/admin/users`, admin only)**
- **List and search** by name, staff ID or email, at most 200 rows. The search text is never audited; only whether a search was used and the result count.
- **Create:**
  - The client generates the account id (rule 11). A retried submit creates nothing and is refused (`already_created`), because the temporary password can't be shown a second time.
  - The temporary password is shown **once** on screen, to hand over in person. It is never stored or sent anywhere.
  - Staff ID and email must be unused.
- **Edit name and email.** The staff ID can't be changed, because people sign in with it and the audit log refers to the account.
- **Change roles:**
  - Any change **signs the user out everywhere**. Their sessions were granted under the old roles, and a newly added MFA role must force enrollment at the next sign-in.
  - Admins can't remove their own admin role.
  - The last active admin can't lose the role. This uses the same row-locked check as disabling (`anotherActiveAdminExists`).
- **Account actions,** each with an inline Confirm step (no browser dialogs): switch off, switch back on (new: `users.enable`), temporary password, lift lockout, reset authenticator, sign out everywhere. The page doesn't offer the actions the server refuses for one's own account.

**My account (`/account`, every role)**
- Shows the user's own name, staff ID, roles and authenticator status.
- **Optional authenticator** for roles that don't require one (D-022):
  - Starting setup asks for the **password again**. Otherwise anyone at an unlocked workstation could bind their own phone to the account and lock its owner out.
  - Wrong passwords count toward the account lockout, as at unlock.
  - The pending setup expires after 15 minutes.
  - Once set up, sign-in asks for a code. Removing the authenticator needs an administrator (Reset authenticator).

## D-030 · Recovering the only administrator
2026-11-25 · Accepted · Project lead

**Context.** If the only active admin lost their authenticator, nobody could reset it: admins can't reset their own (D-022), and `admin:bootstrap` refuses while an active admin exists. The runbook pointed at bootstrap, which couldn't work.

**Decision.** A server-console command, `pnpm admin:recover --staff-id <id>` (service `users.recover_admin`):
- **Last resort only.** It works only for an active admin, and refuses while **any other active admin exists**. That admin resets the authenticator in the app instead.
- **Replaces both factors.** It revokes the authenticator and recovery codes, issues a temporary password (printed once), ends every session and lifts any lockout. The next sign-in forces a new password and then a new authenticator.
- **Identity** is checked when the temporary password is handed over in person. The hospital's written approval is required (runbook `lost-mfa-device.md` step 6).
- **Audited** as `users.recover_admin`. The temporary password is never audited.

**Consequences.** It needs server-console access, the same as `admin:bootstrap`. Anyone with that access can already read the database, so it adds no new way in. Keeping two admins (bootstrap runbook step 5) remains the main protection.

## D-031 · Shared cloud test database (dev/test only)
2026-11-25 · Accepted · Project lead

**Context.** For hands-on testing of the current flows, the project lead set up a hosted database: Prisma Postgres, PostgreSQL 17.2. It has one superuser login and can't create the `hms_app`/`hms_owner` roles (D-016). It is reached over the internet.

**Decision.** It may be used as a **shared test database for synthetic data only**:
- **Connection:** `DATABASE_URL` and `MIGRATE_DATABASE_URL` both point at its single login. The migrations apply as they are; their grants to `hms_app` are skipped because that role doesn't exist there.
- **Seed:** `pnpm db:seed` loads the synthetic demo users (`ALLOW_SEED=true`).
- **Unchanged:** automated tests and e2e still start their own throwaway local PostgreSQL 18 (D-015), and `pnpm db:start` still runs the local two-role cluster.

**Accepted gaps (test use only):**
- The app runs as a superuser, so the role-level least-privilege protections (no DDL, no UPDATE/DELETE on append-only tables) are absent. The append-only **triggers** still apply.
- It runs PostgreSQL 17, not 18.
- It depends on the internet, unlike the on-site server.

**Guard.** `serverEnv()` refuses to start in production unless `DATABASE_URL` connects as `hms_app`, so this database (or any owner or superuser login) can never serve real use.

**Never** put real patient or staff data in it (CLAUDE.md rule 1).

## D-032 · Patient registry rules (M2)
2026-11-25 · Accepted · Project lead

**Permissions.** A `queue` resource is added to the matrix (scope §4.1):
- Front desk creates entries.
- Front desk, nurses and doctors read and update them.
- Admin, lab and pharmacist get no access.

In M2 the only status change is "left"; nurse and doctor statuses come with M3.

**Patient numbers (D-003)**
- They come from the `patient_number_seq` sequence, starting at 1000. The app appends the Damm check digit inside the registration transaction; gaps after a rollback are harmless.
- The prefix is the `hospital_setting` row `patient_number_prefix`, currently the **placeholder `HSP`**. It must be set to the hospital's own prefix **before go-live**, because issued numbers never change. An admin screen for it comes with M7.
- A trigger keeps the number, sequence and registration facts unchanged for every login.

**What is recorded**
- **Name:** surname, first name and other names, plus a normalised `name_search` (accents removed, so "Adébáyọ̀" matches "Adebayo") with a trigram index.
- **Sex:** female or male.
- **Date of birth:** exact, or an age in years stored as 1 July of that year and marked estimated. An edit that keeps the same age keeps the stored date.
- **Phone:** optional, Nigerian only, stored as E.164.
- **Address, legacy card number, next of kin:** address and legacy card number are optional. Next of kin is name, relationship and optional phone; it can be changed but not removed.
- **Consent:** recorded with version **`draft-1`**, a placeholder until the hospital supplies its NDPA wording. It must change before go-live.
- **Photo:** not collected until the client confirms. The column exists.

**Duplicates**
- Candidates are narrowed in the database (name trigrams, same phone, or same date of birth with a weaker name match), then scored by `lib/domain/duplicates.ts`: 0.5 × name similarity + 0.3 × date of birth + 0.2 × phone.
- A score of **0.6 or more** warns. The same phone alone (families) or the same date of birth alone (strangers) never reaches it.
- The server checks again at registration and refuses unless every current match was confirmed as a different person. Each confirmation is kept in `duplicate_override` (append-only) and audited, and the new record points at the strongest match (`possible_duplicate_of_id`).

**Search**
- By patient number (with or without prefix; a wrong check digit gets "check the number"), phone (any format), legacy card number (any case), or name (fuzzy: typos, partial names, accents). Up to 20 results.
- **Lab and pharmacist** get identity only (name, age, sex, patient number) and **can't search by phone**, since a match would reveal the number (D-004, D-008).
- Every search and view is audited with the patient ids returned; search text never is.

**Edits** are refused if the record changed since it was read (`changed_elsewhere`), so nobody silently overwrites a colleague. The audit lists changed field names, never values.

**Never deleted.** Triggers block DELETE and TRUNCATE on `patient`, `next_of_kin` and `queue_entry` for every login, including the shared test database's superuser (D-031). A patient who leaves the queue is marked `left`.

**Database setup.** `pg_trgm` is created by `deploy/postgres/init/02-database.sql` as a superuser, because `hms_owner` can't create extensions. The migration repeats it with `IF NOT EXISTS`. The migration check ignores extension-owned functions.

**Performance.** `pnpm perf:patient-search` loads 100,000 synthetic patients into a throwaway PostgreSQL 18 and times real searches. On the dev laptop every kind of search is under 600 ms at p95 (number, phone and legacy card under 25 ms). The verdict for go-live comes from the reference hardware (slice 9).

**On hold** (project lead, 2026-11-25): QR scanning and CR80 card printing. The QR code will hold the patient number only, as before.

**Design deviations** (D-021), for the front desk screens:
- No "Recent patients" table on the landing page, which would show patients' phone numbers before any search.
- No notification bell, no "Last synced" time (it comes with offline sync in slice 8), and no Active/Follow-up status. None is defined in scope.
- Structured name and next-of-kin fields instead of single text boxes.
- No card preview, since printing is on hold; the design's card also showed a phone number.

## D-033 · Front desk screens (M2)
2026-11-25 · Accepted · Project lead (M2 plan approval)

**Where.** The front desk workspace lives under `/front-desk`: search (home), `patients/new`, `patients/[id]`, `patients/[id]/edit` and `queue`. Every page calls `requireRole("front_desk")`. Nurse, doctor, lab and pharmacist views of a patient arrive with their own workspaces (M3 onwards), on the same services. The front desk sidebar shows **Patients** and **Today's queue** instead of "Home".

**No patient data in URLs (rule 2).** Search runs as a server action, never `?q=`, so names and phone numbers stay out of the address bar, browser history and proxy logs. Pages are addressed by the opaque patient id only.

**Registration flow.**
- The form checks fields as you go, with the same Zod schema as the server. The first invalid field gets focus, and each error is tied to its field.
- On submit it asks for possible duplicates first. If any, it lists them (name, number, sex, age, date of birth, phone) with **Open record**. Going ahead needs a tick, "this patient is not any of the people above", then **Register as a new patient**. Changing any detail clears the list, so a fresh check runs.
- The registration id is generated once per form, so a double submit or retry returns the same patient (rule 11).
- Date of birth: "date known" or "only age known" (shown as "about 34 years").
- The consent notice is placeholder wording, recorded as `draft-1` (D-032).

**After registering**, the patient's page shows the new patient number, to write on the paper card and folder while card printing is on hold, plus **Add to today's queue**.

**Queue.** Today's entries in arrival order, with status as text and an icon. **Left without being seen** has an inline confirmation, no browser dialog.

**E2E idle timeout** raised from 8 s to 25 s: on a slow laptop a server round trip plus an accessibility scan, with no input meanwhile, locked the screen mid-test. The idle-lock test still checks the lock, and waits longer.

## D-034 · Dev server picks up a regenerated database client

**Context.** The app keeps one Prisma client on `globalThis` so dev hot reloads don't open a new connection pool each time. After a migration added the patient tables, a `pnpm dev` started earlier kept using the old client, and every patient screen failed with "Something went wrong" until the server was restarted.

**Decision.**
- The cached client remembers a fingerprint of the generated client's schema: models, fields and enum values (`src/server/db/cache.ts`). When `prisma generate` reruns on a changed schema, the dev server reloads the generated module, `db()` sees a different fingerprint, closes the old pool and builds a new client. No restart needed.
- It compares the schema, not the `PrismaClient` class. Next.js bundles the generated client once per server layer (pages, server actions), even in production. A first version compared classes, so the layers kept replacing each other's client and closing pools that requests were still using ("Cannot use a pool after calling end on the pool").
- `pnpm dev` runs `prisma generate` first, and `pnpm db:migrate` runs it after applying migrations, so pulling a migration and running `pnpm db:migrate` is enough, even with the dev server running.
- In production the fingerprint never changes inside a process, so the check is one string comparison.

## D-035 · How break-glass works
2026-11-26 · Accepted · Project lead

Builds D-028. Decided with the project lead: admins only, 30 minutes, reviewed by a different admin.

**Who and how long.**
- Only `admin` can break the glass in Phase 1 (new `break_glass` resource in the matrix: create, read, review).
- One event covers **one patient, one session, 30 minutes**. Signing out ends it, since the next session has a different id. The admin can also end it early.
- The database refuses windows over an hour.

**Reason.**
- A category (emergency care, patient or family request, complaint or investigation, records correction, legal or regulatory, other) plus written details of 10–500 characters.
- The details may mention the patient. They are stored only in `break_glass_event` and shown only on the review screen. Audit entries carry the category code and ids, never the text (rule 2).

**What it unlocks.**
- Nothing by itself. A clinical service opts in with `breakGlass: { patientId }` in `defineService`.
- For an admin the matrix refuses, the kernel then looks for a live event for that patient in that session. Without one, the admin is refused and audited with reason `break_glass_required`, which the UI uses to offer the reason dialog. With one, the request runs and its audit entry carries `break_glass_event_id`.
- The role matrix still gives admin no clinical access.

**Append-only, with one exception.**
- Events can't be edited or deleted. The only change allowed is setting `ended_at` once, to end access early, enforced by a trigger and a column-level grant.
- Reviews are fully append-only. There is one review per event.
- Self-review is refused by the service and by a trigger, so it holds for every database login. With a single admin, their events stay awaiting review.

**Audit hash.**
- `audit_log.break_glass_event_id` is part of each row's hash only when it is set. Rows without it, including every row written before this change, keep the exact digest they had, so the whole chain still verifies.
- Rolling the migration back would break verification for rows that carry an event id. Its `down.sql` is for dev/test only.

**No foreign keys to `user` or `session`.** Like the other patient tables, the event stores user and session ids without foreign keys: test contexts use synthetic ids, and sessions are not kept forever. The patient and event foreign keys are real.

## D-036 · Break-glass screens
2026-11-26 · Accepted · Project lead

The admin side of D-035.
- **Admin navigation:** Home, Patients, Break-glass reviews, Users, My account. The admin home shows how many accesses are awaiting review.
- **`/admin/patients`** reuses the front desk search, so the query goes to a server action, never into the URL. **`/admin/patients/{id}`** shows the demographics, which admins may read and which are audited. Its "Clinical record" section stays locked until the admin gives a reason.
- **The reason form is inline, not a browser dialog.** Its heading takes focus, and each field explains what's missing. Once access is open, a banner shows when it ends and an "End access now" button. Until M3 the clinical section says nothing has been recorded yet.
- **`/admin/break-glass`** has two tabs, awaiting and reviewed (`?status=reviewed`; no patient data in the URL). Each event shows:
  - who opened which patient, when, and the access state
  - how many clinical views were made under it
  - the category and the written details
  - a link to the patient
- **Reviewing:**
  - Another admin chooses Appropriate, Not appropriate or Needs follow-up. A comment is required unless the access was appropriate.
  - Your own events show "a different admin must review it" instead of the form.

## D-037 · Consultation: build order, visits, vitals, allergies, notes
2026-11-27 · Accepted · Project lead (clinical items pending hospital sign-off)

**Build order.** M3 is built now, without prescribing and test ordering. Prescribing (M5b) follows the pharmacy core (M5a), and test ordering comes with the lab slice (M4). This changes architecture §3, slice 4: consultation no longer waits for the pharmacy core.

**Visits.**
- A nurse or doctor opens a visit. It's linked to today's queue entry when there is one, and a patient has at most one open visit (partial unique index). A new `visits` resource in the matrix covers this: nurse and doctor, create, read and update.
- The queue follows the visit:
  - a nurse opening it moves the patient waiting → with nurse
  - "send to doctor" moves them to waiting for doctor
  - a doctor taking it moves them to with doctor and makes that doctor the attending doctor
  - closing moves them to done
- Taking and closing are doctor actions (the `consultation_notes` create permission).
- A visit is never deleted. Its patient and opening details never change, and once closed it never changes (trigger).
- Visit types are outpatient, follow-up and emergency, pending sign-off.

**Vitals** (D-007).
- Vitals are append-only. A correction is a new row with `supersedes_id` and a reason; with no measurements it just strikes the original out. Each row is corrected once (unique `supersedes_id`; concurrent corrections are serialised).
- The architecture's `entered_in_error` column is dropped: a row is entered in error when another row supersedes it.
- Plausible ranges are CHECKed in SQL and validated in Zod, pending clinical sign-off: temperature 30–45 °C, pulse 20–250, respiratory rate 4–80, BP systolic 50–260 and diastolic 20–160 (systolic above diastolic, both or neither), SpO₂ 50–100 %, weight 0.3–400 kg, height 20–250 cm.

**Allergies** (D-007).
- Allergies are append-only, with a status of active, resolved or entered in error (which requires a reason). The current list is the rows nothing supersedes.
- "No known allergies" is an explicit row and is never assumed from an empty list. Recording an allergy retires it, and it can't be recorded while an allergy is active.
- The allergen is free text in M3. Prescribing (M5b) links it to allergen groups (D-005).

**Notes.**
- Every save is a new version, numbered per visit with the visit row locked, so numbers have no gaps.
- A save names the version it started from. If that isn't the newest, the save is kept with `is_conflict`, and the screen shows both. A later save from the newest version resolves the conflict.
- Diagnosis is free text, with no coding system in Phase 1.
- Notes can be added to a closed visit, for example a late addendum; versions make that safe.
- Each doctor has their own server draft per visit (D-011), deleted when a version is saved.

**Integrity.** Triggers keep a correction or new version on the same patient and visit as the row it follows. Audit entries carry ids, field names and counts, never clinical text.

**Who reads what.**
- Nurses and doctors see the clinical summary (header, allergies, timeline) and full visits.
- Every role with allergy access sees allergies.
- Lab, pharmacists and front desk get no visits or notes.
- Admins read clinical data only through break-glass (D-035) and can't write it.
