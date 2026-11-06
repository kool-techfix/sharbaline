# CLAUDE.md – Hospital Management System (HMS)

Project context for Claude Code. Read this at the start of every session. Keep it current: when a convention or decision changes, update this file in the same change.

Items marked **[TODO]** are not decided or not yet set up. Do not invent answers for them; ask, or propose and record the decision in `/docs/decisions.md`.

## What this project is

A hospital management system for a Nigerian hospital, built and maintained remotely by us while the hospital runs it day to day. Phase 1 solves two real problems:

1. Paper patient folders (single copy, lost or torn, slow to retrieve) → digital patient records plus scanned folder pages.
2. Doctors cannot see pharmacy stock when prescribing → live stock availability at prescribing time, a dispensing flow, and a log of unfilled prescriptions.

Full requirements: `/docs/scope.md`. Architecture, schema and build order: `/docs/architecture.md`. Design references: `/docs/design/*.png` (references, not specs; see UI conventions). Decisions log: `/docs/decisions.md`.

## The three principles (they override convenience)

- **Availability**: records must be reachable during internet outages, slow networks and power interruptions. The hospital LAN is the backbone. Nothing needed for daily work may depend on the internet.
- **Accessibility**: simple role-specific screens, minimal typing, modest laptops and slow networks, WCAG 2.1 AA.
- **Security**: least privilege, every access audited, encryption, NDPA-aligned handling of patient data.

If a task conflicts with a principle, stop and say so instead of working around it.

## Deployment model (shapes many decisions)

- Primary on-site server on the hospital LAN, running Docker Compose: `app`, `postgres`, `proxy`, `backup`, `monitor-agent`.
- Standby server with a PostgreSQL replica. NAS for local backups. Encrypted cloud backup/sync copy.
- Workstations are browsers (installable PWA). Phase 1 offline behavior = read-only encrypted cache plus draft autosave when the server is unreachable.
- Generator plus UPS exist, but power can still drop abruptly, so every write must be crash-safe.

## Stack (versions and reasons: D-020)

- Next.js 16 (App Router) + TypeScript 6 (strict), Tailwind CSS 4, shadcn-style components in `src/components/ui`
- PostgreSQL + **Prisma** (decided, D-001). Triggers, CHECKs, trigram indexes, sequences and grants go as hand-written SQL in the migration; every migration folder has a hand-reviewed `down.sql`; row locks use `$queryRaw`/TypedSQL inside the service kernel transaction.
- Zod for validation at every boundary
- Vitest (unit/integration), Playwright (e2e)
- PostgreSQL 18; locally and in tests via the `embedded-postgres` dev dependency, no Docker needed (D-015)
- Two DB roles: `hms_owner` (migrations only) and `hms_app` (runtime, DML only) (D-016)
- Package manager: **pnpm** (decided, D-002)

## Commands

First run: `pnpm install`, `cp .env.example .env`, `pnpm db:start` (leave running), `pnpm db:migrate`.

```
pnpm db:start           # local PostgreSQL in the foreground (data in .data/postgres)
pnpm dev                # run locally (needs db:start)
pnpm build              # production build
pnpm lint               # eslint (zero warnings) + typecheck
pnpm test               # unit + integration (integration starts its own throwaway PostgreSQL)
pnpm test:unit          # unit only, fast
pnpm test:integration   # integration only
pnpm test:e2e           # playwright against a production build; on macOS 12 prefix PLAYWRIGHT_CHANNEL=chrome
pnpm db:migrate         # apply migrations (prisma migrate deploy)
pnpm db:migrate:dev     # create a migration: use --create-only, add hand-written SQL + down.sql, then apply
pnpm db:migrate:down    # roll back the latest migration (dev only)
pnpm db:migrate:check   # every migration goes up, down, up cleanly (runs in CI)
pnpm db:seed            # load SYNTHETIC seed data (refuses in production)
docker compose up       # full on-site stack [TODO: deploy PR]
```

Run lint and tests before declaring any task done.

## Repo layout (full tree in `/docs/architecture.md` §1)

```
/docs/            scope.md, decisions.md, design/*.png, runbooks/
/src/app/         routes and pages
/src/components/  shared UI components (design system)
/src/server/      services, permissions, audit, db access
/src/lib/         shared utilities
/prisma/          schema.prisma, migrations/<ts>_<name>/{migration,down}.sql, seed/
/scripts/db/      local/test PostgreSQL, down-migrations, migration check
/deploy/          postgres init SQL + config now; compose, proxy, backup in the deploy PR
/tests/           integration (with helpers) and e2e; unit tests sit next to source as *.test.ts
```

## Hard rules (never break these)

### Patient data
1. **Never use real patient data** in development, tests, fixtures, screenshots or prompts. Seed data is synthetic only.
2. **Never log patient data** (names, phone numbers, notes, IDs tied to people) in application logs, error messages, URLs or analytics. Log opaque IDs only.
3. Never commit secrets, keys or `.env` files. Use environment variables; keep `.env.example` current.

### Writes, permissions, audit
4. **All mutations go through the service layer** (`/src/server/services`). No direct database writes from route handlers or components.
5. Every service function that touches patient data must: check the caller's role permission, validate input with Zod, run in a **transaction**, and write an **audit entry**.
6. **Permissions are enforced server-side.** Hiding a button is not security. Every new endpoint or server action needs a permission check and a test for each role.
7. **Reads of patient records are audited too**, not just writes.
8. Break-glass access (admin or out-of-role access to a clinical record) requires a reason, is flagged, and is logged.

### Data integrity
9. **Clinical notes, results, vitals, allergies, dispense records, audit entries, stock movements and document void events are append-only.** Corrections are new entries referencing the original (e.g. vitals "entered in error" with a reason, allergy status active/resolved/entered in error). Never update or delete them in place. Nothing patient-related is ever hard-deleted, including voided scans.
10. **Stock is a ledger.** Quantity must never go negative, including under concurrent dispensing. Current quantity must equal the sum of ledger entries. Dispensing and the stock movement are one transaction.
11. **Records get client-generated UUIDs** so retries and offline queues are idempotent. Design every create endpoint to be safe to call twice.
12. Never disable PostgreSQL durability settings (`fsync`, `synchronous_commit` for critical writes) for convenience.
13. Migrations must be reversible and safe to run on a database with existing data. Never write a destructive migration without asking.
14. Store timestamps in UTC; display in `Africa/Lagos`.

### Availability
15. **No feature may require internet access to work.** Anything calling out must fail soft and queue.
16. UI must reflect the connection states defined in `/docs/scope.md` §7.1 (Online, Working offline, Server unreachable, Syncing). Do not collapse them into one "offline" state.
17. Offline cache on devices is encrypted, role-scoped, expires, and is wiped on logout.

## Roles

`front_desk`, `nurse`, `doctor`, `lab`, `pharmacist`, `admin`. The full permission matrix is in `/docs/scope.md` §4.1. Pharmacist sees limited demographics only (name, age, sex, patient ID, allergies). Admin does not read clinical records except via break-glass.

## Code conventions

- TypeScript `strict`. No `any` without a comment explaining why.
- Validate all external input (forms, query strings, uploads, API bodies) with Zod. Derive types from the schemas.
- Prefer small, pure, testable functions. Keep business rules (stock math, duplicate detection, permission checks) in `/src/server`, not in components.
- Server components by default; client components only when interaction needs them. Keep client bundles small (slow networks).
- Errors shown to users must be plain-language and never expose internals or patient data.
- Naming: domain terms exactly as in the glossary below.
- Comments explain why, not what.

## UI conventions

- **Scope and decisions outrank the designs.** The PNGs in `/docs/design/` are references for layout, hierarchy and look, not specifications (D-021). Where a PNG conflicts with `/docs/scope.md` or `/docs/decisions.md`, follow the scope and decisions. You may redesign away from a PNG to fit the scope.
- **Never build an element from a PNG that is outside Phase 1 scope or adds risk**, e.g. extra patient data on a screen, a state the scope doesn't define, or collapsed connection states. Leave it out, record the deviation in `/docs/decisions.md`, and mention it when reporting the work.
- Use design tokens (colors, type, spacing) defined once in Tailwind config. Primary teal `#0F766E`, navy headings **[TODO: confirm against final designs]**.
- Reuse shared components (Button, Input, Table, StatusChip, ConnectionChip, Sidebar, TopBar). Do not create one-off variants without reason.
- Targets: 1366×768 laptop first, tablet second. Body text ≥ 16 px, click targets ≥ 44 px, visible focus, full keyboard operation, WCAG 2.1 AA contrast.
- Minimal typing: prefer search-and-select, chips and sensible defaults.
- Status is never conveyed by color alone (add text or icon).
- Keep strings translatable (no hard-coded text scattered through logic).

## Testing expectations

- Every service is built with `defineService` (`src/server/kernel`, D-017): it checks the role, validates with Zod, runs in a transaction and writes the audit entry. Return `fail(...)` for expected failures (the transaction commits); throw only for real errors (it rolls back).
- Every service mutation: integration test covering permission allowed/denied, validation failure, audit entry written, transaction rollback on failure. Use `createTestDatabase()` and `userContext()` from `tests/integration/helpers`.
- Every new append-only table: attach `forbid_mutation()` triggers and revoke UPDATE/DELETE/TRUNCATE from `hms_app` in its migration (see the audit_log migration).
- Permission matrix: automated test for each role × protected resource.
- Stock: unit tests for arithmetic, a concurrency test for simultaneous dispensing, and the ledger-sum invariant.
- E2E (Playwright): registration → consultation → prescription → dispensing; lab order → result; behavior when the server is unreachable.
- Do not weaken or delete a failing test to make it pass. Fix the cause or ask.

## Workflow

- **Plan first** for anything larger than a small fix: restate the task, list files to change, flag risks, then wait for approval before large changes.
- Work in **vertical slices** (UI + API + DB + tests), one slice per branch. Build order is in `/docs/scope.md` §11.
- Small, focused commits with clear messages. Do not mix refactors with features.
- Never run destructive commands (dropping databases, force-pushing, deleting volumes) without explicit confirmation.
- When requirements are ambiguous or touch a **[CONFIRM]** item in the scope, ask instead of guessing.
- If you change a convention, schema concept or decision, update this file and `/docs/decisions.md` in the same change.

## Definition of done

- Fits the scope; follows the design references where they agree with it (deviations documented)
- Server-side permission checks and audit entries in place
- Tests added and passing; lint and typecheck clean
- No PHI in logs; synthetic data only
- Works at 1366×768 and with keyboard only
- Migration is reversible; seed data updated
- Docs updated where needed

## Domain glossary

- **Patient**: a person registered at the hospital, identified by a unique, immutable patient ID: hospital prefix + sequential number + Damm check digit as the last digit (e.g. `HSP-2073` + check digit), and a QR card containing that ID only.
- **Legacy card number**: the number on the old paper mini card; searchable, non-unique, used to find paper folders during the parallel run.
- **Visit**: one attendance by a patient; contains vitals, notes, orders and prescriptions.
- **Folder / paper folder**: the legacy physical record. Tracked by `paperFolderStatus` (not digitized / partial / digitized) and scanned into `ScannedDocument`s.
- **Test order / result**: a doctor-requested lab test and the lab's returned result.
- **Prescription / item**: a doctor's drug request; each item ends as dispensed, partial, substituted, unavailable or cancelled. Doctors may cancel/amend only while pending; pharmacists never edit prescriptions.
- **Allergy override**: a doctor's mandatory reason for prescribing against an active allergy; the pharmacist must acknowledge it before dispensing.
- **Void (scan)**: hiding a scanned document from default views with a reason; never a deletion; admin can restore.
- **Stock batch / movement**: a received quantity of a drug with expiry; every change is a ledger movement (receive, dispense, adjust, expire). Dispensing is first-expiry-first-out; expired batches are never available. Dispensing errors are fixed by a compensating movement flagged for admin review.
- **Unfilled prescription**: an item that could not be dispensed; logged to inform purchasing.
- **Break-glass**: logged emergency access outside normal permissions, with a mandatory reason and later review.
- **On-site server**: the hospital LAN server that runs the system day to day. **Standby**: replica server. **NAS**: local backup device.
- **RPO / RTO**: maximum acceptable data loss (15 min) and recovery time (1 hour) **[CONFIRM with client]**.

## Things not to do

- Do not add third-party services that must be reachable at runtime (auth providers, analytics, CDNs for critical assets).
- Do not store personal data in QR codes, local storage in plain text, or URLs.
- Do not add features outside Phase 1 scope (billing, insurance, inpatient, lab equipment integration, patient portal) without being asked.
- Do not paste real patient data or credentials into any prompt, issue or log.
