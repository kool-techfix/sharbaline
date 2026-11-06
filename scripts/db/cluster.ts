/**
 * Local PostgreSQL clusters for development and tests, run from the `embedded-postgres`
 * dev dependency so contributors and CI need neither Docker nor a system install.
 * Production uses the postgres image via Docker Compose; both apply the same
 * role/privilege SQL from deploy/postgres/init, so dev matches the deployed permissions.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const INIT_DIR = path.join(ROOT, "deploy/postgres/init");

export const SUPERUSER = "postgres";

export interface ClusterOptions {
  dataDir: string;
  port: number;
  superuserPassword: string;
  /** Keep the data directory after stop (dev). Tests use throwaway clusters. */
  persistent: boolean;
  quiet?: boolean;
}

export interface Cluster {
  options: ClusterOptions;
  /** Client connected as the superuser. Caller must `end()` it. */
  superClient(database?: string): Promise<pg.Client>;
  stop(): Promise<void>;
}

export async function startCluster(options: ClusterOptions): Promise<Cluster> {
  const pgInstance = new EmbeddedPostgres({
    databaseDir: options.dataDir,
    port: options.port,
    user: SUPERUSER,
    password: options.superuserPassword,
    authMethod: "scram-sha-256",
    persistent: options.persistent,
    // Bind to loopback only. Durability settings stay at PostgreSQL defaults
    // (fsync and synchronous_commit on), even for tests: CLAUDE.md rule 12.
    postgresFlags: ["-c", "listen_addresses=localhost", "-c", "timezone=UTC"],
    onLog: options.quiet ? () => {} : (m) => process.stdout.write(`[postgres] ${m}`),
    onError: (e) => process.stderr.write(`[postgres] ${String(e)}\n`),
  });

  if (!existsSync(path.join(options.dataDir, "PG_VERSION"))) {
    await pgInstance.initialise();
  }
  await pgInstance.start();

  return {
    options,
    async superClient(database = "postgres") {
      const client = new pg.Client({
        host: "localhost",
        port: options.port,
        user: SUPERUSER,
        password: options.superuserPassword,
        database,
      });
      await client.connect();
      return client;
    },
    stop: () => pgInstance.stop(),
  };
}

/** Substitute psql-style `:'name'` variables with safely quoted literals. */
export function renderPsqlVariables(
  sql: string,
  vars: Record<string, string>,
  client: pg.Client,
): string {
  return sql.replace(/:'([a-z_]+)'/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Missing psql variable: ${name}`);
    return client.escapeLiteral(value);
  });
}

export interface RolePasswords {
  ownerPassword: string;
  appPassword: string;
}

/** Create hms_owner and hms_app if missing. Idempotent. */
export async function ensureRoles(cluster: Cluster, passwords: RolePasswords): Promise<void> {
  const client = await cluster.superClient();
  try {
    const existing = await client.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('hms_owner', 'hms_app')",
    );
    if (existing.rowCount === 2) return;
    if (existing.rowCount !== 0) {
      throw new Error("Only one of hms_owner/hms_app exists; fix the cluster by hand.");
    }
    const sql = await readFile(path.join(INIT_DIR, "01-roles.sql"), "utf8");
    await client.query(
      renderPsqlVariables(
        sql,
        { owner_password: passwords.ownerPassword, app_password: passwords.appPassword },
        client,
      ),
    );
  } finally {
    await client.end();
  }
}

/** Create a database owned by hms_owner and apply the standard privileges. Idempotent. */
export async function ensureDatabase(cluster: Cluster, name: string): Promise<void> {
  const admin = await cluster.superClient();
  try {
    const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(name)} OWNER hms_owner`);
    }
  } finally {
    await admin.end();
  }
  const db = await cluster.superClient(name);
  try {
    await db.query(await readFile(path.join(INIT_DIR, "02-database.sql"), "utf8"));
  } finally {
    await db.end();
  }
}

export function connectionUrl(
  port: number,
  user: string,
  password: string,
  database: string,
): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost:${port}/${encodeURIComponent(database)}`;
}

/** Run the Prisma CLI against a specific database as hms_owner. */
export function runPrisma(args: string[], migrateDatabaseUrl: string, quiet = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(ROOT, "node_modules/.bin/prisma"), args, {
      cwd: ROOT,
      env: { ...process.env, MIGRATE_DATABASE_URL: migrateDatabaseUrl },
      stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
    });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`prisma ${args.join(" ")} exited ${code}\n${stderr}`)),
    );
  });
}
