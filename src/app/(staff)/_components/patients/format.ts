import { formatNigerianPhone } from "@/lib/domain/phone";
import { t, tPlural } from "@/lib/i18n";
import type { PatientSummary } from "@/server/services/patients/shared";

/** How a patient's name is shown at the front desk: surname first, as on hospital folders. */
export function displayName(patient: Pick<PatientSummary, "surname" | "firstName" | "otherNames">): string {
  return [`${patient.surname},`, patient.firstName, patient.otherNames].filter(Boolean).join(" ");
}

/** "34 years", or "about 34 years" when only an age was given at registration. */
export function ageLabel(patient: Pick<PatientSummary, "age" | "ageIsEstimated">): string {
  const years = tPlural("patients.age", patient.age);
  return patient.ageIsEstimated ? t("patients.ageEstimated", { age: years }) : years;
}

export function sexLabel(sex: "female" | "male"): string {
  return t(`patients.sex.${sex}`);
}

export function phoneLabel(e164: string | null): string {
  return e164 ? formatNigerianPhone(e164) : t("patients.none");
}

/** "2025-06-12" → "12 Jun 2025", without a time-zone shift (it's a calendar date). */
export function calendarDate(key: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${key}T00:00:00Z`),
  );
}
