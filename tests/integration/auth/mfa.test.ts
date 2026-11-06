import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/lib/ids";
import { resetIpThrottle } from "@/server/auth/ip-throttle";
import { login } from "@/server/services/auth/login";
import {
  confirmMfaEnrollment,
  startMfaEnrollment,
  redeemRecoveryCode,
  verifyTotpCode,
} from "@/server/services/auth/mfa";
import { readSession } from "@/server/services/auth/session";
import { anonymousContext } from "../helpers/context";
import { auditFor, enrollTotp, makeUser, totpNow, type TestUser } from "../helpers/auth";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { codeForStep, timeStep } from "@/server/auth/totp";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());
beforeEach(() => resetIpThrottle());
afterEach(() => vi.useRealTimers());

async function passwordStep(user: TestUser): Promise<string> {
  const outcome = await login(
    anonymousContext(),
    { identifier: user.staffId, password: user.password, deviceId: uuidv7(), userAgent: null },
    t.db,
  );
  if (!outcome.ok) throw new Error(`password step failed: ${outcome.reasonCode}`);
  return outcome.value.token;
}

async function enrolledDoctor() {
  const user = await makeUser(t, { roles: ["doctor"] });
  const mfa = await enrollTotp(t, user.id);
  return { user, ...mfa };
}

const verify = (token: string, code: string, ctx = anonymousContext()) => verifyTotpCode(ctx, { token, code }, t.db);

describe("TOTP step", () => {
  it("accepts the current code, rotates the token, and signs in", async () => {
    const { user, secret } = await enrolledDoctor();
    const token = await passwordStep(user);
    const ctx = anonymousContext();
    const outcome = await verify(token, totpNow(secret), ctx);

    expect(outcome).toMatchObject({ ok: true, value: { stage: "active", redirectTo: "/doctor" } });
    if (!outcome.ok) return;
    expect(outcome.value.token).not.toBe(token);
    expect(await readSession(token, anonymousContext(), t.db)).toBeNull(); // old token is dead
    expect((await readSession(outcome.value.token, anonymousContext(), t.db))?.status).toBe("active");
    expect(await auditFor(t, ctx.requestId)).toMatchObject([
      { action: "auth.mfa_verify", outcome: "success", actor_user_id: user.id, actor_role: "doctor" },
    ]);
  });

  it("rejects a wrong code and audits the failure", async () => {
    const { user, secret } = await enrolledDoctor();
    const token = await passwordStep(user);
    const wrong = totpNow(secret) === "000000" ? "111111" : "000000";
    const ctx = anonymousContext();
    expect(await verify(token, wrong, ctx)).toMatchObject({ ok: false, reasonCode: "invalid_code" });
    expect(await auditFor(t, ctx.requestId)).toMatchObject([
      { action: "auth.mfa_verify", outcome: "failure", reason_code: "invalid_code", actor_user_id: user.id },
    ]);
  });

  it("rejects an expired code (two steps old)", async () => {
    const { user, secret } = await enrolledDoctor();
    const token = await passwordStep(user);
    expect(await verify(token, totpNow(secret, -2))).toMatchObject({ ok: false, reasonCode: "invalid_code" });
  });

  it("rejects a replayed code within its window", async () => {
    const { user, secret } = await enrolledDoctor();
    const code = totpNow(secret);
    expect((await verify(await passwordStep(user), code)).ok).toBe(true);
    const again = await verify(await passwordStep(user), code);
    expect(again).toMatchObject({ ok: false, reasonCode: "replayed_code" });
  });

  it("lets only one of two simultaneous submissions of the same code through", async () => {
    const { user, secret } = await enrolledDoctor();
    const [a, b] = [await passwordStep(user), await passwordStep(user)];
    const code = totpNow(secret);
    const results = await Promise.all([verify(a, code), verify(b, code)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("locks the account and ends the half-signed-in session after 5 wrong codes", async () => {
    const { user, secret } = await enrolledDoctor();
    const token = await passwordStep(user);
    const wrong = totpNow(secret) === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await verify(token, wrong));
    expect(results[4]).toMatchObject({ ok: false, reasonCode: "locked" });
    expect((await readSession(token, anonymousContext(), t.db))?.status).toBe("revoked");
    const fresh = await login(
      anonymousContext(),
      { identifier: user.staffId, password: user.password, deviceId: uuidv7(), userAgent: null },
      t.db,
    );
    expect(fresh).toMatchObject({ ok: false, reasonCode: "locked" });
  });

  it("gives up after the 5-minute step deadline", async () => {
    const { user, secret } = await enrolledDoctor();
    const token = await passwordStep(user);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    const code = codeForStep(secret, timeStep(Date.now()));
    expect(await verify(token, code)).toMatchObject({ ok: false, reasonCode: "session_invalid" });
  });

  it("refuses the code step for a session that isn't at it", async () => {
    const nurse = await makeUser(t, { roles: ["nurse"] });
    const token = await passwordStep(nurse); // already active
    expect(await verify(token, "123456")).toMatchObject({ ok: false, reasonCode: "session_invalid" });
  });
});

describe("recovery codes", () => {
  const recover = (token: string, code: string) => redeemRecoveryCode(anonymousContext(), { token, code }, t.db);

  it("work once each, in any case or spacing, and report how many remain", async () => {
    const { user, recoveryCodes } = await enrolledDoctor();
    const first = await recover(await passwordStep(user), ` ${recoveryCodes[0]!.toLowerCase()} `);
    expect(first).toMatchObject({ ok: true, value: { stage: "active", remaining: 7 } });

    const reuse = await recover(await passwordStep(user), recoveryCodes[0]!);
    expect(reuse).toMatchObject({ ok: false, reasonCode: "invalid_recovery_code" });
  });

  it("can't be used by two sessions at once", async () => {
    const { user, recoveryCodes } = await enrolledDoctor();
    const [a, b] = [await passwordStep(user), await passwordStep(user)];
    const results = await Promise.all([recover(a, recoveryCodes[1]!), recover(b, recoveryCodes[1]!)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("are bound to their own account", async () => {
    const owner = await enrolledDoctor();
    const other = await enrolledDoctor();
    expect(await recover(await passwordStep(other.user), owner.recoveryCodes[2]!)).toMatchObject({
      ok: false,
      reasonCode: "invalid_recovery_code",
    });
  });
});

describe("first-login enrollment", () => {
  it("creates a pending secret, confirms with a code, issues 8 recovery codes, and signs in", async () => {
    const pharmacist = await makeUser(t, { roles: ["pharmacist"] });
    const token = await passwordStep(pharmacist);
    const started = await startMfaEnrollment(anonymousContext(), { token }, t.db);
    if (!started.ok) throw new Error("start failed");
    const secretBase32 = new URL(started.value.otpauthUri).searchParams.get("secret")!;
    expect(started.value.manualKey.replace(/ /g, "")).toBe(secretBase32);

    const { Secret } = await import("otpauth");
    const secret = Buffer.from(Secret.fromBase32(secretBase32).bytes);
    const confirmed = await confirmMfaEnrollment(anonymousContext(), { token, code: totpNow(secret) }, t.db);
    expect(confirmed).toMatchObject({ ok: true, value: { stage: "active", redirectTo: "/pharmacy" } });
    if (!confirmed.ok) return;
    expect(confirmed.value.recoveryCodes).toHaveLength(8);
    expect(new Set(confirmed.value.recoveryCodes).size).toBe(8);

    const { rows } = await t.appPool.query(
      "SELECT status, count(*)::int AS n FROM mfa_secret WHERE user_id = $1 GROUP BY status",
      [pharmacist.id],
    );
    expect(rows).toEqual([{ status: "active", n: 1 }]);
    // Codes are stored hashed, never as typed.
    const stored = await t.appPool.query("SELECT code_hash FROM recovery_code WHERE user_id = $1", [pharmacist.id]);
    expect(JSON.stringify(stored.rows)).not.toContain(confirmed.value.recoveryCodes[0]!.replace("-", ""));
  });

  it("invalidates an earlier unfinished setup when it is restarted", async () => {
    const admin = await makeUser(t, { roles: ["admin"] });
    const token = await passwordStep(admin);
    await startMfaEnrollment(anonymousContext(), { token }, t.db);
    await startMfaEnrollment(anonymousContext(), { token }, t.db);
    const { rows } = await t.appPool.query(
      "SELECT status, count(*)::int AS n FROM mfa_secret WHERE user_id = $1 GROUP BY status ORDER BY status",
      [admin.id],
    );
    expect(rows).toEqual([
      { status: "pending", n: 1 },
      { status: "revoked", n: 1 },
    ]);
  });
});
