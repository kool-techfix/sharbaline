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
