import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/server/config/env";

export type Db = PrismaClient;

/** Build a client for a given connection string. Tests use this with their own database. */
export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One client per process; survives Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { hmsDb?: Db };

/** The app's database client, connected as the restricted hms_app role. */
export function db(): Db {
  globalForDb.hmsDb ??= createDb(serverEnv().DATABASE_URL);
  return globalForDb.hmsDb;
}
