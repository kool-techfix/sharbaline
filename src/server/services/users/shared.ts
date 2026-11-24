import "server-only";
import { uuidv7 } from "@/lib/ids";
import type { Tx } from "@/server/db/tx";
import type { Role } from "@/server/permissions/roles";
import { normalizeIdentifier } from "@/server/auth/identifiers";
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
