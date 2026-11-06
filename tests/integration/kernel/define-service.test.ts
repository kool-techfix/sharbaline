/**
 * The service kernel is the single write path (CLAUDE.md rules 4–5). These tests pin its
 * contract: permission → validation → transaction → audit, and what is committed, rolled
 * back and audited in each case.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import { defineService } from "@/server/kernel/define-service";
import { ForbiddenError, ValidationError } from "@/server/kernel/errors";
import { fail, ok } from "@/server/kernel/outcome";
import { anonymousContext, userContext } from "../helpers/context";
import { createTestDatabase, type TestDatabase } from "../helpers/db";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  // A scratch table owned by hms_owner; default privileges let hms_app write to it.
  await t.ownerPool.query("CREATE TABLE kernel_probe (id uuid PRIMARY KEY, owner_id uuid)");
});

afterAll(async () => {
  await t.drop();
});

const runSpy = vi.fn();

const probeInsert = defineService({
  action: "test.probe_insert",
  input: z.object({
    id: z.uuid(),
    mode: z.enum(["succeed", "expected_failure", "throw"]).default("succeed"),
  }),
  permission: { resource: "users", action: "create" }, // admin only
  audit: {
    resourceType: "kernel_probe",
    resourceId: (input) => input.id,
    metadata: (input) => ({ mode: input.mode }),
  },
  async run({ tx, input }) {
    runSpy();
    await tx.$executeRaw`INSERT INTO kernel_probe (id) VALUES (${input.id}::uuid)`;
    if (input.mode === "throw") throw new Error("simulated crash after write");
    if (input.mode === "expected_failure") {
      return fail("probe_rejected", "errors.unexpected", { attempts: 1 });
    }
    return ok({ id: input.id });
  },
});

const ownRowsOnly = defineService({
  action: "test.probe_owned",
  input: z.object({ id: z.uuid(), ownerId: z.uuid() }),
  permission: { resource: "scanned_documents", action: "void" },
  audit: { resourceType: "kernel_probe", resourceId: (input) => input.id },
  async authorize({ input, ctx }) {
    return ctx.actor.kind === "user" && ctx.actor.userId === input.ownerId;
  },
  async run({ tx, input }) {
    await tx.$executeRaw`INSERT INTO kernel_probe (id, owner_id) VALUES (${input.id}::uuid, ${input.ownerId}::uuid)`;
    return ok(null);
  },
});

const publicPing = defineService({
  action: "test.public_ping",
  input: z.object({}),
  permission: { public: true, reason: "test: no role needed" },
  audit: { resourceType: "system" },
  run: async () => ok("pong"),
});

async function probeExists(id: string): Promise<boolean> {
  const { rowCount } = await t.appPool.query("SELECT 1 FROM kernel_probe WHERE id = $1", [id]);
  return rowCount === 1;
}

async function auditFor(requestId: string) {
  const { rows } = await t.appPool.query(
    `SELECT action, outcome, reason_code, resource_type, resource_id, actor_user_id, actor_role,
            session_id, device_id, host(ip) AS ip, metadata
       FROM audit_log WHERE request_id = $1 ORDER BY seq`,
    [requestId],
  );
  return rows;
}

describe("defineService", () => {
  it("runs a permitted call in a transaction and audits success with the actor", async () => {
    const ctx = userContext("admin");
    const id = uuidv7();

    const outcome = await probeInsert(ctx, { id }, t.db);

    expect(outcome).toEqual({ ok: true, value: { id } });
    expect(await probeExists(id)).toBe(true);
    const [entry, ...rest] = await auditFor(ctx.requestId);
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      action: "test.probe_insert",
      outcome: "success",
      reason_code: null,
      resource_type: "kernel_probe",
      resource_id: id,
      actor_role: "admin",
      ip: "192.0.2.10",
      metadata: { mode: "succeed" },
    });
    if (ctx.actor.kind !== "user") throw new Error("expected user actor");
    expect(entry.actor_user_id).toBe(ctx.actor.userId);
    expect(entry.session_id).toBe(ctx.actor.sessionId);
    expect(entry.device_id).toBe(ctx.deviceId);
  });

  it.each(["front_desk", "nurse", "doctor", "lab", "pharmacist"] as const)(
    "denies %s before validating or running, and audits the denial",
    async (role) => {
      runSpy.mockClear();
      const ctx = userContext(role);
      const id = uuidv7();

      await expect(probeInsert(ctx, { id }, t.db)).rejects.toBeInstanceOf(ForbiddenError);

      expect(runSpy).not.toHaveBeenCalled();
      expect(await probeExists(id)).toBe(false);
      expect(await auditFor(ctx.requestId)).toMatchObject([
        { outcome: "denied", reason_code: "role_not_permitted", actor_role: role },
      ]);
    },
  );

  it("denies anonymous callers of a role-protected service", async () => {
    const ctx = anonymousContext();
    await expect(probeInsert(ctx, { id: uuidv7() }, t.db)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditFor(ctx.requestId)).toMatchObject([
      { outcome: "denied", actor_user_id: null, actor_role: null },
    ]);
  });

  it("rejects invalid input without running, and audits field names but never values", async () => {
    runSpy.mockClear();
    const ctx = userContext("admin");
    const leakyValue = "Adaeze Okafor 0803 555 0192"; // synthetic, shaped like PHI

    const call = probeInsert(ctx, { id: leakyValue, mode: "nonsense" }, t.db);

    const error = await call.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues.map((i) => i.path).sort()).toEqual(["id", "mode"]);
    expect(JSON.stringify(error)).not.toContain("Adaeze");
    expect(runSpy).not.toHaveBeenCalled();

    const entries = await auditFor(ctx.requestId);
    expect(entries).toMatchObject([
      { outcome: "failure", reason_code: "invalid_input", metadata: { fields: "id,mode" } },
    ]);
    expect(JSON.stringify(entries)).not.toContain("Adaeze");
    expect(JSON.stringify(entries)).not.toContain("0803");
  });

  it("rolls back everything when run throws, then audits the error outside the transaction", async () => {
    const ctx = userContext("admin");
    const id = uuidv7();

    await expect(probeInsert(ctx, { id, mode: "throw" }, t.db)).rejects.toThrow("simulated crash");

    expect(await probeExists(id)).toBe(false);
    expect(await auditFor(ctx.requestId)).toMatchObject([
      { outcome: "error", reason_code: "unexpected_error", resource_id: id },
    ]);
  });

  it("commits an expected failure with its side effects and a failure entry", async () => {
    const ctx = userContext("admin");
    const id = uuidv7();

    const outcome = await probeInsert(ctx, { id, mode: "expected_failure" }, t.db);

    expect(outcome).toEqual({
      ok: false,
      reasonCode: "probe_rejected",
      messageKey: "errors.unexpected",
      metadata: { attempts: 1 },
    });
    expect(await probeExists(id)).toBe(true);
    expect(await auditFor(ctx.requestId)).toMatchObject([
      {
        outcome: "failure",
        reason_code: "probe_rejected",
        metadata: { mode: "expected_failure", attempts: 1 },
      },
    ]);
  });

  it("applies record-level authorize rules and rolls back on denial", async () => {
    const owner = userContext("nurse");
    const other = userContext("nurse");
    if (owner.actor.kind !== "user") throw new Error("expected user actor");
    const ownerId = owner.actor.userId;

    const allowedId = uuidv7();
    await expect(ownRowsOnly(owner, { id: allowedId, ownerId }, t.db)).resolves.toMatchObject({ ok: true });

    const deniedId = uuidv7();
    await expect(ownRowsOnly(other, { id: deniedId, ownerId }, t.db)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await probeExists(deniedId)).toBe(false);
    expect(await auditFor(other.requestId)).toMatchObject([
      { outcome: "denied", reason_code: "record_not_permitted", resource_id: deniedId },
    ]);
  });

  it("runs explicitly public services for anonymous callers, still audited", async () => {
    const ctx = anonymousContext();
    await expect(publicPing(ctx, {}, t.db)).resolves.toEqual({ ok: true, value: "pong" });
    expect(await auditFor(ctx.requestId)).toMatchObject([
      { action: "test.public_ping", outcome: "success", actor_user_id: null },
    ]);
  });

  it("treats a retried create with the same client UUID as a conflict, not a duplicate", async () => {
    const ctx = userContext("admin");
    const id = uuidv7();
    await probeInsert(ctx, { id }, t.db);
    await expect(probeInsert(ctx, { id }, t.db)).rejects.toThrow();
    const { rows } = await t.appPool.query("SELECT count(*)::int AS n FROM kernel_probe WHERE id = $1", [id]);
    expect(rows[0].n).toBe(1);
  });
});
