import { createHmac } from "node:crypto";

/** Staff type their staff ID or email; both are matched case-insensitively. */
export function normalizeIdentifier(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export function isEmailIdentifier(normalized: string): boolean {
  return normalized.includes("@");
}

/**
 * Throttle key. When the identifier matches an account, the key is the ACCOUNT, so typing the
 * staff ID or the email counts against the same limit. When it matches nothing, the key is the
 * typed identifier, so unknown identifiers lock after the same number of attempts and an
 * attacker cannot tell real accounts from fake ones by the lockout behaviour.
 */
export function throttleKey(
  hmacKey: Buffer,
  subject: { userId: string } | { identifier: string },
): Uint8Array<ArrayBuffer> {
  const material = "userId" in subject ? `user:${subject.userId}` : `id:${subject.identifier}`;
  return new Uint8Array(createHmac("sha256", hmacKey).update(`throttle:${material}`).digest());
}
