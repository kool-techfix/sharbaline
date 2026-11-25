"use server";

import { t } from "@/lib/i18n";
import { actAsCaller, type ActionResult } from "@/server/http/action-result";
import {
  disableUser,
  issueTemporaryPassword,
  resetMfa,
  revokeUserSessionsService,
  unlockAccount,
} from "@/server/services/users/admin";
import { createUser, enableUser, updateUserDetails, updateUserRoles } from "@/server/services/users/manage";

/*
 * Admin user management. Every export here is a public endpoint: each one acts as the signed-in
 * caller, and the service checks the admin permission and audits (rules 4–6).
 */

export async function createAccount(input: {
  id: string;
  staffId: string;
  displayName: string;
  email: string | null;
  roles: string[];
}): Promise<ActionResult<{ userId: string; temporaryPassword: string }>> {
  return actAsCaller((ctx) => createUser(ctx, input), (value) => value);
}

export async function saveDetails(input: {
  userId: string;
  displayName: string;
  email: string | null;
}): Promise<ActionResult<null>> {
  return actAsCaller((ctx) => updateUserDetails(ctx, input), () => null);
}

export async function saveRoles(input: { userId: string; roles: string[] }): Promise<ActionResult<{ changed: boolean }>> {
  return actAsCaller(
    (ctx) => updateUserRoles(ctx, input),
    (value) => ({ changed: value.changed }),
  );
}

export type AccountAction = "disable" | "enable" | "temporary_password" | "unlock" | "reset_mfa" | "end_sessions";

/** One of the account actions on the user page. Returns what the screen needs to show. */
export async function runAccountAction(input: {
  userId: string;
  action: AccountAction;
}): Promise<ActionResult<{ temporaryPassword?: string; sessionsEnded?: number }>> {
  const target = { userId: input.userId };
  switch (input.action) {
    case "disable":
      return actAsCaller((ctx) => disableUser(ctx, target), () => ({}));
    case "enable":
      return actAsCaller((ctx) => enableUser(ctx, target), () => ({}));
    case "temporary_password":
      return actAsCaller(
        (ctx) => issueTemporaryPassword(ctx, target),
        (value) => ({ temporaryPassword: value.temporaryPassword }),
      );
    case "unlock":
      return actAsCaller((ctx) => unlockAccount(ctx, target), () => ({}));
    case "reset_mfa":
      return actAsCaller((ctx) => resetMfa(ctx, target), () => ({}));
    case "end_sessions":
      return actAsCaller(
        (ctx) => revokeUserSessionsService(ctx, target),
        (value) => ({ sessionsEnded: value.revoked }),
      );
    default:
      return { ok: false, code: "invalid_input", message: t("errors.invalidInput") };
  }
}
