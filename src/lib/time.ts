/** Timestamps are stored in UTC and displayed in hospital time (CLAUDE.md rule 14). */
export const HOSPITAL_TIME_ZONE = "Africa/Lagos";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: HOSPITAL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: HOSPITAL_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "09:42" in Lagos time. */
export function formatHospitalTime(date: Date): string {
  return timeFormat.format(date);
}

/** "14 Feb 2025" in Lagos time. */
export function formatHospitalDate(date: Date): string {
  return dateFormat.format(date);
}

/** The Lagos calendar date as YYYY-MM-DD (e.g. for the daily queue). */
export function hospitalDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOSPITAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}
