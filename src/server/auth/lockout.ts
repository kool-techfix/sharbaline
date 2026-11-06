import { AUTH_POLICY } from "./policy";

export interface ThrottleState {
  failedCount: number;
  firstFailedAt: Date | null;
  lockedUntil: Date | null;
}

export const EMPTY_THROTTLE: ThrottleState = { failedCount: 0, firstFailedAt: null, lockedUntil: null };

type LockoutPolicy = { threshold: number; windowMs: number; durationMs: number };

export function isLocked(state: ThrottleState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now;
}

/**
 * Record one failed attempt. Failures count within a window from the first failure; reaching
 * the threshold locks for the lock duration. After a lock (or the window) expires, counting
 * starts again from one.
 */
export function registerFailure(
  state: ThrottleState,
  now: Date,
  policy: LockoutPolicy = AUTH_POLICY.lockout,
): ThrottleState & { justLocked: boolean } {
  const lockExpired = state.lockedUntil !== null && state.lockedUntil <= now;
  const windowExpired =
    state.firstFailedAt === null || now.getTime() - state.firstFailedAt.getTime() > policy.windowMs;
  const fresh = lockExpired || windowExpired;

  const failedCount = fresh ? 1 : state.failedCount + 1;
  const firstFailedAt = fresh ? now : state.firstFailedAt;
  const reachesThreshold = failedCount >= policy.threshold;
  const lockedUntil = reachesThreshold ? new Date(now.getTime() + policy.durationMs) : null;

  return { failedCount, firstFailedAt, lockedUntil, justLocked: reachesThreshold };
}
