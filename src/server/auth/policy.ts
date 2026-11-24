/**
 * Sign-in policy numbers. These are decisions (M1 plan, D-022), not configuration, so they
 * live in code. The only runtime override is SESSION_IDLE_SECONDS_OVERRIDE, which can only
 * shorten the idle timeout.
 */
export const AUTH_POLICY = {
  password: { minLength: 10, maxLength: 128 },
  lockout: { threshold: 5, windowMs: 15 * 60_000, durationMs: 15 * 60_000 },
  /** Per-IP limit on failed attempts across all accounts. */
  ipThrottle: { maxFailures: 30, windowMs: 15 * 60_000 },
  session: {
    idleMs: 10 * 60_000,
    absoluteMs: 12 * 60 * 60_000, // one shift
    /** Time allowed to finish a sign-in step (MFA code, password change). */
    stageMs: 5 * 60_000,
    /** Enrollment takes longer: installing an app, scanning, confirming. */
    enrollmentStageMs: 15 * 60_000,
    unlockMaxFailures: 5,
  },
  totp: { periodSeconds: 30, digits: 6, window: 1 },
  recoveryCodes: { count: 8 },
} as const;

/** Idle timeout in ms, honouring the shorten-only override. */
export function idleTimeoutMs(overrideSeconds: number | undefined): number {
  const configured = AUTH_POLICY.session.idleMs;
  return overrideSeconds ? Math.min(configured, overrideSeconds * 1000) : configured;
}

/**
 * The server locks slightly later than the browser does: the browser reports activity at
 * most every 30 s, so the server's view can lag. The browser lock is what users see; the
 * server lock is the backstop if the browser is closed or tampered with.
 */
export function serverIdleGraceMs(idleMs: number): number {
  return Math.min(60_000, Math.floor(idleMs / 2));
}
