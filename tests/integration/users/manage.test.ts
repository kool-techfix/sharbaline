import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Lets one test make account creation fail AFTER the user row is written, to prove rollback.
const failAfterInsert = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/services/users/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/services/users/shared")>();
  return {
    ...original,
    insertUser: async (...args: Parameters<typeof original.insertUser>) => {
      const id = await original.insertUser(...args);
      if (failAfterInsert.on) throw new Error("simulated failure after insert");
      return id;
    },
  };
});
import { uuidv7 } from "@/lib/ids";
import { resetIpThrottle } from "@/server/auth/ip-throttle";
import { ValidationError } from "@/server/kernel/errors";
import { login } from "@/server/services/auth/login";
import { readSession } from "@/server/services/auth/session";
import { disableUser } from "@/server/services/users/admin";
import {
  createUser,
  enableUser,
  getUser,
  listUsers,
  updateUserDetails,
  updateUserRoles,
} from "@/server/services/users/manage";
import { anonymousContext, userContext } from "../helpers/context";
import { auditFor, enrollTotp, makeUser, type TestUser } from "../helpers/auth";
import { createTestDatabase, type TestDatabase } from "../helpers/db";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());
beforeEach(() => resetIpThrottle());

/** An admin context acting as a real admin account (some rules depend on who acts). */
async function asAdmin(): Promise<{ admin: TestUser; ctx: ReturnType<typeof userContext> }> {
  const admin = await makeUser(t, { roles: ["admin"] });
  const ctx = userContext("admin", { actor: { kind: "user", userId: admin.id, role: "admin", sessionId: uuidv7() } });
  return { admin, ctx };
}

async function signIn(user: TestUser, password = user.password) {
  const outcome = await login(
    anonymousContext(),
    { identifier: user.staffId, password, deviceId: uuidv7(), userAgent: null },
    t.db,
  );
  if (!outcome.ok) throw new Error(`sign-in failed: ${outcome.reasonCode}`);
  return outcome.value;
}

const newUser = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  staffId: `new.${uuidv7().slice(-8)}`,
  displayName: "New Staff",
  email: null,
  roles: ["nurse"],
  ...overrides,
});

describe("createUser", () => {
  it("creates the account with a temporary password that must be changed, and audits it", async () => {
    const { ctx, admin } = await asAdmin();
    const input = newUser({ roles: ["nurse", "lab", "nurse"], staffId: "  NEW.Nurse.One " });
    const outcome = await createUser(ctx, input, t.db);
    expect(outcome).toMatchObject({ ok: true, value: { userId: input.id } });
    if (!outcome.ok) return;

    const { rows } = await t.appPool.query(
      `SELECT staff_id, must_change_password, created_by_id FROM "user" WHERE id = $1`,
      [input.id],
    );
    expect(rows).toEqual([{ staff_id: "new.nurse.one", must_change_password: true, created_by_id: admin.id }]);
    const signedIn = await signIn({ id: input.id, staffId: "new.nurse.one", password: outcome.value.temporaryPassword });
    expect(signedIn.stage).toBe("password_change_required");

    const audit = await auditFor(t, ctx.requestId);
    expect(audit).toMatchObject([
      { action: "users.create", outcome: "success", resource_id: input.id, metadata: { roles: "lab,nurse" } },
    ]);
    expect(JSON.stringify(audit)).not.toContain(outcome.value.temporaryPassword);
  });

  it("is safe to call twice: the retry creates nothing and is refused", async () => {
    const { ctx } = await asAdmin();
    const input = newUser();
    expect((await createUser(ctx, input, t.db)).ok).toBe(true);
    expect(await createUser(ctx, input, t.db)).toMatchObject({ ok: false, reasonCode: "already_created" });
    const { rows } = await t.appPool.query(`SELECT count(*)::int AS n FROM "user" WHERE staff_id = $1`, [input.staffId]);
    expect(rows[0].n).toBe(1);
  });

  it("refuses a staff ID or email that's already in use", async () => {
    const { ctx } = await asAdmin();
    const existing = await makeUser(t, { roles: ["nurse"] });
    expect(await createUser(ctx, newUser({ staffId: existing.staffId.toUpperCase() }), t.db)).toMatchObject({
      ok: false,
      reasonCode: "staff_id_taken",
    });
    expect(await createUser(ctx, newUser({ email: `${existing.staffId}@HOSPITAL.test` }), t.db)).toMatchObject({
      ok: false,
      reasonCode: "email_taken",
    });
  });

  it("rejects invalid input (bad staff ID, no roles, unknown role) and audits field names only", async () => {
    const { ctx } = await asAdmin();
    for (const bad of [{ staffId: "dr ade" }, { roles: [] }, { roles: ["superuser"] }, { displayName: " " }]) {
      const attempt = anonymousContext({ actor: ctx.actor });
      await expect(createUser(attempt, newUser(bad), t.db)).rejects.toBeInstanceOf(ValidationError);
      expect(await auditFor(t, attempt.requestId)).toMatchObject([
        { action: "users.create", outcome: "failure", reason_code: "invalid_input" },
      ]);
    }
  });

  it("rolls back entirely when something fails after the insert (no account, no roles)", async () => {
    const { ctx } = await asAdmin();
    const input = newUser();
    failAfterInsert.on = true;
    try {
      await expect(createUser(ctx, input, t.db)).rejects.toThrow("simulated failure after insert");
    } finally {
      failAfterInsert.on = false;
    }
    const { rows } = await t.appPool.query(
      `SELECT (SELECT count(*)::int FROM "user" WHERE id = $1) AS users,
              (SELECT count(*)::int FROM user_role WHERE user_id = $1) AS roles`,
      [input.id],
    );
    expect(rows[0]).toEqual({ users: 0, roles: 0 });
    expect(await auditFor(t, ctx.requestId)).toMatchObject([{ action: "users.create", outcome: "error" }]);
  });
});

describe("listUsers and getUser", () => {
  it("lists accounts with roles, MFA and lock state, and searches by name, staff ID or email", async () => {
    const { ctx } = await asAdmin();
    const doctor = await makeUser(t, { roles: ["doctor"] });
    await enrollTotp(t, doctor.id);
    const locked = await makeUser(t, { roles: ["lab"] });
    for (let i = 0; i < 5; i++) {
      await login(anonymousContext(), { identifier: locked.staffId, password: "wrong", deviceId: uuidv7(), userAgent: null }, t.db);
    }

    const all = await listUsers(ctx, {}, t.db);
    if (!all.ok) throw new Error("list failed");
    expect(all.value.users.find((u) => u.id === doctor.id)).toMatchObject({ roles: ["doctor"], mfa: "enrolled", locked: false });
    expect(all.value.users.find((u) => u.id === locked.id)).toMatchObject({ mfa: "not_enrolled", locked: true });

    const byId = await listUsers(ctx, { query: doctor.staffId.toUpperCase() }, t.db);
    expect(byId.ok && byId.value.users.map((u) => u.id)).toEqual([doctor.id]);
  });

  it("never audits the search text", async () => {
    const { ctx } = await asAdmin();
    await listUsers(ctx, { query: "Amaka" }, t.db);
    const audit = await auditFor(t, ctx.requestId);
    expect(audit).toMatchObject([{ action: "users.list", outcome: "success", metadata: { searched: true } }]);
    expect(JSON.stringify(audit)).not.toContain("Amaka");
  });

  it("shows one account's sessions, recovery codes and last sign-in", async () => {
    const { ctx } = await asAdmin();
    const nurse = await makeUser(t, { roles: ["nurse"] });
    await signIn(nurse);
    const outcome = await getUser(ctx, { userId: nurse.id }, t.db);
    expect(outcome).toMatchObject({ ok: true, value: { id: nurse.id, activeSessions: 1, recoveryCodesLeft: 0, disabled: false } });
    expect(outcome.ok && outcome.value.lastSignInAt).toBeInstanceOf(Date);
    expect(await getUser(ctx, { userId: uuidv7() }, t.db)).toMatchObject({ ok: false, reasonCode: "not_found" });
  });
});

describe("updateUserRoles", () => {
  it("replaces the roles, ends the user's sessions, and audits the new set", async () => {
    const { ctx } = await asAdmin();
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token } = await signIn(nurse);
    const outcome = await updateUserRoles(ctx, { userId: nurse.id, roles: ["lab", "nurse"] }, t.db);
    expect(outcome).toMatchObject({ ok: true, value: { changed: true, sessionsEnded: 1 } });
    expect((await readSession(token, anonymousContext(), t.db))?.status).toBe("revoked");
    const { rows } = await t.appPool.query(`SELECT role FROM user_role WHERE user_id = $1 ORDER BY role::text`, [nurse.id]);
    expect(rows.map((r: { role: string }) => r.role)).toEqual(["lab", "nurse"]);
    expect(await auditFor(t, ctx.requestId)).toMatchObject([
      { action: "users.update_roles", outcome: "success", metadata: { roles: "lab,nurse", sessions_ended: 1 } },
    ]);
  });

  it("does nothing (and keeps sessions) when the roles are unchanged", async () => {
    const { ctx } = await asAdmin();
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const { token } = await signIn(nurse);
    expect(await updateUserRoles(ctx, { userId: nurse.id, roles: ["nurse"] }, t.db)).toMatchObject({
      ok: true,
      value: { changed: false },
    });
    expect((await readSession(token, anonymousContext(), t.db))?.status).toBe("active");
  });

  it("a newly added MFA role forces authenticator enrollment at the next sign-in", async () => {
    const { ctx } = await asAdmin();
    const nurse = await makeUser(t, { roles: ["nurse"] });
    await updateUserRoles(ctx, { userId: nurse.id, roles: ["doctor", "nurse"] }, t.db);
    expect((await signIn(nurse)).stage).toBe("mfa_enrollment_required");
  });

  it("won't remove the caller's own admin role or the last active admin", async () => {
    const { ctx, admin } = await asAdmin();
    expect(await updateUserRoles(ctx, { userId: admin.id, roles: ["nurse"] }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "cannot_remove_own_admin",
    });

    const { rows } = await t.appPool.query(
      `SELECT u.id FROM "user" u JOIN user_role r ON r.user_id = u.id WHERE r.role = 'admin' AND u.disabled_at IS NULL`,
    );
    for (const row of rows) await t.ownerPool.query('UPDATE "user" SET disabled_at = now() WHERE id = $1', [row.id]);
    const only = await makeUser(t, { roles: ["admin", "doctor"] });
    expect(await updateUserRoles(userContext("admin"), { userId: only.id, roles: ["doctor"] }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "last_admin",
    });
  });
});

describe("updateUserDetails and enableUser", () => {
  it("updates name and email, refusing an email another account uses", async () => {
    const { ctx } = await asAdmin();
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const other = await makeUser(t, { roles: ["lab"] });
    expect(
      await updateUserDetails(ctx, { userId: nurse.id, displayName: "Nurse Renamed", email: "Renamed@Hospital.test" }, t.db),
    ).toMatchObject({ ok: true });
    const { rows } = await t.appPool.query(`SELECT display_name, email FROM "user" WHERE id = $1`, [nurse.id]);
    expect(rows).toEqual([{ display_name: "Nurse Renamed", email: "renamed@hospital.test" }]);
    expect(
      await updateUserDetails(ctx, { userId: nurse.id, displayName: "x", email: `${other.staffId}@hospital.test` }, t.db),
    ).toMatchObject({ ok: false, reasonCode: "email_taken" });
  });

  it("switches a disabled account back on so the user can sign in again", async () => {
    const { ctx } = await asAdmin();
    const nurse = await makeUser(t, { roles: ["nurse"] });
    await disableUser(ctx, { userId: nurse.id }, t.db);
    expect(await enableUser(ctx, { userId: nurse.id }, t.db)).toMatchObject({ ok: true });
    expect((await signIn(nurse)).stage).toBe("active");
    expect(await auditFor(t, ctx.requestId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "users.enable", outcome: "success" })]),
    );
  });
});
