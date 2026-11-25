import "server-only";
import { z } from "zod";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { throttleKey } from "@/server/auth/identifiers";
import { authHmacKey } from "@/server/auth/keys";
import { hashPassword } from "@/server/auth/password";
import { newTemporaryPassword } from "@/server/auth/tokens";
import { clearThrottle, revokeUserSessions } from "@/server/services/auth/shared";
import { anotherActiveAdminExists, displayNameSchema, emailSchema, insertUser, staffIdSchema } from "./shared";

/**
 * Create the first administrator on a new installation. Run only through
 * scripts/admin-bootstrap.ts on the server itself. Refuses once any active admin exists, so it
 * can't be used to add admins later; from then on admins create accounts in the app.
 */
export const bootstrapAdmin = defineService({
  action: "users.bootstrap_admin",
  input: z.object({
    staffId: staffIdSchema,
    email: emailSchema,
    displayName: displayNameSchema,
  }),
  permission: {
    public: true,
    reason: "Server-console bootstrap of the first admin; refuses when any admin exists.",
  },
  async run({ tx, input }): Promise<Outcome<{ userId: string; temporaryPassword: string }>> {
    const existing = await tx.user.count({ where: { disabledAt: null, roles: { some: { role: "admin" } } } });
    if (existing > 0) return fail("admin_exists", "users.error.adminExists");

    const temporaryPassword = newTemporaryPassword();
    const userId = await insertUser(
      tx,
      { ...input, roles: ["admin"], password: temporaryPassword, mustChangePassword: true },
      new Date(),
    );
    return ok({ userId, temporaryPassword });
  },
  audit: { resourceType: "user", resourceId: (_input, value) => value?.userId ?? null },
});

/**
 * Last-resort recovery when the ONLY active administrator has lost their authenticator (or
 * password). Run only through scripts/admin-recover.ts on the server console, with the
 * hospital's written approval (docs/runbooks/lost-mfa-device.md). Refuses whenever another
 * active admin exists: that admin resets the authenticator in the app instead.
 *
 * Replaces both factors: revokes the authenticator and recovery codes, issues a temporary
 * password (handed over in person, which is where identity is checked), ends every session
 * and lifts any lockout. The next sign-in forces a new password and a new authenticator.
 */
export const recoverSoleAdmin = defineService({
  action: "users.recover_admin",
  input: z.object({ staffId: staffIdSchema }),
  permission: {
    public: true,
    reason: "Server-console recovery of the only admin; refuses while any other active admin exists.",
  },
  async run({ tx, input }): Promise<Outcome<{ userId: string; temporaryPassword: string }>> {
    const now = new Date();
    const user = await tx.user.findUnique({ where: { staffId: input.staffId }, include: { roles: true } });
    if (!user || user.disabledAt || !user.roles.some((r) => r.role === "admin")) {
      return fail("not_an_active_admin", "users.error.notAnActiveAdmin");
    }
    if (await anotherActiveAdminExists(tx, user.id)) {
      return fail("other_admin_exists", "users.error.otherAdminExists", {
        auditActor: { userId: user.id, role: null, sessionId: null },
      });
    }

    await tx.mfaSecret.updateMany({
      where: { userId: user.id, status: { in: ["active", "pending"] } },
      data: { status: "revoked", revokedAt: now },
    });
    await tx.recoveryCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    const temporaryPassword = newTemporaryPassword();
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, passwordChangedAt: now },
    });
    await revokeUserSessions(tx, user.id, "admin_recovery", now);
    await clearThrottle(tx, throttleKey(authHmacKey(), { userId: user.id }));
    return ok({ userId: user.id, temporaryPassword });
  },
  audit: { resourceType: "user", resourceId: (_input, value) => value?.userId ?? null },
});
