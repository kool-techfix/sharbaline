/**
 * UUIDv7: a 48-bit millisecond timestamp followed by random bits. Generated on the client
 * for every new record (CLAUDE.md rule 11) so retries are idempotent, and time-ordered so
 * primary-key indexes stay compact. Works in browsers and Node (Web Crypto).
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let ts = BigInt(nowMs);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
