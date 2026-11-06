import { randomBytes, timingSafeEqual } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { AUTH_POLICY } from "./policy";

const { periodSeconds, digits, window } = AUTH_POLICY.totp;

export function newTotpSecret(): Buffer {
  return randomBytes(20); // 160 bits, RFC 4226 recommendation
}

export function toBase32(secret: Buffer): string {
  return new Secret({ buffer: new Uint8Array(secret).buffer }).base32;
}

/** "ABCD EFGH …" for typing the key by hand. */
export function groupedKey(secret: Buffer): string {
  return toBase32(secret).replace(/(.{4})(?=.)/g, "$1 ");
}

function totpFor(secret: Buffer, issuer = "HMS", label = "staff"): TOTP {
  return new TOTP({
    issuer,
    label,
    algorithm: "SHA1", // what authenticator apps support universally
    digits,
    period: periodSeconds,
    secret: new Secret({ buffer: new Uint8Array(secret).buffer }),
  });
}

export function otpauthUri(secret: Buffer, issuer: string, accountLabel: string): string {
  return totpFor(secret, issuer, accountLabel).toString();
}

export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / periodSeconds);
}

export function codeForStep(secret: Buffer, step: number): string {
  return totpFor(secret).generate({ timestamp: step * periodSeconds * 1000 });
}

export type TotpCheck =
  | { ok: true; step: number }
  | { ok: false; reason: "invalid_code" | "replayed_code" };

/**
 * Accept a code from the current step ±1 (clock drift between phone and server), but only for
 * a step AFTER the last one accepted. That blocks replaying a code within its validity window
 * and reusing any earlier code.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  nowMs: number,
  lastUsedStep: number | null,
): TotpCheck {
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "invalid_code" };
  const current = timeStep(nowMs);
  const submitted = Buffer.from(code);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    const expected = Buffer.from(codeForStep(secret, step));
    if (timingSafeEqual(expected, submitted)) matched = step;
  }
  if (matched === null) return { ok: false, reason: "invalid_code" };
  if (lastUsedStep !== null && matched <= lastUsedStep) return { ok: false, reason: "replayed_code" };
  return { ok: true, step: matched };
}
