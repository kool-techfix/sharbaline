import { AUTH_POLICY } from "./policy";

/**
 * Per-IP limit on failed sign-ins across all accounts, so one machine can't sweep through
 * staff IDs. In memory: the app runs as one process on the on-site server, and a restart
 * clearing it is acceptable because per-account lockout (in the database) still applies.
 *
 * Requests with no known IP are NOT limited here: putting them all in one bucket would let a
 * single person lock every workstation out of sign-in (Availability). Per-account lockout still
 * applies to them, and production requires trusted proxy headers (env.ts), so IPs are known.
 */
const failures = new Map<string, number[]>();

function recent(ip: string, nowMs: number): number[] {
  const cutoff = nowMs - AUTH_POLICY.ipThrottle.windowMs;
  const list = (failures.get(ip) ?? []).filter((t) => t > cutoff);
  failures.set(ip, list);
  return list;
}

export function ipIsThrottled(ip: string | null, nowMs: number): boolean {
  if (ip === null) return false;
  return recent(ip, nowMs).length >= AUTH_POLICY.ipThrottle.maxFailures;
}

export function recordIpFailure(ip: string | null, nowMs: number): void {
  if (ip === null) return;
  recent(ip, nowMs).push(nowMs);
  if (failures.size > 10_000) failures.clear(); // bound memory against address floods
}

/** Tests only. */
export function resetIpThrottle(): void {
  failures.clear();
}
