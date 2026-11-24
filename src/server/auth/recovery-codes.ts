import { createHmac, randomInt } from "node:crypto";

// Crockford base32: no I, L, O or U, so codes survive being read aloud or handwritten.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A 10-character code (50 bits), shown as XXXXX-XXXXX. */
export function generateRecoveryCode(): string {
  let code = "";
  for (let i = 0; i < 10; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Accept lower case, spaces, hyphens, and the common look-alikes O→0, I/L→1. */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function isWellFormedRecoveryCode(normalized: string): boolean {
  return normalized.length === 10 && [...normalized].every((c) => ALPHABET.includes(c));
}

/** HMAC bound to the user, so a code is meaningless for any other account. */
export function hashRecoveryCode(
  hmacKey: Buffer,
  userId: string,
  normalized: string,
): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHmac("sha256", hmacKey).update(`recovery:${userId}:${normalized}`).digest());
}
