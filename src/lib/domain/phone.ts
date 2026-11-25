/**
 * Nigerian phone numbers to E.164 (+234…), so "0803 456 2187", "+234 803 456 2187" and
 * "2348034562187" are the same number for search and duplicate checks. Returns null when the
 * input isn't a plausible Nigerian mobile or landline number. Other countries: Phase 2.
 */
export function normalizeNigerianPhone(raw: string): string | null {
  const digits = raw.normalize("NFKC").replace(/[\s().-]/g, "");
  let national: string;
  if (/^\+234\d+$/.test(digits)) national = digits.slice(4);
  else if (/^234\d+$/.test(digits)) national = digits.slice(3);
  else if (/^0\d+$/.test(digits)) national = digits.slice(1);
  else return null;
  // Mobile: 10 digits starting 7, 8 or 9 (e.g. 803…). Landline: 8–9 digits (area code + number).
  if (/^[789]\d{9}$/.test(national) || /^[1-6]\d{7,8}$/.test(national)) return `+234${national}`;
  return null;
}

/** Local display form: +2348034562187 → 0803 456 2187. */
export function formatNigerianPhone(e164: string): string {
  if (!e164.startsWith("+234")) return e164;
  const national = `0${e164.slice(4)}`;
  return national.length === 11 ? `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}` : national;
}
