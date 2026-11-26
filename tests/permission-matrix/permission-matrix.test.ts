import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Service } from "@/server/kernel/define-service";
import { ForbiddenError } from "@/server/kernel/errors";
import { can, type Permission } from "@/server/permissions/matrix";
import { ROLES } from "@/server/permissions/roles";
import { userContext } from "../integration/helpers/context";
import { createTestDatabase, type TestDatabase } from "../integration/helpers/db";
import { FIXTURES, PUBLIC_SERVICES } from "./fixtures";

/*
 * Generated role × service suite (scope §5 M1 acceptance: "a user without the permission
 * receives 403 for every protected endpoint"). Every service under src/server/services is
 * discovered from the code, so a new service is covered without anyone remembering to.
 * Every server action and route handler reaches data only through these services (rule 4).
 */

const SERVICES_DIR = path.resolve(import.meta.dirname, "../../src/server/services");

function serviceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return serviceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function isService(value: unknown): value is Service<unknown> {
  return typeof value === "function" && "meta" in value;
}

const services: Service<unknown>[] = [];
for (const file of serviceFiles(SERVICES_DIR)) {
  const exports = (await import(file)) as Record<string, unknown>;
  services.push(...Object.values(exports).filter(isService));
}
const isPublic = (service: Service<unknown>) => "public" in service.meta.permission;
const protectedServices = services.filter((service) => !isPublic(service));

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

describe("service discovery", () => {
  it("finds the services (guards against the suite silently testing nothing)", () => {
    expect(protectedServices.length).toBeGreaterThanOrEqual(5);
  });

  it("has a fixture for every protected service, and no fixture without a service", () => {
    const actions = protectedServices.map((service) => service.meta.action).sort();
    expect(Object.keys(FIXTURES).sort()).toEqual(actions);
  });

  it("declares the permission each fixture expects", () => {
    for (const service of protectedServices) {
      expect(service.meta.permission, service.meta.action).toEqual(FIXTURES[service.meta.action]?.permission);
    }
  });

  it("lists every public service explicitly, with a reason", () => {
    const actions = services.filter(isPublic).map((service) => service.meta.action).sort();
    expect(Object.keys(PUBLIC_SERVICES).sort()).toEqual(actions);
  });

  it("uses each audit action name once", () => {
    const actions = services.map((service) => service.meta.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

async function auditOutcomes(requestId: string): Promise<string[]> {
  const { rows } = await t.appPool.query("SELECT outcome FROM audit_log WHERE request_id = $1 ORDER BY seq", [
    requestId,
  ]);
  return rows.map((row: { outcome: string }) => row.outcome);
}

describe.each(protectedServices.map((service) => [service.meta.action, service] as const))("%s", (action, service) => {
  const permission = service.meta.permission as Permission;

  it.each([...ROLES])("%s", async (role) => {
    const fixture = FIXTURES[action];
    if (!fixture) throw new Error(`no fixture for ${action}`);
    const input = await fixture.input(t);
    const ctx = userContext(role);

    if (can(role, permission)) {
      // Allowed: the call may succeed or fail for its own reasons, but never on the role.
      await service(ctx, input, t.db);
      expect(await auditOutcomes(ctx.requestId)).not.toContain("denied");
    } else {
      const error = await service(ctx, input, t.db).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ForbiddenError);
      // Clinical services open to admins through break-glass ask for it instead (D-035).
      const expected = service.meta.breakGlass && role === "admin" ? "break_glass_required" : "role_not_permitted";
      expect((error as ForbiddenError).reasonCode).toBe(expected);
      expect(await auditOutcomes(ctx.requestId)).toEqual(["denied"]);
    }
  });

  it("anonymous callers", async () => {
    const fixture = FIXTURES[action];
    if (!fixture) throw new Error(`no fixture for ${action}`);
    const input = await fixture.input(t);
    const anonymous = { ...userContext("admin"), actor: { kind: "anonymous" as const } };
    await expect(service(anonymous, input, t.db)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
