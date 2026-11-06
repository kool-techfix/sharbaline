/**
 * `pnpm db:migrate:check` — prove every migration is reversible (CLAUDE.md rule 13).
 * On a throwaway cluster: apply all → roll back every migration one by one → confirm the
 * schema is empty again → apply all once more. Runs in CI.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { connectionUrl, ensureDatabase, ensureRoles, runPrisma, startCluster } from "./cluster";
import { listMigrationNames, migrationsMissingDown, rollbackLatest } from "./migrations";
import { freePort } from "./free-port";

const missing = await migrationsMissingDown();
if (missing.length > 0) {
  console.error(`Migrations without down.sql:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

const dataDir = await mkdtemp(path.join(tmpdir(), "hms-migcheck-"));
const port = await freePort();
const secret = () => randomBytes(18).toString("base64url");
const passwords = { ownerPassword: secret(), appPassword: secret() };
const cluster = await startCluster({
  dataDir,
  port,
  superuserPassword: secret(),
  persistent: false,
  quiet: true,
});

let failed = false;
try {
  await ensureRoles(cluster, passwords);
  await ensureDatabase(cluster, "hms_migcheck");
  const ownerUrl = connectionUrl(port, "hms_owner", passwords.ownerPassword, "hms_migcheck");
  const expected = await listMigrationNames();

  console.log(`Applying ${expected.length} migration(s)…`);
  await runPrisma(["migrate", "deploy"], ownerUrl, true);

  const rolledBack: string[] = [];
  for (;;) {
    const name = await rollbackLatest(ownerUrl);
    if (!name) break;
    rolledBack.push(name);
    console.log(`  down: ${name}`);
  }
  if (rolledBack.length !== expected.length) {
    throw new Error(`Rolled back ${rolledBack.length} of ${expected.length} migrations.`);
  }

  const leftovers = await cluster.superClient("hms_migcheck");
  const objects = await leftovers.query<{ kind: string; name: string }>(`
    SELECT 'table' AS kind, tablename AS name FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    UNION ALL SELECT 'type', typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    UNION ALL SELECT 'function', proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    UNION ALL SELECT 'sequence', sequencename FROM pg_sequences WHERE schemaname = 'public'`);
  await leftovers.end();
  if (objects.rowCount) {
    const list = objects.rows.map((r) => `${r.kind} ${r.name}`).join(", ");
    throw new Error(`down.sql left objects behind: ${list}`);
  }

  console.log("Re-applying all migrations…");
  await runPrisma(["migrate", "deploy"], ownerUrl, true);
  console.log(`OK: ${expected.length} migration(s) applied, reversed and re-applied cleanly.`);
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await cluster.stop();
  await rm(dataDir, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
