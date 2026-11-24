import { AUTH_POLICY } from "./policy";

/**
 * Password rules (M1 decision): at least 10 characters, no composition rules, not a common
 * password, not the user's own staff ID or email. Unicode is normalised (NFKC) before checking
 * and hashing, so the same password typed on different keyboards matches.
 */
export type PasswordProblem = "too_short" | "too_long" | "common" | "contains_identifier";

export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

export function checkPassword(
  password: string,
  context: { commonPasswords: ReadonlySet<string>; staffId?: string; email?: string | null },
): PasswordProblem | null {
  const normalized = normalizePassword(password);
  const length = [...normalized].length; // Unicode code points, per NIST SP 800-63B
  if (length < AUTH_POLICY.password.minLength) return "too_short";
  if (length > AUTH_POLICY.password.maxLength) return "too_long";

  const lower = normalized.toLowerCase();
  if (context.commonPasswords.has(lower)) return "common";

  const identifiers = [context.staffId, context.email, context.email?.split("@")[0]]
    .filter((v): v is string => typeof v === "string" && v.length >= 4)
    .map((v) => v.toLowerCase());
  if (identifiers.some((id) => lower.includes(id))) return "contains_identifier";

  return null;
}
