/**
 * Starts one throwaway PostgreSQL cluster for the integration run, creates the HMS roles
 * with the same SQL as production, and migrates a template database. Each test file then
 * copies the template (helpers/db.ts), so tests never share state. A copy is needed rather
 * than truncating between tests because append-only tables reject TRUNCATE by design.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { TestProject } from "vitest/node";
import {
  connectionUrl,
  ensureDatabase,
  ensureRoles,
  runPrisma,
  startCluster,
} from "../../scripts/db/cluster";
import { freePort } from "../../scripts/db/free-port";

export interface TestPostgres {
  port: number;
  superuserPassword: string;
  ownerPassword: string;
  appPassword: string;
  template: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    pg: TestPostgres;
  }
}

export default async function setup(project: TestProject) {
  const secret = () => randomBytes(18).toString("base64url");
  const dataDir = await mkdtemp(path.join(tmpdir(), "hms-test-"));
  const config: TestPostgres = {
    port: await freePort(),
    superuserPassword: secret(),
    ownerPassword: secret(),
    appPassword: secret(),
    template: "hms_template",
  };

  const cluster = await startCluster({
    dataDir,
    port: config.port,
    superuserPassword: config.superuserPassword,
    persistent: false,
    quiet: true,
  });
  await ensureRoles(cluster, config);
  await ensureDatabase(cluster, config.template);
  await runPrisma(
    ["migrate", "deploy"],
    connectionUrl(config.port, "hms_owner", config.ownerPassword, config.template),
    true,
  );

  project.provide("pg", config);

  return async () => {
    await cluster.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
}
