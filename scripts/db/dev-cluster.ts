/**
 * `pnpm db:start` — run the local development PostgreSQL in the foreground.
 * Data lives in .data/postgres (git-ignored). Role names, passwords, port and database
 * come from DATABASE_URL / MIGRATE_DATABASE_URL in .env, so there is one source of truth.
 */
import "dotenv/config";
import path from "node:path";
import { ensureDatabase, ensureRoles, startCluster } from "./cluster";

function parse(name: string) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set. Copy .env.example to .env.`);
  const url = new URL(raw);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ""),
    host: url.hostname,
  };
}

const app = parse("DATABASE_URL");
const owner = parse("MIGRATE_DATABASE_URL");
if (app.user !== "hms_app" || owner.user !== "hms_owner") {
  throw new Error("DATABASE_URL must use hms_app and MIGRATE_DATABASE_URL hms_owner.");
}
if (app.port !== owner.port || app.database !== owner.database) {
  throw new Error("DATABASE_URL and MIGRATE_DATABASE_URL must point at the same database.");
}
if (!["localhost", "127.0.0.1"].includes(app.host)) {
  throw new Error("db:start only runs a local dev cluster; DATABASE_URL must be localhost.");
}
const superuserPassword = process.env.DEV_DB_SUPERUSER_PASSWORD;
if (!superuserPassword) throw new Error("DEV_DB_SUPERUSER_PASSWORD is not set.");

const cluster = await startCluster({
  dataDir: path.resolve(".data/postgres"),
  port: app.port,
  superuserPassword,
  persistent: true,
  quiet: true,
});

await ensureRoles(cluster, { ownerPassword: owner.password, appPassword: app.password });

// Dev only: `prisma migrate dev` needs a shadow database, which hms_owner creates.
// The on-site server never grants this.
const admin = await cluster.superClient();
await admin.query("ALTER ROLE hms_owner CREATEDB");
await admin.end();

await ensureDatabase(cluster, app.database);

console.log(`Dev PostgreSQL ready on localhost:${app.port}/${app.database}. Ctrl-C to stop.`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await cluster.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
