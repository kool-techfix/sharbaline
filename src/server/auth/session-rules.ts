import type { SessionStage } from "./stage";
import { serverIdleGraceMs } from "./policy";

export interface SessionFacts {
  stage: SessionStage;
  stageExpiresAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  lockedAt: Date | null;
  lastActivityAt: Date;
  userDisabledAt: Date | null;
}

export type SessionStatus =
  | "revoked"
  | "disabled"
  | "expired"
  | "stage_expired"
  | "pending_stage"
  | "locked"
  | "idle" // past the idle limit but not yet marked locked: the caller locks it
  | "active";

/** Whether a session may be used right now. Pure, so every rule is unit-tested. */
export function sessionStatus(facts: SessionFacts, now: Date, idleMs: number): SessionStatus {
  if (facts.revokedAt) return "revoked";
  // A disabled account is signed out on its very next request, whatever else is true.
  if (facts.userDisabledAt) return "disabled";
  if (facts.expiresAt <= now) return "expired";
  if (facts.stage !== "active") {
    return !facts.stageExpiresAt || facts.stageExpiresAt <= now ? "stage_expired" : "pending_stage";
  }
  if (facts.lockedAt) return "locked";
  if (now.getTime() - facts.lastActivityAt.getTime() > idleMs + serverIdleGraceMs(idleMs)) return "idle";
  return "active";
}

/** Statuses that mean "this session is over; go to sign-in". */
export function isSignedOut(status: SessionStatus): boolean {
  return ["revoked", "disabled", "expired", "stage_expired"].includes(status);
}
