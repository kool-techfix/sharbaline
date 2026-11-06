import "server-only";
import { z } from "zod";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { newTemporaryPassword } from "@/server/auth/tokens";
import { insertUser } from "./shared";

/**
 * Create the first administrator on a new installation. Run only through
 * scripts/admin-bootstrap.ts on the server itself. Refuses once any active admin exists, so it
 * can't be used to add admins later; from then on admins create accounts in the app.
 */
export const bootstrapAdmin = defineService({
  action: "users.bootstrap_admin",
  input: z.object({
    staffId: z.string().trim().min(3).max(64),
    email: z.email().max(254).nullable(),
    displayName: z.string().trim().min(1).max(120),
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
