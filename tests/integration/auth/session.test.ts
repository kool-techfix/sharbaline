import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { resetIpThrottle } from "@/server/auth/ip-throttle";
import { login } from "@/server/services/auth/login";
import {
  changePassword,
  lockIdleSession,
  logout,
  readSession,
  switchActiveRole,
  touchSession,
  unlockSession,
} from "@/server/services/auth/session";
import {
  disableUser,
  issueTemporaryPassword,
  resetMfa,
  revokeUserSessionsService,
  unlockAccount,
} from "@/server/services/users/admin";
import { bootstrapAdmin } from "@/server/services/users/bootstrap";
import { ROLES } from "@/server/permissions/roles";
import { ForbiddenError, ValidationError } from "@/server/kernel/errors";
import { anonymousContext, userContext } from "../helpers/context";
import { auditFor, enrollTotp, makeUser, type TestUser } from "../helpers/auth";
import { createTestDatabase, type TestDatabase } from "../helpers/db";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());
beforeEach(() => resetIpThrottle());
afterEach(() => vi.useRealTimers());

async function signIn(user: TestUser, password = user.password) {
  const outcome = await login(
    anonymousContext(),
    { identifier: user.staffId, password, deviceId: uuidv7(), userAgent: null },
    t.db,
  );
  if (!outcome.ok) throw new Error(`sign-in failed: ${outcome.reasonCode}`);
  return outcome.value;
}

const status = async (token: string) => (await readSession(token, anonymousContext(), t.db))?.status;

describe("idle lock and unlock", () => {
  it("locks on the server after 10 minutes (+ grace) without activity, and audits it", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token, sessionId } = await signIn(nurse);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11.5 * 60_000);
    expect(await status(token)).toBe("locked");
    const { rows } = await t.appPool.query(
      "SELECT action, metadata FROM audit_log WHERE session_id = $1 AND action = 'auth.idle_lock'",
      [sessionId],
    );
    expect(rows).toEqual([{ action: "auth.idle_lock", metadata: { source: "server" } }]);
  });

  it("does not let the heartbeat count as activity", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token } = await signIn(nurse);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await touchSession(token, "heartbeat", t.db);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(await status(token)).toBe("locked");
  });

  it("stays unlocked while the browser reports activity", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token } = await signIn(nurse);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await touchSession(token, "activity", t.db);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(await status(token)).toBe("active");
  });

  it("activity reported after the idle limit doesn't revive the session (server lock holds)", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token } = await signIn(nurse);
    vi.useFakeTimers({ toFake: ["Date"] });
    // Browser closed; nothing reads the session for 30 minutes, so it isn't marked locked yet.
    vi.setSystemTime(Date.now() + 30 * 60_000);
    await touchSession(token, "activity", t.db);
    expect(await status(token)).toBe("locked");
  });

  it("activity can't extend a session past its 12-hour lifetime or for a disabled user", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token, sessionId } = await signIn(nurse);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 12 * 60 * 60_000 + 1000);
    await touchSession(token, "activity", t.db);
    const expired = await t.appPool.query("SELECT last_activity_at FROM session WHERE id = $1", [sessionId]);
    expect(expired.rows[0].last_activity_at.getTime()).toBeLessThan(Date.now() - 60 * 60_000);
    vi.useRealTimers();

    const lab = await makeUser(t, { roles: ["lab"] });
    const second = await signIn(lab);
    await t.ownerPool.query('UPDATE "user" SET disabled_at = now() WHERE id = $1', [lab.id]);
    const before = await t.appPool.query("SELECT last_activity_at FROM session WHERE id = $1", [second.sessionId]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await touchSession(second.token, "activity", t.db);
    const after = await t.appPool.query("SELECT last_activity_at FROM session WHERE id = $1", [second.sessionId]);
    expect(after.rows[0].last_activity_at).toEqual(before.rows[0].last_activity_at);
  });

  it("unlocks with the password, rotating the token", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token } = await signIn(nurse);
    await lockIdleSession(anonymousContext(), { token, source: "browser" }, t.db);
    expect(await status(token)).toBe("locked");

    const ctx = anonymousContext();
    const unlocked = await unlockSession(ctx, { token, password: nurse.password }, t.db);
    expect(unlocked.ok).toBe(true);
    if (!unlocked.ok) return;
    expect(await status(token)).toBeUndefined();
    expect(await status(unlocked.value.token)).toBe("active");
    expect(await auditFor(t, ctx.requestId)).toMatchObject([{ action: "auth.unlock", outcome: "success" }]);
  });

  it("signs the session out after 5 wrong unlock passwords", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token } = await signIn(nurse);
    await lockIdleSession(anonymousContext(), { token, source: "browser" }, t.db);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await unlockSession(anonymousContext(), { token, password: "nope" }, t.db));
    expect(results.slice(0, 4).every((r) => !r.ok && r.reasonCode === "invalid_password")).toBe(true);
    expect(results[4]).toMatchObject({ ok: false });
    expect(await status(token)).toBe("revoked");
  });
});

describe("sign-out, revocation and disabling", () => {
  it("logout revokes the session", async () => {
    const lab = await makeUser(t, { roles: ["lab"] });
    const { token } = await signIn(lab);
    const ctx = anonymousContext();
    await logout(ctx, { token }, t.db);
    expect(await status(token)).toBe("revoked");
    expect(await auditFor(t, ctx.requestId)).toMatchObject([{ action: "auth.logout", actor_user_id: lab.id }]);
  });

  it("admin revocation ends every session of the user on their next request", async () => {
    const lab = await makeUser(t, { roles: ["lab"] });
    const [a, b] = [await signIn(lab), await signIn(lab)];
    const outcome = await revokeUserSessionsService(userContext("admin"), { userId: lab.id }, t.db);
    expect(outcome).toMatchObject({ ok: true, value: { revoked: 2 } });
    expect(await status(a.token)).toBe("revoked");
    expect(await status(b.token)).toBe("revoked");
  });

  it("disabling a user signs them out immediately and blocks sign-in", async () => {
    const lab = await makeUser(t, { roles: ["lab"] });
    const { token } = await signIn(lab);
    await disableUser(userContext("admin"), { userId: lab.id }, t.db);
    expect(await status(token)).toBe("revoked");
    const again = await login(
      anonymousContext(),
      { identifier: lab.staffId, password: lab.password, deviceId: uuidv7(), userAgent: null },
      t.db,
    );
    expect(again).toMatchObject({ ok: false, reasonCode: "disabled" });
  });

  it("never disables the last active admin", async () => {
    const { rows } = await t.appPool.query(
      `SELECT u.id FROM "user" u JOIN user_role r ON r.user_id = u.id
        WHERE r.role = 'admin' AND u.disabled_at IS NULL`,
    );
    for (const row of rows) await t.ownerPool.query('UPDATE "user" SET disabled_at = now() WHERE id = $1', [row.id]);
    const onlyAdmin = await makeUser(t, { roles: ["admin"] });
    expect(await disableUser(userContext("admin"), { userId: onlyAdmin.id }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "last_admin",
    });
  });
});

describe("last-admin guard under concurrency", () => {
  it("two admins disabling each other at the same moment leave one of them active", async () => {
    const { rows } = await t.appPool.query(
      `SELECT u.id FROM "user" u JOIN user_role r ON r.user_id = u.id
        WHERE r.role = 'admin' AND u.disabled_at IS NULL`,
    );
    for (const row of rows) await t.ownerPool.query('UPDATE "user" SET disabled_at = now() WHERE id = $1', [row.id]);
    const [a, b] = [await makeUser(t, { roles: ["admin"] }), await makeUser(t, { roles: ["admin"] })];
    const as = (admin: TestUser) =>
      userContext("admin", { actor: { kind: "user", userId: admin.id, role: "admin", sessionId: uuidv7() } });

    const results = await Promise.all([
      disableUser(as(a), { userId: b.id }, t.db),
      disableUser(as(b), { userId: a.id }, t.db),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reasonCode === "last_admin")).toHaveLength(1);
    const active = await t.appPool.query(
      `SELECT count(*)::int AS n FROM "user" WHERE id = ANY($1) AND disabled_at IS NULL`,
      [[a.id, b.id]],
    );
    expect(active.rows[0].n).toBe(1);
  });
});

describe("temporary passwords", () => {
  it("are forced to change at next sign-in, and the new one must pass the policy", async () => {
    const desk = await makeUser(t, { roles: ["front_desk"] });
    const issued = await issueTemporaryPassword(userContext("admin"), { userId: desk.id }, t.db);
    if (!issued.ok) throw new Error("issue failed");
    const temp = issued.value.temporaryPassword;

    const first = await signIn(desk, temp);
    expect(first.stage).toBe("password_change_required");
    expect(first.redirectTo).toBe("/change-password");
    const change = (newPassword: string) => changePassword(anonymousContext(), { token: first.token, newPassword }, t.db);

    expect(await change("short")).toMatchObject({ ok: false, reasonCode: "password_too_short" });
    expect(await change("qwertyuiop")).toMatchObject({ ok: false, reasonCode: "password_common" });
    expect(await change(temp)).toMatchObject({ ok: false, reasonCode: "password_reused" });
    const done = await change("market day in kano");
    expect(done).toMatchObject({ ok: true, value: { stage: "active" } });

    expect(await signIn(desk, "market day in kano")).toMatchObject({ stage: "active" });
  });

  it("sign out the user's other sessions when issued", async () => {
    const desk = await makeUser(t, { roles: ["front_desk"] });
    const { token } = await signIn(desk);
    await issueTemporaryPassword(userContext("admin"), { userId: desk.id }, t.db);
    expect(await status(token)).toBe("revoked");
  });

  it("are never written to the audit log", async () => {
    const desk = await makeUser(t, { roles: ["front_desk"] });
    const ctx = userContext("admin");
    const issued = await issueTemporaryPassword(ctx, { userId: desk.id }, t.db);
    if (!issued.ok) throw new Error("issue failed");
    expect(JSON.stringify(await auditFor(t, ctx.requestId))).not.toContain(issued.value.temporaryPassword);
  });
});

describe("admin unlock and MFA reset", () => {
  it("unlockAccount lifts a lockout early", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    for (let i = 0; i < 5; i++) {
      await login(anonymousContext(), { identifier: nurse.staffId, password: "x", deviceId: uuidv7(), userAgent: null }, t.db);
    }
    await unlockAccount(userContext("admin"), { userId: nurse.id }, t.db);
    expect((await signIn(nurse)).stage).toBe("active");
  });

  it("resetMfa sends a required-MFA user back through enrollment", async () => {
    const doctor = await makeUser(t, { roles: ["doctor"] });
    await enrollTotp(t, doctor.id);
    expect((await signIn(doctor)).stage).toBe("mfa_pending");
    await resetMfa(userContext("admin"), { userId: doctor.id }, t.db);
    expect((await signIn(doctor)).stage).toBe("mfa_enrollment_required");
  });
});

describe("permissions: account administration is admin-only (role × action)", () => {
  const services = { revokeUserSessionsService, disableUser, issueTemporaryPassword, unlockAccount, resetMfa };
  const nonAdmins = ROLES.filter((r) => r !== "admin");

  for (const [name, service] of Object.entries(services)) {
    it.each(nonAdmins)(`${name} is denied for %s`, async (role) => {
      const target = await makeUser(t, { roles: ["nurse"] });
      await expect(service(userContext(role), { userId: target.id }, t.db)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it(`${name} is denied for anonymous callers`, async () => {
      const target = await makeUser(t, { roles: ["nurse"] });
      await expect(service(anonymousContext(), { userId: target.id }, t.db)).rejects.toBeInstanceOf(ForbiddenError);
    });
  }
});

describe("first-admin bootstrap", () => {
  // Runs against a database with no active admin; each test restores that state first.
  async function withoutActiveAdmins() {
    await t.ownerPool.query(
      `UPDATE "user" SET disabled_at = now()
        WHERE disabled_at IS NULL AND id IN (SELECT user_id FROM user_role WHERE role = 'admin')`,
    );
  }
  const input = (staffId: string) => ({ staffId, email: null, displayName: "First Admin" });

  it("creates the first admin with a temporary password, and audits it without the password", async () => {
    await withoutActiveAdmins();
    const ctx = anonymousContext();
    const outcome = await bootstrapAdmin(ctx, input("  First.Admin "), t.db);
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    const { rows } = await t.appPool.query(
      `SELECT u.staff_id, u.must_change_password, r.role FROM "user" u JOIN user_role r ON r.user_id = u.id WHERE u.id = $1`,
      [outcome.value.userId],
    );
    expect(rows).toEqual([{ staff_id: "first.admin", must_change_password: true, role: "admin" }]);
    const audit = await auditFor(t, ctx.requestId);
    expect(audit).toMatchObject([
      { action: "users.bootstrap_admin", outcome: "success", resource_id: outcome.value.userId },
    ]);
    expect(JSON.stringify(audit)).not.toContain(outcome.value.temporaryPassword);
  });

  it("refuses once an admin exists", async () => {
    await makeUser(t, { roles: ["admin"] });
    expect(await bootstrapAdmin(anonymousContext(), input("second.admin"), t.db)).toMatchObject({
      ok: false,
      reasonCode: "admin_exists",
    });
  });

  it("rejects a malformed staff ID as a validation failure, audited, before touching the database", async () => {
    await withoutActiveAdmins();
    for (const staffId of ["dr ade", "-admin", "ab", "admin!"]) {
      const ctx = anonymousContext();
      await expect(bootstrapAdmin(ctx, input(staffId), t.db)).rejects.toBeInstanceOf(ValidationError);
      expect(await auditFor(t, ctx.requestId)).toMatchObject([{ action: "users.bootstrap_admin", outcome: "failure" }]);
    }
  });

  it("rolls back entirely when the insert fails (staff ID already taken)", async () => {
    await withoutActiveAdmins();
    const existing = await makeUser(t, { roles: ["nurse"] });
    const ctx = anonymousContext();
    await expect(bootstrapAdmin(ctx, input(existing.staffId), t.db)).rejects.toThrow();
    const { rows } = await t.appPool.query(
      `SELECT count(*)::int AS n FROM "user" u JOIN user_role r ON r.user_id = u.id
        WHERE r.role = 'admin' AND u.disabled_at IS NULL`,
    );
    expect(rows[0].n).toBe(0);
    expect(await auditFor(t, ctx.requestId)).toMatchObject([{ action: "users.bootstrap_admin", outcome: "error" }]);
  });
});

describe("role switching (multi-role users)", () => {
  it("switches to another held role, rotates the token, and audits from and to", async () => {
    const both = await makeUser(t, { roles: ["nurse", "lab"] });
    const { token, sessionId } = await signIn(both); // lands on nurse (priority order)
    const ctx = anonymousContext();
    const outcome = await switchActiveRole(ctx, { token, role: "lab" }, t.db);
    expect(outcome).toMatchObject({ ok: true, value: { role: "lab", fromRole: "nurse", redirectTo: "/lab" } });
    if (!outcome.ok) return;
    expect(await readSession(token, anonymousContext(), t.db)).toBeNull(); // old token is dead
    expect(await readSession(outcome.value.token, anonymousContext(), t.db)).toMatchObject({
      status: "active",
      role: "lab",
    });
    expect(await auditFor(t, ctx.requestId)).toMatchObject([
      {
        action: "auth.role_switch",
        outcome: "success",
        actor_user_id: both.id,
        actor_role: "lab",
        session_id: sessionId,
        metadata: { from_role: "nurse", to_role: "lab" },
      },
    ]);
  });

  it("refuses a role the account doesn't hold, and audits the refusal", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token } = await signIn(nurse);
    const ctx = anonymousContext();
    expect(await switchActiveRole(ctx, { token, role: "admin" }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "role_not_held",
    });
    expect(await status(token)).toBe("active");
    expect((await readSession(token, anonymousContext(), t.db))?.role).toBe("nurse");
    expect(await auditFor(t, ctx.requestId)).toMatchObject([
      { action: "auth.role_switch", outcome: "failure", reason_code: "role_not_held", actor_user_id: nurse.id },
    ]);
  });

  it("refuses locked, revoked and unknown sessions", async () => {
    const both = await makeUser(t, { roles: ["nurse", "lab"] });
    const locked = await signIn(both);
    await lockIdleSession(anonymousContext(), { token: locked.token, source: "browser" }, t.db);
    expect(await switchActiveRole(anonymousContext(), { token: locked.token, role: "lab" }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "session_invalid",
    });
    const revoked = await signIn(both);
    await logout(anonymousContext(), { token: revoked.token }, t.db);
    expect(await switchActiveRole(anonymousContext(), { token: revoked.token, role: "lab" }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "session_invalid",
    });
  });

  it("rejects an unknown role name as a validation failure", async () => {
    const both = await makeUser(t, { roles: ["nurse", "lab"] });
    const { token } = await signIn(both);
    await expect(
      switchActiveRole(anonymousContext(), { token, role: "superuser" }, t.db),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
