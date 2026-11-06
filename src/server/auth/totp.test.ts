import { describe, expect, it } from "vitest";
import { codeForStep, groupedKey, newTotpSecret, otpauthUri, timeStep, toBase32, verifyTotp } from "./totp";

// RFC 6238 test secret ("12345678901234567890"); known SHA-1 code at T=59s is 287082.
const RFC_SECRET = Buffer.from("12345678901234567890");

describe("TOTP", () => {
  it("matches the RFC 6238 test vector", () => {
    expect(codeForStep(RFC_SECRET, timeStep(59_000))).toBe("287082");
  });

  it("accepts the current code and ±1 step of clock drift, nothing further", () => {
    const now = 1_800_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, step), now, null)).toEqual({ ok: true, step });
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, step - 1), now, null).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, step + 1), now, null).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, step - 2), now, null)).toEqual({
      ok: false,
      reason: "invalid_code",
    });
  });

  it("rejects a replay of a code already used, and any older code", () => {
    const now = 1_800_000_000_000;
    const step = timeStep(now);
    const code = codeForStep(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toEqual({ ok: false, reason: "replayed_code" });
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, step - 1), now, step)).toEqual({
      ok: false,
      reason: "replayed_code",
    });
    expect(verifyTotp(RFC_SECRET, codeForStep(RFC_SECRET, step + 1), now, step).ok).toBe(true);
  });

  it("rejects anything that isn't exactly six digits", () => {
    for (const bad of ["", "12345", "1234567", "12a456", " 123456"]) {
      expect(verifyTotp(RFC_SECRET, bad, 0, null)).toEqual({ ok: false, reason: "invalid_code" });
    }
  });

  it("builds an otpauth URI and a typeable key", () => {
    const secret = newTotpSecret();
    expect(secret).toHaveLength(20);
    const uri = otpauthUri(secret, "HMS · Demo Hospital", "nurse.demo");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`secret=${toBase32(secret)}`);
    expect(groupedKey(secret).replace(/ /g, "")).toBe(toBase32(secret));
  });
});
