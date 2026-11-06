import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit/write";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok } from "@/server/kernel/outcome";
import { normalizeIdentifier, throttleKey } from "@/server/auth/identifiers";
import { ipIsThrottled, recordIpFailure } from "@/server/auth/ip-throttle";
import { authHmacKey } from "@/server/auth/keys";
import { isLocked, registerFailure } from "@/server/auth/lockout";
import { burnPasswordCheck, verifyPassword } from "@/server/auth/password";
import { nextStage, pathForStage, primaryRole, type SessionStage } from "@/server/auth/stage";
import {
  auditActorFor,
  clearThrottle,
  createSession,
  findUserByIdentifier,
  lockThrottle,
  saveThrottle,
  upsertDevice,
} from "./shared";

export interface LoginResult {
  sessionId: string;
  token: string;
  expiresAt: Date;
  stage: SessionStage;
  redirectTo: string;
}

/**
 * Step 1 of sign-in: staff ID or email + password. Every failure path runs one Argon2
 * verification and returns one of a few generic messages, so neither the response nor its
 * timing reveals whether an account exists.
 */
export const login = defineService({
  action: "auth.login",
  input: z.object({
    identifier: z.string().min(1).max(254),
    password: z.string().min(1).max(1024),
    deviceId: z.uuid(),
    userAgent: z.string().max(500).nullable(),
  }),
  permission: { public: true, reason: "Signing in is how a caller establishes who they are." },
  async run({ tx, input, ctx }) {
    const now = new Date();

    if (ipIsThrottled(ctx.ip, now.getTime())) {
      await burnPasswordCheck(input.password);
      return fail<LoginResult>("rate_limited", "auth.error.rateLimited");
    }

    const identifier = normalizeIdentifier(input.identifier);
    const user = await findUserByIdentifier(tx, identifier);
    const actor = user ? auditActorFor(user, null, null) : null;
    const key = throttleKey(authHmacKey(), user ? { userId: user.id } : { identifier });
    const throttle = await lockThrottle(tx, key);

    if (isLocked(throttle, now)) {
      await burnPasswordCheck(input.password);
      recordIpFailure(ctx.ip, now.getTime());
      return fail<LoginResult>("locked", "auth.error.locked", { auditActor: actor });
    }

    const passwordOk = user
      ? await verifyPassword(user.passwordHash, input.password)
      : (await burnPasswordCheck(input.password), false);

    if (!user || !passwordOk) {
      const next = registerFailure(throttle, now);
      await saveThrottle(tx, key, next, now);
      recordIpFailure(ctx.ip, now.getTime());
      if (next.justLocked) {
        await writeAudit(
          tx,
          ctx,
          {
            action: "auth.lockout",
            outcome: "success",
            resourceType: "user",
            resourceId: user?.id ?? null,
            metadata: { known_account: Boolean(user), failed_count: next.failedCount },
          },
          actor ?? undefined,
        );
      }
      return fail<LoginResult>(
        next.justLocked ? "locked" : "invalid_credentials",
        next.justLocked ? "auth.error.locked" : "auth.error.invalidCredentials",
        { auditActor: actor, metadata: { failed_count: next.failedCount } },
      );
    }

    // Correct password from here on. Telling a disabled user so reveals nothing to anyone
    // who doesn't already know the password.
    if (user.disabledAt) return fail<LoginResult>("disabled", "auth.error.disabled", { auditActor: actor });
    const role = primaryRole(user.roles);
    if (!role) return fail<LoginResult>("no_role", "auth.error.noRole", { auditActor: actor });

    await clearThrottle(tx, key, now);
    await upsertDevice(tx, input.deviceId, input.userAgent, now);

    const stage = nextStage({
      roles: user.roles,
      mfaEnrolled: user.activeMfa !== null,
      mfaVerified: false,
      mustChangePassword: user.mustChangePassword,
    });
    const session = await createSession(tx, {
      userId: user.id,
      role,
      stage,
      deviceId: input.deviceId,
      ip: ctx.ip,
      userAgent: input.userAgent,
      now,
    });

    return ok<LoginResult>(
      { ...session, stage, redirectTo: pathForStage(stage, role) },
      { auditActor: auditActorFor(user, role, session.sessionId) },
    );
  },
  audit: {
    resourceType: "session",
    resourceId: (_input, value) => value?.sessionId ?? null,
  },
});
