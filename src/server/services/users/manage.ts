import "server-only";
import { z } from "zod";
import type { Tx } from "@/server/db/tx";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { throttleKey } from "@/server/auth/identifiers";
import { authHmacKey } from "@/server/auth/keys";
import { newTemporaryPassword } from "@/server/auth/tokens";
import type { Role } from "@/server/permissions/roles";
import { revokeUserSessions } from "@/server/services/auth/shared";
import {
  anotherActiveAdminExists,
  displayNameSchema,
  emailSchema,
  insertUser,
  rolesSchema,
  staffIdSchema,
} from "./shared";

/*
 * Admin user management (scope §5 M1: create/disable users, assign roles, reset MFA; matrix:
 * users C R U = admin). Account actions that sign-in depends on live in admin.ts. Staff names
 * and IDs are not patient data, but audit metadata still carries only codes and counts.
 */

function actorUserId(ctx: { actor: { kind: string; userId?: string } }): string | undefined {
  return ctx.actor.kind === "user" ? ctx.actor.userId : undefined;
}

export type MfaState = "enrolled" | "not_enrolled";

export interface UserSummary {
  id: string;
  staffId: string;
  displayName: string;
  email: string | null;
  roles: Role[];
  disabled: boolean;
  mfa: MfaState;
  /** Signed-in attempts are paused by the 15-minute lockout. */
  locked: boolean;
}

export interface UserDetail extends UserSummary {
  mustChangePassword: boolean;
  createdAt: Date;
  activeSessions: number;
  recoveryCodesLeft: number;
  lastSignInAt: Date | null;
}

const LIST_LIMIT = 200;

async function lockedUserIds(tx: Tx, userIds: string[], now: Date): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const keys = new Map(
    userIds.map((id) => [Buffer.from(throttleKey(authHmacKey(), { userId: id })).toString("hex"), id]),
  );
  const rows = await tx.$queryRaw<{ key_hash: Uint8Array }[]>`
    SELECT key_hash FROM login_throttle
     WHERE key_hash = ANY(${[...keys.keys()].map((hex) => Buffer.from(hex, "hex"))})
       AND locked_until > ${now}`;
  return new Set(rows.map((row) => keys.get(Buffer.from(row.key_hash).toString("hex"))!));
}

const userSelect = {
  id: true,
  staffId: true,
  displayName: true,
  email: true,
  disabledAt: true,
  mustChangePassword: true,
  createdAt: true,
  roles: { select: { role: true } },
  mfaSecrets: { where: { status: "active" as const }, select: { id: true } },
} as const;

/** All staff accounts, optionally filtered by name, staff ID or email. */
export const listUsers = defineService({
  action: "users.list",
  input: z.object({ query: z.string().trim().max(100).default("") }),
  permission: { resource: "users", action: "read" },
  async run({ tx, input }): Promise<Outcome<{ users: UserSummary[]; truncated: boolean }>> {
    const q = input.query;
    const rows = await tx.user.findMany({
      where: q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { staffId: { contains: q.toLowerCase() } },
              { email: { contains: q.toLowerCase() } },
            ],
          }
        : undefined,
      select: userSelect,
      orderBy: [{ disabledAt: { sort: "asc", nulls: "first" } }, { displayName: "asc" }],
      take: LIST_LIMIT + 1,
    });
    const page = rows.slice(0, LIST_LIMIT);
    const locked = await lockedUserIds(tx, page.map((row) => row.id), new Date());
    return ok({
      truncated: rows.length > LIST_LIMIT,
      users: page.map((row) => ({
        id: row.id,
        staffId: row.staffId,
        displayName: row.displayName,
        email: row.email,
        roles: row.roles.map((r) => r.role).sort(),
        disabled: row.disabledAt !== null,
        mfa: row.mfaSecrets.length > 0 ? "enrolled" : "not_enrolled",
        locked: locked.has(row.id),
      })),
    });
  },
  // The search text is never audited (free text); only whether one was used and the count.
  audit: {
    resourceType: "user",
    metadata: (input, value) => ({ searched: input.query !== "", results: value?.users.length ?? null }),
  },
});

export const getUser = defineService({
  action: "users.view",
  input: z.object({ userId: z.uuid() }),
  permission: { resource: "users", action: "read" },
  async run({ tx, input }): Promise<Outcome<UserDetail>> {
    const now = new Date();
    const row = await tx.user.findUnique({ where: { id: input.userId }, select: userSelect });
    if (!row) return fail("not_found", "users.error.notFound");
    // One transaction is one connection: run the queries in sequence.
    const activeSessions = await tx.session.count({
      where: { userId: row.id, revokedAt: null, expiresAt: { gt: now } },
    });
    const recoveryCodesLeft = await tx.recoveryCode.count({
      where: { userId: row.id, usedAt: null, mfaSecretId: { in: row.mfaSecrets.map((m) => m.id) } },
    });
    const lastSession = await tx.session.findFirst({
      where: { userId: row.id, stage: "active" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const locked = await lockedUserIds(tx, [row.id], now);
    return ok({
      id: row.id,
      staffId: row.staffId,
      displayName: row.displayName,
      email: row.email,
      roles: row.roles.map((r) => r.role).sort(),
      disabled: row.disabledAt !== null,
      mfa: row.mfaSecrets.length > 0 ? "enrolled" : "not_enrolled",
      locked: locked.has(row.id),
      mustChangePassword: row.mustChangePassword,
      createdAt: row.createdAt,
      activeSessions,
      recoveryCodesLeft,
      lastSignInAt: lastSession?.createdAt ?? null,
    });
  },
  audit: { resourceType: "user", resourceId: (input) => input.userId },
});

/**
 * Create a staff account with a one-time temporary password for the admin to hand over in
 * person. The client generates the id (rule 11), so a retried request can't create a second
 * account; the retry is refused, because the temporary password can't be shown again.
 */
export const createUser = defineService({
  action: "users.create",
  input: z.object({
    id: z.uuid(),
    staffId: staffIdSchema,
    displayName: displayNameSchema,
    email: emailSchema,
    roles: rolesSchema,
  }),
  permission: { resource: "users", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ userId: string; temporaryPassword: string }>> {
    if (await tx.user.findUnique({ where: { id: input.id }, select: { id: true } })) {
      return fail("already_created", "users.error.alreadyCreated");
    }
    if (await tx.user.findUnique({ where: { staffId: input.staffId }, select: { id: true } })) {
      return fail("staff_id_taken", "users.error.staffIdTaken");
    }
    if (input.email && (await tx.user.findUnique({ where: { email: input.email }, select: { id: true } }))) {
      return fail("email_taken", "users.error.emailTaken");
    }
    const temporaryPassword = newTemporaryPassword();
    const userId = await insertUser(
      tx,
      { ...input, password: temporaryPassword, mustChangePassword: true, createdById: actorUserId(ctx) ?? null },
      new Date(),
    );
    return ok({ userId, temporaryPassword });
  },
  audit: {
    resourceType: "user",
    resourceId: (input) => input.id,
    metadata: (input) => ({ roles: input.roles.join(",") }),
  },
});

export const updateUserDetails = defineService({
  action: "users.update_details",
  input: z.object({ userId: z.uuid(), displayName: displayNameSchema, email: emailSchema }),
  permission: { resource: "users", action: "update" },
  async run({ tx, input }): Promise<Outcome<null>> {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!user) return fail("not_found", "users.error.notFound");
    if (input.email) {
      const owner = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (owner && owner.id !== user.id) return fail("email_taken", "users.error.emailTaken");
    }
    await tx.user.update({ where: { id: user.id }, data: { displayName: input.displayName, email: input.email } });
    return ok(null);
  },
  audit: { resourceType: "user", resourceId: (input) => input.userId },
});

/**
 * Replace a user's roles. Any change signs the user out everywhere: their sessions were
 * granted under the old roles, and a new MFA-requiring role must take effect (enrollment) at
 * the next sign-in rather than in a session that never proved a second factor.
 */
export const updateUserRoles = defineService({
  action: "users.update_roles",
  input: z.object({ userId: z.uuid(), roles: rolesSchema }),
  permission: { resource: "users", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<{ changed: boolean; sessionsEnded: number }>> {
    const now = new Date();
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: { roles: true } });
    if (!user) return fail("not_found", "users.error.notFound");
    const current = user.roles.map((r) => r.role).sort();
    const removed = current.filter((role) => !input.roles.includes(role));
    const added = input.roles.filter((role) => !current.includes(role));
    if (removed.length === 0 && added.length === 0) return ok({ changed: false, sessionsEnded: 0 });

    if (removed.includes("admin")) {
      if (user.id === actorUserId(ctx)) return fail("cannot_remove_own_admin", "users.error.cannotRemoveOwnAdmin");
      if (!user.disabledAt && !(await anotherActiveAdminExists(tx, user.id))) {
        return fail("last_admin", "users.error.lastAdmin");
      }
    }

    await tx.userRole.deleteMany({ where: { userId: user.id, role: { in: removed } } });
    await tx.userRole.createMany({
      data: added.map((role) => ({ userId: user.id, role, grantedAt: now, grantedById: actorUserId(ctx) ?? null })),
    });
    const sessionsEnded = await revokeUserSessions(tx, user.id, "roles_changed", now, { byUserId: actorUserId(ctx) });
    return ok({ changed: true, sessionsEnded });
  },
  audit: {
    resourceType: "user",
    resourceId: (input) => input.userId,
    metadata: (input, value) => ({ roles: input.roles.join(","), sessions_ended: value?.sessionsEnded ?? null }),
  },
});

/** Switch a disabled account back on. Its sessions ended when it was disabled. */
export const enableUser = defineService({
  action: "users.enable",
  input: z.object({ userId: z.uuid() }),
  permission: { resource: "users", action: "update" },
  async run({ tx, input }): Promise<Outcome<null>> {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, disabledAt: true } });
    if (!user) return fail("not_found", "users.error.notFound");
    if (user.disabledAt) await tx.user.update({ where: { id: user.id }, data: { disabledAt: null } });
    return ok(null);
  },
  audit: { resourceType: "user", resourceId: (input) => input.userId },
});
