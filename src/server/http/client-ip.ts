import { isIP } from "node:net";

/**
 * The client's IP for audit and per-IP throttling. Next.js doesn't expose the socket address,
 * so behind the reverse proxy we read X-Forwarded-For. Caddy APPENDS the address it saw, so
 * the rightmost entry is the one our proxy vouches for; anything to its left was sent by the
 * client and could be forged. Only trusted when TRUST_PROXY_HEADERS is on (D-022).
 */
export function clientIpFrom(forwardedFor: string | null, trustProxyHeaders: boolean): string | null {
  if (!trustProxyHeaders || !forwardedFor) return null;
  const last = forwardedFor.split(",").pop()?.trim() ?? "";
  const unwrapped = last.replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  return isIP(unwrapped) ? unwrapped : null;
}
