/**
 * Down-migrations for Prisma (D-001, D-014). Prisma only runs `migration.sql` (the "up");
 * each migration folder also carries a hand-reviewed `down.sql`. Rolling back runs
 * that file and removes the migration's row from `_prisma_migrations` in one transaction,
 * so a failed down leaves both the schema and Prisma's history untouched.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../prisma/migrations");

export async function listMigrationNames(): Promise<string[]> {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Every migration must ship a down.sql. Returns the names that don't. */
export async function migrationsMissingDown(): Promise<string[]> {
  const names = await listMigrationNames();
  return names.filter((n) => !existsSync(path.join(MIGRATIONS_DIR, n, "down.sql")));
}

/** Roll back the most recently applied migration. Returns its name, or null if none. */
export async function rollbackLatest(ownerUrl: string): Promise<string | null> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const hasTable = await client.query("SELECT to_regclass('public._prisma_migrations') AS t");
    if (hasTable.rows[0]?.t === null) return null;

    const latest = await client.query<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY migration_name DESC LIMIT 1`,
    );
    const name = latest.rows[0]?.migration_name;
    if (!name) return null;

    const downPath = path.join(MIGRATIONS_DIR, name, "down.sql");
    if (!existsSync(downPath)) throw new Error(`Migration ${name} has no down.sql`);
    const downSql = await readFile(downPath, "utf8");

    await client.query("BEGIN");
    try {
      await client.query(downSql);
      await client.query("DELETE FROM _prisma_migrations WHERE migration_name = $1", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return name;
  } finally {
    await client.end();
  }
}
