import "server-only";
import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import type { Tx } from "@/server/db/tx";
import type { Role } from "@/server/permissions/roles";
import { STAFF_ID_PATTERN, normalizeIdentifier } from "@/server/auth/identifiers";
import { ROLES } from "@/server/permissions/roles";
import { hashPassword } from "@/server/auth/password";

export interface NewUser {
  id?: string;
  staffId: string;
  email?: string | null;
  displayName: string;
  roles: Role[];
  password: string;
  mustChangePassword: boolean;
  createdById?: string | null;
}

/** Insert a user and their roles. Callers decide the password policy and auditing. */
export async function insertUser(tx: Tx, user: NewUser, now: Date): Promise<string> {
  const id = user.id ?? uuidv7();
  await tx.user.create({
    data: {
      id,
      staffId: normalizeIdentifier(user.staffId),
      email: user.email ? normalizeIdentifier(user.email) : null,
      displayName: user.displayName.trim(),
      passwordHash: await hashPassword(user.password),
      mustChangePassword: user.mustChangePassword,
      passwordChangedAt: now,
      createdAt: now,
      createdById: user.createdById ?? null,
      roles: {
        create: user.roles.map((role) => ({ role, grantedAt: now, grantedById: user.createdById ?? null })),
      },
    },
  });
  return id;
}

// ─── Input schemas shared by account services (match the CHECK constraints on "user") ───

export const staffIdSchema = z
  .string()
  .max(200)
  .transform(normalizeIdentifier)
  .pipe(z.string().regex(STAFF_ID_PATTERN));
export const displayNameSchema = z.string().trim().min(1).max(120);
export const emailSchema = z.email().max(254).transform(normalizeIdentifier).nullable();
/** At least one role; duplicates removed; stored sorted so audits and comparisons are stable. */
export const rolesSchema = z
  .array(z.enum(ROLES))
  .min(1)
  .max(ROLES.length)
  .transform((roles) => [...new Set(roles)].sort());

/**
 * Whether an active admin other than `userId` exists. Locks every active admin row first (in
 * id order, so concurrent callers can't deadlock): a plain count would let two admins remove
 * each other at the same moment, each still seeing the other as active. Used before
 * disabling an admin or removing the admin role.
 */
export async function anotherActiveAdminExists(tx: Tx, userId: string): Promise<boolean> {
  const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM "user" u
      JOIN user_role r ON r.user_id = u.id AND r.role = 'admin'
     WHERE u.disabled_at IS NULL
     ORDER BY u.id
       FOR UPDATE OF u`;
  return activeAdmins.some((admin) => admin.id !== userId);
}
