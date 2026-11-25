import { dammCheckDigit, dammIsValid } from "./damm";

/*
 * Patient number (D-003): hospital prefix + "-" + sequence number + Damm check digit, e.g.
 * HSP-2073 → HSP-20737. Stored once at registration and never changed.
 */

export const PREFIX_PATTERN = /^[A-Z]{2,6}$/;

export function formatPatientNumber(prefix: string, sequence: number | bigint): string {
  if (!PREFIX_PATTERN.test(prefix)) throw new Error("Patient number prefix must be 2-6 capital letters");
  const digits = String(sequence);
  if (!/^\d+$/.test(digits) || digits === "0") throw new Error("Sequence must be a positive integer");
  return `${prefix}-${digits}${dammCheckDigit(digits)}`;
}

export type ParsedPatientNumber =
  | { kind: "valid"; digits: string; prefix: string | null }
  | { kind: "bad_check_digit" }
  | { kind: "not_a_number" };

/**
 * Read what someone typed or scanned: with or without the prefix, any case, spaces or dashes
 * ignored. Digits-only input may also be a phone or legacy card number, so callers search
 * those too; a valid check digit only says it COULD be a patient number.
 */
export function parsePatientNumber(raw: string): ParsedPatientNumber {
  const compact = raw.normalize("NFKC").replace(/[\s-]/g, "").toUpperCase();
  const match = /^([A-Z]{2,6})?(\d{2,12})$/.exec(compact);
  if (!match) return { kind: "not_a_number" };
  const digits = match[2]!;
  return dammIsValid(digits) ? { kind: "valid", digits, prefix: match[1] ?? null } : { kind: "bad_check_digit" };
}
