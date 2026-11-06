import "server-only";
import { z } from "zod";
import type { MessageKey } from "@/lib/i18n";
import { writeAudit } from "@/server/audit/write";
import { db as defaultDb, type Db } from "@/server/db/client";
import { withTransaction } from "@/server/db/tx";
import type { RequestContext } from "@/server/kernel/context";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import type { Role } from "@/server/permissions/roles";
import { throttleKey } from "@/server/auth/identifiers";
import { authHmacKey } from "@/server/auth/keys";
import { isLocked, registerFailure } from "@/server/auth/lockout";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/server/auth/password";
import { checkPassword, type PasswordProblem } from "@/server/auth/password-policy";
import { commonPasswords } from "@/server/auth/common-passwords";
import { AUTH_POLICY, idleTimeoutMs } from "@/server/auth/policy";
import { sessionStatus, type SessionStatus } from "@/server/auth/session-rules";
import type { SessionStage } from "@/server/auth/stage";
import { SESSION_TOKEN_PATTERN, hashSessionToken, newSessionToken } from "@/server/auth/tokens";
import { serverEnv } from "@/server/config/env";
import {
  advanceSession,
  auditActorFor,
  clearThrottle,
  lockSessionByToken,
  lockThrottle,
  revokeSession,
  revokeUserSessions,
  saveThrottle,
  sessionTokenSchema,
  type StageResult,
} from "./shared";

export function currentIdleMs(): number {
  return idleTimeoutMs(serverEnv().SESSION_IDLE_SECONDS_OVERRIDE);
}

const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, MessageKey> = {
  too_short: "auth.password.tooShort",
  too_long: "auth.password.tooLong",
  common: "auth.password.common",
  contains_identifier: "auth.password.containsIdentifier",
};

/** Replace a temporary password (admin-issued) during sign-in. */
export const changePassword = defineService({
  action: "auth.password_change",
  input: z.object({ token: sessionTokenSchema, newPassword: z.string().min(1).max(1024) }),
  permission: { public: true, reason: "Sign-in step for temporary passwords; the session token is the credential." },
  async run({ tx, input }): Promise<Outcome<StageResult & { otherSessionsRevoked: number }>> {
    const now = new Date();
    const session = await lockSessionByToken(tx, input.token);
    const status = session
      ? sessionStatus({ ...session, userDisabledAt: session.user.disabledAt }, now, Number.MAX_SAFE_INTEGER)
      : null;
    if (!session || session.stage !== "password_change_required" || status !== "pending_stage") {
      return fail("session_invalid", "auth.error.sessionExpired");
    }
    const user = session.user;
    const actor = auditActorFor(user, session.activeRole, session.id);

    const problem = checkPassword(input.newPassword, {
      commonPasswords: commonPasswords(),
      staffId: user.staffId,
      email: user.email,
    });
    if (problem) return fail(`password_${problem}`, PASSWORD_PROBLEM_MESSAGE[problem], { auditActor: actor });
    if (await verifyPassword(user.passwordHash, input.newPassword)) {
      return fail("password_reused", "auth.password.reused", { auditActor: actor });
    }

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, passwordChangedAt: now },
    });
    const revoked = await revokeUserSessions(tx, user.id, "password_changed", now, { exceptSessionId: session.id });
    const result = await advanceSession(
      tx,
      session,
      { mfaEnrolled: user.activeMfa !== null, mfaVerified: session.mfaVerifiedAt !== null, mustChangePassword: false },
      now,
    );
    return ok({ ...result, otherSessionsRevoked: revoked }, { auditActor: actor });
  },
  audit: {
    resourceType: "user",
    metadata: (_input, value) => ({ other_sessions_revoked: value?.otherSessionsRevoked ?? null }),
  },
});

/** Re-open an idle-locked session with the password (M1 proposal c: password only). */
export const unlockSession = defineService({
  action: "auth.unlock",
  input: z.object({ token: sessionTokenSchema, password: z.string().min(1).max(1024) }),
  permission: { public: true, reason: "The locked session's token plus password is the credential." },
  async run({ tx, input, ctx }): Promise<Outcome<{ token: string; expiresAt: Date }>> {
    const now = new Date();
    const session = await lockSessionByToken(tx, input.token);
    const status = session
      ? sessionStatus({ ...session, userDisabledAt: session.user.disabledAt }, now, currentIdleMs())
      : null;
    if (!session || !status || !["locked", "idle", "active"].includes(status)) {
      if (session) await burnPasswordCheck(input.password);
      return fail("session_invalid", "auth.error.signedOut");
    }
    const actor = auditActorFor(session.user, session.activeRole, session.id);

    const key = throttleKey(authHmacKey(), { userId: session.userId });
    const throttle = await lockThrottle(tx, key);
    if (isLocked(throttle, now)) {
      await burnPasswordCheck(input.password);
      await revokeSession(tx, session.id, "locked", now);
      return fail("locked", "auth.error.locked", { auditActor: actor });
    }

    if (!(await verifyPassword(session.user.passwordHash, input.password))) {
      const next = registerFailure(throttle, now);
      await saveThrottle(tx, key, next, now);
      const failures = session.unlockFailures + 1;
      if (next.justLocked || failures >= AUTH_POLICY.session.unlockMaxFailures) {
        await revokeSession(tx, session.id, "unlock_failed", now);
        if (next.justLocked) {
          await writeAudit(
            tx,
            ctx,
            { action: "auth.lockout", outcome: "success", resourceType: "user", resourceId: session.userId },
            actor,
          );
        }
        return fail("unlock_failed_signed_out", "auth.error.signedOut", { auditActor: actor });
      }
      await tx.session.update({ where: { id: session.id }, data: { unlockFailures: failures } });
      return fail("invalid_password", "auth.error.wrongPassword", {
        auditActor: actor,
        metadata: { unlock_failures: failures },
      });
    }

    await clearThrottle(tx, key, now);
    const token = newSessionToken();
    await tx.session.update({
      where: { id: session.id },
      data: {
        tokenHash: hashSessionToken(token),
        lockedAt: null,
        unlockFailures: 0,
        lastActivityAt: now,
        lastSeenAt: now,
      },
    });
    return ok({ token, expiresAt: session.expiresAt }, { auditActor: actor });
  },
  audit: { resourceType: "session" },
});

/** Sign out. Always succeeds from the user's point of view. */
export const logout = defineService({
  action: "auth.logout",
  input: z.object({ token: z.string().max(100) }),
  permission: { public: true, reason: "Ending a session needs only that session's token." },
  async run({ tx, input }): Promise<Outcome<null>> {
    if (!SESSION_TOKEN_PATTERN.test(input.token)) return ok(null);
    const session = await lockSessionByToken(tx, input.token);
    if (!session) return ok(null);
    await revokeSession(tx, session.id, "logout", new Date());
    return ok(null, { auditActor: auditActorFor(session.user, session.activeRole, session.id) });
  },
  audit: { resourceType: "session" },
});

/** Mark a session idle-locked: reported by the browser, or found by the server on a request. */
export const lockIdleSession = defineService({
  action: "auth.idle_lock",
  input: z.object({ token: sessionTokenSchema, source: z.enum(["browser", "server"]) }),
  permission: { public: true, reason: "Locking only reduces access; the session token identifies it." },
  async run({ tx, input }): Promise<Outcome<null>> {
    const now = new Date();
    const session = await lockSessionByToken(tx, input.token);
    if (!session || session.stage !== "active" || session.revokedAt || session.lockedAt) {
      return fail("not_lockable", "errors.unexpected");
    }
    await tx.session.update({ where: { id: session.id }, data: { lockedAt: now } });
    return ok(null, { auditActor: auditActorFor(session.user, session.activeRole, session.id) });
  },
  audit: { resourceType: "session", metadata: (input) => ({ source: input.source }) },
});

// ─── Reading the current session (every protected request) ───

export interface CurrentSession {
  sessionId: string;
  status: Exclude<SessionStatus, "idle">;
  stage: SessionStage;
  role: Role;
  user: { id: string; displayName: string; staffId: string; roles: Role[] };
  expiresAt: Date;
  lastActivityAt: Date;
}

/**
 * Validate a session token for a request. Not a kernel service: it is a read of the caller's
 * own session, runs on every request, and touches no patient data. If the session has gone
 * idle on the server, it is locked here (and that IS audited, via lockIdleSession).
 */
export async function readSession(
  token: string | undefined,
  ctx: Omit<RequestContext, "actor">,
  database: Db = defaultDb(),
): Promise<CurrentSession | null> {
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;
  const row = await database.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { include: { roles: true } } },
  });
  if (!row) return null;

  const now = new Date();
  let status = sessionStatus({ ...row, userDisabledAt: row.user.disabledAt }, now, currentIdleMs());
  if (status === "idle") {
    await lockIdleSession({ ...ctx, actor: { kind: "anonymous" } }, { token, source: "server" }, database);
    status = "locked";
  }
  return {
    sessionId: row.id,
    status,
    stage: row.stage,
    role: row.activeRole,
    user: {
      id: row.user.id,
      displayName: row.user.displayName,
      staffId: row.user.staffId,
      roles: row.user.roles.map((r) => r.role),
    },
    expiresAt: row.expiresAt,
    lastActivityAt: row.lastActivityAt,
  };
}

/**
 * Record user-initiated activity (input in the browser, at most every 30 s) and background
 * liveness (heartbeat). High-frequency and non-clinical, so not audited.
 */
export async function touchSession(
  token: string,
  kind: "activity" | "heartbeat",
  database: Db = defaultDb(),
): Promise<void> {
  if (!SESSION_TOKEN_PATTERN.test(token)) return;
  const now = new Date();
  await withTransaction(database, async (tx) => {
    await tx.session.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null, lockedAt: null, stage: "active" },
      data: kind === "activity" ? { lastActivityAt: now, lastSeenAt: now } : { lastSeenAt: now },
    });
  });
}
