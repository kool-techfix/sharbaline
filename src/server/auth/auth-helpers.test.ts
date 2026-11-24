import { describe, expect, it } from "vitest";
import { normalizeIdentifier, throttleKey } from "./identifiers";
import { decryptSecret, encryptSecret } from "./mfa-crypto";
import { idleTimeoutMs, serverIdleGraceMs } from "./policy";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  isWellFormedRecoveryCode,
  normalizeRecoveryCode,
} from "./recovery-codes";
import { hashSessionToken, newSessionToken, newTemporaryPassword, SESSION_TOKEN_PATTERN } from "./tokens";

const key = Buffer.alloc(32, 3);

describe("identifiers", () => {
  it("normalise case, width and surrounding space", () => {
    expect(normalizeIdentifier("  Nurse.Demo ")).toBe("nurse.demo");
    expect(normalizeIdentifier("ＮＵＲＳＥ")).toBe("nurse"); // full-width letters
  });

  it("key throttling by account when known, so staff ID and email share one limit", () => {
    const byAccount = Buffer.from(throttleKey(key, { userId: "u1" }));
    expect(byAccount.equals(Buffer.from(throttleKey(key, { userId: "u1" })))).toBe(true);
    expect(byAccount.equals(Buffer.from(throttleKey(key, { identifier: "u1" })))).toBe(false);
  });
});

describe("recovery codes", () => {
  it("are 10 unambiguous characters shown as XXXXX-XXXXX", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
      expect(isWellFormedRecoveryCode(normalizeRecoveryCode(code))).toBe(true);
    }
  });

  it("forgive case, spaces, dashes and look-alike letters", () => {
    expect(normalizeRecoveryCode(" 7k2qm-x9d4p ")).toBe("7K2QMX9D4P");
    expect(normalizeRecoveryCode("O0ILl")).toBe("00111");
  });

  it("hash differently per user", () => {
    const a = Buffer.from(hashRecoveryCode(key, "user-a", "7K2QMX9D4P"));
    const b = Buffer.from(hashRecoveryCode(key, "user-b", "7K2QMX9D4P"));
    expect(a.equals(b)).toBe(false);
  });
});

describe("MFA secret encryption", () => {
  it("round-trips for the right user and fails for any other", () => {
    const secret = Buffer.from("12345678901234567890");
    const encrypted = encryptSecret(key, 1, "user-a", secret);
    expect(decryptSecret(key, "user-a", encrypted).equals(secret)).toBe(true);
    expect(() => decryptSecret(key, "user-b", encrypted)).toThrow();
    expect(() => decryptSecret(Buffer.alloc(32, 4), "user-a", encrypted)).toThrow();
  });
});

describe("session tokens and temporary passwords", () => {
  it("tokens are 256-bit, URL-safe, and stored only as a hash", () => {
    const token = newSessionToken();
    expect(token).toMatch(SESSION_TOKEN_PATTERN);
    expect(hashSessionToken(token)).toHaveLength(32);
    expect(newSessionToken()).not.toBe(token);
  });

  it("temporary passwords are 4 groups of 4 and pass the 10-character rule", () => {
    expect(newTemporaryPassword()).toMatch(/^[2-9a-hjkmnp-z]{4}(-[2-9a-hjkmnp-z]{4}){3}$/);
  });
});

describe("idle timeout", () => {
  it("is 10 minutes and can only be shortened by the override", () => {
    expect(idleTimeoutMs(undefined)).toBe(600_000);
    expect(idleTimeoutMs(8)).toBe(8_000);
    expect(idleTimeoutMs(5_000)).toBe(600_000);
  });

  it("gives the server a grace period behind the browser, capped at a minute", () => {
    expect(serverIdleGraceMs(600_000)).toBe(60_000);
    expect(serverIdleGraceMs(8_000)).toBe(4_000);
  });
});
