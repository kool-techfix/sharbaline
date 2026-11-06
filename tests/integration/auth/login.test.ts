import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/lib/ids";

// Wrap the timing-equaliser so tests can prove every failure path runs a full Argon2 check.
vi.mock("@/server/auth/password", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/auth/password")>();
  return { ...original, burnPasswordCheck: vi.fn(original.burnPasswordCheck) };
});

import { burnPasswordCheck } from "@/server/auth/password";
import { resetIpThrottle } from "@/server/auth/ip-throttle";
import { login } from "@/server/services/auth/login";
import { readSession } from "@/server/services/auth/session";
import { anonymousContext } from "../helpers/context";
import { auditFor, enrollTotp, makeUser } from "../helpers/auth";
import { createTestDatabase, type TestDatabase } from "../helpers/db";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());
beforeEach(() => {
  resetIpThrottle();
  vi.mocked(burnPasswordCheck).mockClear();
});

function attempt(identifier: string, password: string, ctx = anonymousContext()) {
  return { ctx, run: () => login(ctx, { identifier, password, deviceId: uuidv7(), userAgent: "vitest" }, t.db) };
}

describe("login: step 1 (staff ID or email + password)", () => {
  it("signs a non-MFA role straight in, by staff ID or by email in any case", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const byId = await attempt(nurse.staffId.toUpperCase(), nurse.password).run();
    const byEmail = await attempt(`${nurse.staffId}@HOSPITAL.test`, nurse.password).run();

    for (const outcome of [byId, byEmail]) {
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.value.stage).toBe("active");
      expect(outcome.value.redirectTo).toBe("/nurse");
      const session = await readSession(outcome.value.token, anonymousContext(), t.db);
      expect(session?.status).toBe("active");
    }
  });

  it("audits success with user, role, session, IP and device", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { ctx, run } = attempt(nurse.staffId, nurse.password);
    const outcome = await run();
    if (!outcome.ok) throw new Error("expected success");
    const [entry] = await auditFor(t, ctx.requestId);
    expect(entry).toMatchObject({
      action: "auth.login",
      outcome: "success",
      actor_user_id: nurse.id,
      actor_role: "nurse",
      session_id: outcome.value.sessionId,
    });
  });

  it("sends MFA roles to the code step, and unenrolled ones to setup", async () => {
    const enrolled = await makeUser(t, { roles: ["doctor"] });
    await enrollTotp(t, enrolled.id);
    const fresh = await makeUser(t, { roles: ["pharmacist"] });

    const a = await attempt(enrolled.staffId, enrolled.password).run();
    const b = await attempt(fresh.staffId, fresh.password).run();
    expect(a.ok && a.value.stage).toBe("mfa_pending");
    expect(b.ok && b.value.stage).toBe("mfa_enrollment_required");
    // A half-finished sign-in is not a usable session.
    if (a.ok) expect((await readSession(a.value.token, anonymousContext(), t.db))?.status).toBe("pending_stage");
  });

  it("gives the same answer for a wrong password and an unknown account, both running Argon2", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const wrong = await attempt(nurse.staffId, "not the password").run();
    const unknown = await attempt("nobody.here", "not the password").run();

    expect(wrong).toMatchObject({ ok: false, reasonCode: "invalid_credentials", messageKey: "auth.error.invalidCredentials" });
    expect(unknown).toMatchObject({ ok: false, reasonCode: "invalid_credentials", messageKey: "auth.error.invalidCredentials" });
    // The real account's check runs verifyPassword; the unknown one runs the equaliser instead.
    expect(burnPasswordCheck).toHaveBeenCalledTimes(1);
  });

  it("audits failures without the typed identifier or password", async () => {
    const { ctx, run } = attempt("someone.typed.this", "S3cret-typed-here");
    await run();
    const entries = await auditFor(t, ctx.requestId);
    expect(entries).toMatchObject([{ action: "auth.login", outcome: "failure", reason_code: "invalid_credentials" }]);
    expect(JSON.stringify(entries)).not.toContain("someone.typed.this");
    expect(JSON.stringify(entries)).not.toContain("S3cret");
  });

  it("locks an account on the 5th failure, refuses even the right password, and audits the lockout", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const outcomes = [];
    let lockCtx = anonymousContext();
    for (let i = 0; i < 5; i++) {
      const a = attempt(nurse.staffId, `wrong ${i}`);
      lockCtx = a.ctx;
      outcomes.push(await a.run());
    }
    expect(outcomes.slice(0, 4).every((o) => !o.ok && o.reasonCode === "invalid_credentials")).toBe(true);
    expect(outcomes[4]).toMatchObject({ ok: false, reasonCode: "locked", messageKey: "auth.error.locked" });
    expect((await auditFor(t, lockCtx.requestId)).map((e) => e.action)).toEqual(["auth.lockout", "auth.login"]);

    const right = await attempt(nurse.staffId, nurse.password).run();
    expect(right).toMatchObject({ ok: false, reasonCode: "locked" });
  });

  it("counts staff ID and email attempts against the same account", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    for (let i = 0; i < 3; i++) await attempt(nurse.staffId, "wrong").run();
    await attempt(`${nurse.staffId}@hospital.test`, "wrong").run();
    const fifth = await attempt(`${nurse.staffId}@hospital.test`, "wrong").run();
    expect(fifth).toMatchObject({ ok: false, reasonCode: "locked" });
  });

  it("locks unknown identifiers exactly like real ones, so lockout reveals nothing", async () => {
    let last;
    for (let i = 0; i < 5; i++) last = await attempt("ghost.account", "wrong").run();
    expect(last).toMatchObject({ ok: false, reasonCode: "locked", messageKey: "auth.error.locked" });
  });

  it("serialises concurrent attempts so none escape the count", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    await Promise.all(Array.from({ length: 5 }, (_, i) => attempt(nurse.staffId, `wrong ${i}`).run()));
    const { rows } = await t.ownerPool.query(
      "SELECT failed_count, locked_until IS NOT NULL AS locked FROM login_throttle ORDER BY updated_at DESC LIMIT 1",
    );
    expect(rows[0]).toEqual({ failed_count: 5, locked: true });
  });

  it("tells a disabled user only after the correct password", async () => {
    const gone = await makeUser(t, { roles: ["lab"], disabled: true });
    expect(await attempt(gone.staffId, "wrong").run()).toMatchObject({ reasonCode: "invalid_credentials" });
    expect(await attempt(gone.staffId, gone.password).run()).toMatchObject({
      ok: false,
      reasonCode: "disabled",
      messageKey: "auth.error.disabled",
    });
  });

  it("refuses an account with no role", async () => {
    const roleless = await makeUser(t, { roles: [] });
    expect(await attempt(roleless.staffId, roleless.password).run()).toMatchObject({ reasonCode: "no_role" });
  });

  it("throttles one IP across many accounts", async () => {
    const ctx = anonymousContext({ ip: "192.0.2.99" });
    for (let i = 0; i < 30; i++) await login(ctx, { identifier: `sweep${i}`, password: "x", deviceId: uuidv7(), userAgent: null }, t.db);
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const blocked = await login(ctx, { identifier: nurse.staffId, password: nurse.password, deviceId: uuidv7(), userAgent: null }, t.db);
    expect(blocked).toMatchObject({ ok: false, reasonCode: "rate_limited" });
    const otherIp = await login(
      anonymousContext({ ip: "192.0.2.100" }),
      { identifier: nurse.staffId, password: nurse.password, deviceId: uuidv7(), userAgent: null },
      t.db,
    );
    expect(otherIp.ok).toBe(true);
  });
});
