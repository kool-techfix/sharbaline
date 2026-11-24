import { createHash, randomBytes, randomInt } from "node:crypto";

/** 256-bit random session token. The cookie carries it; the database stores only its hash. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(token).digest());
}

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Temporary password issued by an admin: 4 groups of 4 from an unambiguous alphabet (~80 bits). */
export function newTemporaryPassword(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  let chars = "";
  for (let i = 0; i < 16; i++) chars += alphabet[randomInt(alphabet.length)];
  return chars.match(/.{4}/g)!.join("-");
}
