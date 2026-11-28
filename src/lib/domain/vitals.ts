/*
 * Vitals measurements and their plausible ranges (D-037, pending clinical sign-off). The same
 * numbers are the SQL CHECKs in the consultation migration; the server schema and the nurse's
 * form both read them from here, so a typo is caught in the form before the round trip.
 */

export const VITALS_FIELDS = [
  "temperatureC",
  "pulseBpm",
  "respRate",
  "bpSystolic",
  "bpDiastolic",
  "spo2Pct",
  "weightKg",
  "heightCm",
] as const;

export type VitalsField = (typeof VITALS_FIELDS)[number];

export interface VitalsRange {
  min: number;
  max: number;
  /** Whole numbers, or one decimal place. */
  step: "int" | "tenth";
}

export const VITALS_RANGES: Record<VitalsField, VitalsRange> = {
  temperatureC: { min: 30, max: 45, step: "tenth" },
  pulseBpm: { min: 20, max: 250, step: "int" },
  respRate: { min: 4, max: 80, step: "int" },
  bpSystolic: { min: 50, max: 260, step: "int" },
  bpDiastolic: { min: 20, max: 160, step: "int" },
  spo2Pct: { min: 50, max: 100, step: "int" },
  weightKg: { min: 0.3, max: 400, step: "tenth" },
  heightCm: { min: 20, max: 250, step: "tenth" },
};

export type MeasurementProblem = "notNumber" | "range" | "decimals";

/** Parse one typed measurement. Empty means "not measured". */
export function parseMeasurement(
  field: VitalsField,
  raw: string,
): { ok: true; value: number | null } | { ok: false; problem: MeasurementProblem } {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, problem: "notNumber" };
  const value = Number(text);
  const range = VITALS_RANGES[field];
  const decimals = text.includes(".") ? text.split(".")[1]!.replace(/0+$/, "").length : 0;
  if (range.step === "int" ? decimals > 0 : decimals > 1) return { ok: false, problem: "decimals" };
  if (value < range.min || value > range.max) return { ok: false, problem: "range" };
  return { ok: true, value };
}
