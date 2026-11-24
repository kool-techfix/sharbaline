import "server-only";
import { redirect } from "next/navigation";
import { isSignedOut } from "@/server/auth/session-rules";
import { ROLE_HOME, pathForStage } from "@/server/auth/stage";
import type { Actor } from "@/server/kernel/context";
import type { Role } from "@/server/permissions/roles";
import { readSession, type CurrentSession } from "@/server/services/auth/session";
import { sessionTokenFromCookie } from "./cookies";
import { requestContext } from "./context";

/** The caller's session, or null. Locks it if it has gone idle (audited). */
export async function currentSession(): Promise<CurrentSession | null> {
  const token = await sessionTokenFromCookie();
  if (!token) return null;
  const { actor: _anonymous, ...ctx } = await requestContext();
  void _anonymous;
  return readSession(token, ctx);
}

export function actorOf(session: CurrentSession): Actor {
  return { kind: "user", userId: session.user.id, role: session.role, sessionId: session.sessionId };
}

/**
 * For staff pages: a fully signed-in session (possibly idle-locked), or a redirect.
 * Server-side, on every request: hiding UI is not enforcement (CLAUDE.md rule 6).
 */
export async function requireSignedIn(): Promise<CurrentSession> {
  const session = await currentSession();
  if (!session || isSignedOut(session.status)) redirect("/login?reason=signed_out");
  if (session.status === "pending_stage") redirect(pathForStage(session.stage, session.role));
  return session;
}

/** For a role's pages: send anyone else to their own home. */
export async function requireRole(role: Role): Promise<CurrentSession> {
  const session = await requireSignedIn();
  if (session.role !== role) redirect(ROLE_HOME[session.role]);
  return session;
}
