/** Whole years between a date of birth (YYYY-MM-DD) and today's date (YYYY-MM-DD, Lagos). */
export function ageInYears(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return Math.max(0, age);
}

/** Estimated date of birth from an age in years: 1 July of the implied year (mid-year). */
export function estimatedDateOfBirth(ageYears: number, today: string): string {
  const year = Number(today.slice(0, 4)) - ageYears;
  return `${String(year).padStart(4, "0")}-07-01`;
}
