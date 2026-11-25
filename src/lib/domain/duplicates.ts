import { nameSimilarity } from "./names";

/*
 * Duplicate scoring at registration (scope §5 M2, D-010). A pure function so the rule is
 * explicit and unit-tested; the database only narrows the candidates (trigram, phone, DOB).
 */

export interface DuplicateFacts {
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  dobIsEstimated: boolean;
  phoneE164: string | null;
}

/** Score at or above which registration warns and needs explicit confirmation. */
export const DUPLICATE_THRESHOLD = 0.6;

function dobScore(a: DuplicateFacts, b: DuplicateFacts): number {
  if (a.dateOfBirth === b.dateOfBirth) return 1;
  const years = Math.abs(Number(a.dateOfBirth.slice(0, 4)) - Number(b.dateOfBirth.slice(0, 4)));
  // An estimated age is often a few years off; still a meaningful match, but weaker.
  if ((a.dobIsEstimated || b.dobIsEstimated) && years <= 2) return 0.6;
  // Day and month swapped (03/04 vs 04/03) is a common entry error.
  if (a.dateOfBirth.slice(0, 4) === b.dateOfBirth.slice(0, 4) &&
      a.dateOfBirth.slice(5, 7) === b.dateOfBirth.slice(8, 10) &&
      a.dateOfBirth.slice(8, 10) === b.dateOfBirth.slice(5, 7)) return 0.8;
  return 0;
}

/**
 * 0..1. Name similarity carries most weight; matching date of birth and phone each add.
 * The same phone alone isn't enough (families share phones), nor is the same DOB alone.
 */
export function duplicateScore(a: DuplicateFacts, b: DuplicateFacts): number {
  const name = nameSimilarity(a.fullName, b.fullName);
  const dob = dobScore(a, b);
  const phone = a.phoneE164 !== null && a.phoneE164 === b.phoneE164 ? 1 : 0;
  const score = 0.5 * name + 0.3 * dob + 0.2 * phone;
  return Math.round(Math.min(1, score) * 100) / 100;
}
