import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { resetIpThrottle } from "@/server/auth/ip-throttle";
import { ValidationError } from "@/server/kernel/errors";
import { login } from "@/server/services/auth/login";
import { changePassword, readSession } from "@/server/services/auth/session";
import { recoverSoleAdmin } from "@/server/services/users/bootstrap";
import { anonymousContext } from "../helpers/context";
import { auditFor, enrollTotp, makeUser, type TestUser } from "../helpers/auth";
import { createTestDatabase, type TestDatabase } from "../helpers/db";

// Lets one test make recovery fail after it has started changing things, to prove rollback.
const failAfterRevoke = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/services/auth/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/services/auth/shared")>();
  return {
    ...original,
    revokeUserSessions: async (...args: Parameters<typeof original.revokeUserSessions>) => {
      const count = await original.revokeUserSessions(...args);
      if (failAfterRevoke.on) throw new Error("simulated failure during recovery");
      return count;
    },
  };
});

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());
beforeEach(async () => {
  resetIpThrottle();
  // Each test starts with no active administrator.
  await t.ownerPool.query(
    `UPDATE "user" SET disabled_at = now()
      WHERE disabled_at IS NULL AND id IN (SELECT user_id FROM user_role WHERE role = 'admin')`,
  );
});

const signIn = (user: TestUser, password = user.password) =>
  login(anonymousContext(), { identifier: user.staffId, password, deviceId: uuidv7(), userAgent: null }, t.db);

async function soleAdminWithPhone() {
  const admin = await makeUser(t, { roles: ["admin"] });
  await enrollTotp(t, admin.id);
  const pending = await signIn(admin);
  if (!pending.ok) throw new Error("sign-in failed");
  return { admin, sessionToken: pending.value.token };
}

describe("recovering the only administrator (lost authenticator)", () => {
  it("replaces both factors: temporary password, then a new authenticator at sign-in", async () => {
    const { admin, sessionToken } = await soleAdminWithPhone();
    const ctx = anonymousContext();
    const outcome = await recoverSoleAdmin(ctx, { staffId: admin.staffId.toUpperCase() }, t.db);
    expect(outcome).toMatchObject({ ok: true, value: { userId: admin.id } });
    if (!outcome.ok) return;

    expect(await readSession(sessionToken, anonymousContext(), t.db)).toMatchObject({ status: "revoked" });
    const { rows } = await t.appPool.query(
      `SELECT (SELECT count(*)::int FROM mfa_secret WHERE user_id = $1 AND status = 'active') AS active_mfa,
              (SELECT count(*)::int FROM recovery_code WHERE user_id = $1 AND used_at IS NULL) AS unused_codes`,
      [admin.id],
    );
    expect(rows[0]).toEqual({ active_mfa: 0, unused_codes: 0 });
    expect((await signIn(admin)).ok).toBe(false); // the old password no longer works

    const temp = await signIn(admin, outcome.value.temporaryPassword);
    expect(temp).toMatchObject({ ok: true, value: { stage: "password_change_required" } });
    if (!temp.ok) return;
    const changed = await changePassword(anonymousContext(), { token: temp.value.token, newPassword: "fresh start at the hospital" }, t.db);
    expect(changed).toMatchObject({ ok: true, value: { stage: "mfa_enrollment_required" } });

    const audit = await auditFor(t, ctx.requestId);
    expect(audit).toMatchObject([{ action: "users.recover_admin", outcome: "success", resource_id: admin.id }]);
    expect(JSON.stringify(audit)).not.toContain(outcome.value.temporaryPassword);
  });

  it("lifts a lockout, so the recovered admin can sign in straight away", async () => {
    const { admin } = await soleAdminWithPhone();
    for (let i = 0; i < 5; i++) await signIn(admin, "wrong password");
    const outcome = await recoverSoleAdmin(anonymousContext(), { staffId: admin.staffId }, t.db);
    if (!outcome.ok) throw new Error("recovery failed");
    expect(await signIn(admin, outcome.value.temporaryPassword)).toMatchObject({ ok: true });
  });

  it("refuses while another active admin exists, changing nothing", async () => {
    const { admin, sessionToken } = await soleAdminWithPhone();
    await makeUser(t, { roles: ["admin"] });
    const ctx = anonymousContext();
    expect(await recoverSoleAdmin(ctx, { staffId: admin.staffId }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "other_admin_exists",
    });
    expect((await readSession(sessionToken, anonymousContext(), t.db))?.status).toBe("pending_stage");
    expect(await auditFor(t, ctx.requestId)).toMatchObject([
      { action: "users.recover_admin", outcome: "failure", reason_code: "other_admin_exists" },
    ]);
  });

  it("refuses non-admins, unknown and disabled accounts, and malformed staff IDs", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const disabledAdmin = await makeUser(t, { roles: ["admin"], disabled: true });
    for (const staffId of [nurse.staffId, "no.such.person", disabledAdmin.staffId]) {
      expect(await recoverSoleAdmin(anonymousContext(), { staffId }, t.db)).toMatchObject({
        ok: false,
        reasonCode: "not_an_active_admin",
      });
    }
    await expect(recoverSoleAdmin(anonymousContext(), { staffId: "dr ade" }, t.db)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rolls back entirely if it fails part-way (authenticator and password untouched)", async () => {
    const { admin } = await soleAdminWithPhone();
    const ctx = anonymousContext();
    failAfterRevoke.on = true;
    try {
      await expect(recoverSoleAdmin(ctx, { staffId: admin.staffId }, t.db)).rejects.toThrow("simulated failure");
    } finally {
      failAfterRevoke.on = false;
    }
    const { rows } = await t.appPool.query(
      `SELECT count(*)::int AS n FROM mfa_secret WHERE user_id = $1 AND status = 'active'`,
      [admin.id],
    );
    expect(rows[0].n).toBe(1);
    expect(await signIn(admin)).toMatchObject({ ok: true, value: { stage: "mfa_pending" } });
    expect(await auditFor(t, ctx.requestId)).toMatchObject([{ action: "users.recover_admin", outcome: "error" }]);
  });
});
