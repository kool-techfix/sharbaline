"use server";

import { redirect } from "next/navigation";
import { toActionResult, type ActionResult } from "@/server/http/action-result";
import { clearSessionCookie, sessionTokenFromCookie, setSessionCookie } from "@/server/http/cookies";
import { requestContext } from "@/server/http/context";
import { lockIdleSession, logout, touchSession, unlockSession } from "@/server/services/auth/session";

/* Session actions used by staff pages. Every export here is a public endpoint: actions only. */

export async function signOut(): Promise<never> {
  const token = await sessionTokenFromCookie();
  if (token) {
    try {
      await logout(await requestContext(), { token });
    } catch {
      // Fall through: the cookie is cleared either way.
    }
  }
  await clearSessionCookie();
  redirect("/login?reason=signed_out");
}

export async function unlockScreen(input: { password: string }): Promise<ActionResult<null>> {
  const token = await sessionTokenFromCookie();
  if (!token) return { ok: false, code: "session_invalid", message: "" };
  const result = await toActionResult(
    async () => unlockSession(await requestContext(), { token, password: input.password }),
    async (value) => {
      await setSessionCookie(value.token, value.expiresAt);
      return null;
    },
  );
  if (!result.ok && ["session_invalid", "unlock_failed_signed_out", "locked"].includes(result.code)) {
    await clearSessionCookie();
  }
  return result;
}

/** User input happened in the browser (sent at most every 30 s). */
export async function reportActivity(): Promise<void> {
  const token = await sessionTokenFromCookie();
  if (token) await touchSession(token, "activity");
}

/** The browser's idle timer fired: lock on the server too, so a reload can't skip the lock. */
export async function lockScreen(): Promise<void> {
  const token = await sessionTokenFromCookie();
  if (!token) return;
  try {
    await lockIdleSession(await requestContext(), { token, source: "browser" });
  } catch {
    // Already locked or signed out: nothing to do.
  }
}
