import { describe, expect, it } from "vitest";
import { checkPassword } from "./password-policy";

const commonPasswords = new Set(["qwertyuiop", "1234567890", "passwordpassword"]);
const check = (password: string, extra: { staffId?: string; email?: string | null } = {}) =>
  checkPassword(password, { commonPasswords, ...extra });

describe("password policy (10+ chars, no composition rules, not common)", () => {
  it("accepts any 10+ character password that isn't common", () => {
    expect(check("tea with milk at noon")).toBeNull();
    expect(check("aaaaaaaaab")).toBeNull(); // no composition rules
  });

  it("rejects fewer than 10 characters", () => {
    expect(check("short9chr")).toBe("too_short");
    expect(check("")).toBe("too_short");
  });

  it("counts Unicode code points after NFKC (NIST SP 800-63B), however the accent was typed", () => {
    const precomposed = "caf\u00e9caf\u00e9a"; // 9 code points
    const decomposed = "cafe\u0301cafe\u0301a"; // same text, typed as e + combining accent
    expect(check(precomposed)).toBe("too_short");
    expect(check(decomposed)).toBe("too_short");
    expect(check(`${decomposed}s`)).toBeNull();
  });

  it("rejects over 128 characters", () => {
    expect(check("x".repeat(129))).toBe("too_long");
  });

  it("rejects common passwords in any letter case", () => {
    expect(check("QWERTYuiop")).toBe("common");
    expect(check("1234567890")).toBe("common");
  });

  it("rejects passwords containing the staff ID or email", () => {
    expect(check("nurse.demo-2026!", { staffId: "nurse.demo" })).toBe("contains_identifier");
    expect(check("my amina.bello pass", { email: "amina.bello@hospital.test" })).toBe("contains_identifier");
  });
});
