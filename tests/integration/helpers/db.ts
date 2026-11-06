import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { connectionUrl } from "../../../scripts/db/cluster";
import { createDb, type Db } from "@/server/db/client";

export interface TestDatabase {
  name: string;
  /** Prisma client as hms_app: exactly the app's runtime privileges. */
  db: Db;
  /** Raw pool as hms_app, for asserting what the app role can and cannot do. */
  appPool: pg.Pool;
  /** Raw pool as hms_owner, for test fixtures (e.g. probe tables) and tamper simulations. */
  ownerPool: pg.Pool;
  drop(): Promise<void>;
}

async function superClient(): Promise<pg.Client> {
  const cfg = inject("pg");
  const client = new pg.Client({
    connectionString: connectionUrl(cfg.port, "postgres", cfg.superuserPassword, "postgres"),
  });
  await client.connect();
  return client;
}

/** A fresh, fully migrated database for one test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const cfg = inject("pg");
  const name = `t_${randomBytes(6).toString("hex")}`;

  const admin = await superClient();
  try {
    await admin.query(
      `CREATE DATABASE ${admin.escapeIdentifier(name)} TEMPLATE ${admin.escapeIdentifier(cfg.template)} OWNER hms_owner`,
    );
  } finally {
    await admin.end();
  }

  const appUrl = connectionUrl(cfg.port, "hms_app", cfg.appPassword, name);
  const ownerUrl = connectionUrl(cfg.port, "hms_owner", cfg.ownerPassword, name);
  const db = createDb(appUrl);
  const appPool = new pg.Pool({ connectionString: appUrl, max: 4 });
  const ownerPool = new pg.Pool({ connectionString: ownerUrl, max: 2 });

  return {
    name,
    db,
    appPool,
    ownerPool,
    async drop() {
      await db.$disconnect();
      await appPool.end();
      await ownerPool.end();
      const cleanup = await superClient();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${cleanup.escapeIdentifier(name)} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
