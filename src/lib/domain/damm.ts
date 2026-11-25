/**
 * Damm check digit (D-003). Decimal only; catches every single-digit error and every
 * adjacent transposition, which Luhn does not. Table: the standard totally anti-symmetric
 * quasigroup of order 10 (Damm, 2004).
 */
const TABLE: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

function interim(digits: string): number {
  let state = 0;
  for (const char of digits) {
    const digit = char.charCodeAt(0) - 48;
    if (digit < 0 || digit > 9) throw new Error("Damm: digits only");
    state = TABLE[state]![digit]!;
  }
  return state;
}

/** The check digit to append to `digits`. */
export function dammCheckDigit(digits: string): number {
  return interim(digits);
}

/** Whether `digitsWithCheck` (check digit last) is valid. */
export function dammIsValid(digitsWithCheck: string): boolean {
  return /^\d{2,}$/.test(digitsWithCheck) && interim(digitsWithCheck) === 0;
}
