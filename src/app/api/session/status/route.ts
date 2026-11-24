import { NextResponse } from "next/server";
import { isSignedOut } from "@/server/auth/session-rules";
import { sessionTokenFromCookie } from "@/server/http/cookies";
import { currentSession } from "@/server/http/guard";
import { touchSession } from "@/server/services/auth/session";

export const dynamic = "force-dynamic";

/**
 * Heartbeat, every 30 s from open staff pages. Lets a revoked or disabled session end within
 * a minute even on an idle screen, and tells other tabs about a lock. Never counts as activity.
 */
export async function GET() {
  const session = await currentSession();
  const state = !session || isSignedOut(session.status) || session.status === "pending_stage"
    ? "signed_out"
    : session.status === "locked"
      ? "locked"
      : "active";
  if (state === "active") {
    const token = await sessionTokenFromCookie();
    if (token) await touchSession(token, "heartbeat");
  }
  return NextResponse.json({ state }, { headers: { "Cache-Control": "no-store" } });
}
