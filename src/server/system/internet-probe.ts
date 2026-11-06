import "server-only";
import { serverEnv } from "@/server/config/env";

export type InternetStatus = "up" | "down" | "unknown";

/**
 * Whether the on-site server can reach the internet, for the "Online" vs "Working offline"
 * distinction (scope §7.1). Checked at most once a minute in the background; requests never
 * wait on the internet except the very first check (3 s timeout). "unknown" only when no probe
 * URL is configured, which production forbids.
 */
const STALE_MS = 60_000;
const TIMEOUT_MS = 3_000;

let lastStatus: InternetStatus = "unknown";
let lastCheckedAt = 0;
let inFlight: Promise<void> | null = null;

async function check(url: string): Promise<void> {
  try {
    // Any HTTP response means the internet is reachable; only network failures count as down.
    await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    lastStatus = "up";
  } catch {
    lastStatus = "down";
  } finally {
    lastCheckedAt = Date.now();
  }
}

export async function internetStatus(): Promise<{ status: InternetStatus; checkedAt: Date | null }> {
  const url = serverEnv().INTERNET_PROBE_URL;
  if (!url) return { status: "unknown", checkedAt: null };

  if (Date.now() - lastCheckedAt > STALE_MS && !inFlight) {
    inFlight = check(url).finally(() => {
      inFlight = null;
    });
  }
  if (lastCheckedAt === 0 && inFlight) await inFlight;
  return { status: lastStatus, checkedAt: lastCheckedAt ? new Date(lastCheckedAt) : null };
}
