/**
 * The four connection states from docs/scope.md §7.1. Keep them distinct (CLAUDE.md rule 16):
 *   online              device reaches the server; server reaches the cloud
 *   working_offline     device reaches the server on the LAN; internet is down (fully usable)
 *   server_unreachable  device cannot reach the on-site server (read-only cache, local drafts)
 *   syncing             reconnecting and sending queued changes
 * Detection logic arrives with the login slice (server/internet) and slice 8 (sync).
 */
export const CONNECTION_STATES = [
  "online",
  "working_offline",
  "server_unreachable",
  "syncing",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

/** Body of GET /api/health. */
export interface HealthResponse {
  server: "ok";
  internet: "up" | "down" | "unknown";
}

/**
 * Map a health check to a state. A failed request means the server is unreachable. "unknown"
 * internet (no probe configured, development only) shows as online rather than claiming an outage.
 */
export function connectionStateFrom(health: HealthResponse | null): Exclude<ConnectionState, "syncing"> {
  if (!health) return "server_unreachable";
  return health.internet === "down" ? "working_offline" : "online";
}
