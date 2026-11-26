import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/server/config/env";
import { currentClient, type CachedClient } from "./cache";

export type Db = PrismaClient;

/** Build a client for a given connection string. Tests use this with their own database. */
export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One client per process, kept on globalThis so dev hot reloads don't open a new pool each time.
// It remembers which generated client built it: after `prisma generate` the dev server reloads
// that module, and a client from the old one doesn't know the new tables (D-034).
const globalForDb = globalThis as unknown as { hmsDb?: CachedClient<Db> };

/** The app's database client, connected as the restricted hms_app role. */
export function db(): Db {
  globalForDb.hmsDb = currentClient(globalForDb.hmsDb, PrismaClient, () => createDb(serverEnv().DATABASE_URL));
  return globalForDb.hmsDb.client;
}
