import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { resetIpThrottle } from "@/server/auth/ip-throttle";
import { login } from "@/server/services/auth/login";
import {
  changePassword,
  lockIdleSession,
  logout,
  readSession,
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
import { ForbiddenError } from "@/server/kernel/errors";
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
  it("refuses once an admin exists", async () => {
    await makeUser(t, { roles: ["admin"] });
    expect(
      await bootstrapAdmin(anonymousContext(), { staffId: "first.admin", email: null, displayName: "First Admin" }, t.db),
    ).toMatchObject({ ok: false, reasonCode: "admin_exists" });
  });
});
