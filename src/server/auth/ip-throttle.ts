import { AUTH_POLICY } from "./policy";

/**
 * Per-IP limit on failed sign-ins across all accounts, so one machine can't sweep through
 * staff IDs. In memory: the app runs as one process on the on-site server, and a restart
 * clearing it is acceptable because per-account lockout (in the database) still applies.
 * Requests with no known IP (no trusted proxy, e.g. local dev) share one bucket.
 */
const failures = new Map<string, number[]>();

function key(ip: string | null): string {
  return ip ?? "unknown";
}

function recent(ip: string | null, nowMs: number): number[] {
  const cutoff = nowMs - AUTH_POLICY.ipThrottle.windowMs;
  const list = (failures.get(key(ip)) ?? []).filter((t) => t > cutoff);
  failures.set(key(ip), list);
  return list;
}

export function ipIsThrottled(ip: string | null, nowMs: number): boolean {
  return recent(ip, nowMs).length >= AUTH_POLICY.ipThrottle.maxFailures;
}

export function recordIpFailure(ip: string | null, nowMs: number): void {
  recent(ip, nowMs).push(nowMs);
  if (failures.size > 10_000) failures.clear(); // bound memory against address floods
}

/** Tests only. */
export function resetIpThrottle(): void {
  failures.clear();
}
