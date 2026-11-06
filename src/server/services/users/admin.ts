import "server-only";
import { z } from "zod";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { throttleKey } from "@/server/auth/identifiers";
import { authHmacKey } from "@/server/auth/keys";
import { hashPassword } from "@/server/auth/password";
import { newTemporaryPassword } from "@/server/auth/tokens";
import { clearThrottle, lockThrottle, revokeUserSessions } from "@/server/services/auth/shared";

/*
 * Admin account actions (scope §4.1: users C R U = admin). The admin screens arrive with the
 * user-management slice; these services and their tests come first because sign-in depends on
 * them (temporary passwords, unlocks, MFA resets, revocation).
 */

const target = z.object({ userId: z.uuid() });

function actorUserId(ctx: { actor: { kind: string; userId?: string } }): string | undefined {
  return ctx.actor.kind === "user" ? ctx.actor.userId : undefined;
}

/** End every session of a user. Takes effect on their next request; idle screens within 30 s. */
export const revokeUserSessionsService = defineService({
  action: "auth.session_revoke",
  input: target,
  permission: { resource: "users", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<{ revoked: number }>> {
    const revoked = await revokeUserSessions(tx, input.userId, "admin_revoked", new Date(), {
      byUserId: actorUserId(ctx),
    });
    return ok({ revoked });
  },
  audit: {
    resourceType: "user",
    resourceId: (input) => input.userId,
    metadata: (_input, value) => ({ sessions_revoked: value?.revoked ?? null }),
  },
});

export const disableUser = defineService({
  action: "users.disable",
  input: target,
  permission: { resource: "users", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<null>> {
    const now = new Date();
    if (input.userId === actorUserId(ctx)) return fail("cannot_disable_self", "users.error.cannotDisableSelf");
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: { roles: true } });
    if (!user) return fail("not_found", "users.error.notFound");
    if (user.disabledAt) return ok(null);

    // Never leave the hospital without an administrator.
    if (user.roles.some((r) => r.role === "admin")) {
      const otherAdmins = await tx.user.count({
        where: { id: { not: user.id }, disabledAt: null, roles: { some: { role: "admin" } } },
      });
      if (otherAdmins === 0) return fail("last_admin", "users.error.lastAdmin");
    }

    await tx.user.update({ where: { id: user.id }, data: { disabledAt: now } });
    await revokeUserSessions(tx, user.id, "user_disabled", now, { byUserId: actorUserId(ctx) });
    return ok(null);
  },
  audit: { resourceType: "user", resourceId: (input) => input.userId },
});

/**
 * Admin password reset (no email reset in Phase 1). Returns a one-time temporary password for
 * the admin to hand over in person; the user must replace it at next sign-in.
 */
export const issueTemporaryPassword = defineService({
  action: "users.issue_temporary_password",
  input: target,
  permission: { resource: "users", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<{ temporaryPassword: string }>> {
    const now = new Date();
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) return fail("not_found", "users.error.notFound");
    const temporaryPassword = newTemporaryPassword();
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, passwordChangedAt: now },
    });
    await revokeUserSessions(tx, user.id, "password_reset", now, { byUserId: actorUserId(ctx) });
    const key = throttleKey(authHmacKey(), { userId: user.id });
    await lockThrottle(tx, key);
    await clearThrottle(tx, key, now);
    return ok({ temporaryPassword });
  },
  audit: { resourceType: "user", resourceId: (input) => input.userId },
});

/** Lift a 15-minute lockout early. */
export const unlockAccount = defineService({
  action: "users.unlock_account",
  input: target,
  permission: { resource: "users", action: "update" },
  async run({ tx, input }): Promise<Outcome<null>> {
    const now = new Date();
    const key = throttleKey(authHmacKey(), { userId: input.userId });
    await lockThrottle(tx, key);
    await clearThrottle(tx, key, now);
    return ok(null);
  },
  audit: { resourceType: "user", resourceId: (input) => input.userId },
});

/** Lost phone: revoke the TOTP secret and recovery codes; the user re-enrolls at next sign-in. */
export const resetMfa = defineService({
  action: "users.reset_mfa",
  input: target,
  permission: { resource: "users", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<null>> {
    const now = new Date();
    if (input.userId === actorUserId(ctx)) return fail("cannot_reset_own_mfa", "users.error.cannotResetOwnMfa");
    await tx.mfaSecret.updateMany({
      where: { userId: input.userId, status: { in: ["active", "pending"] } },
      data: { status: "revoked", revokedAt: now },
    });
    await tx.recoveryCode.updateMany({ where: { userId: input.userId, usedAt: null }, data: { usedAt: now } });
    await revokeUserSessions(tx, input.userId, "mfa_reset", now, { byUserId: actorUserId(ctx) });
    return ok(null);
  },
  audit: { resourceType: "user", resourceId: (input) => input.userId },
});
