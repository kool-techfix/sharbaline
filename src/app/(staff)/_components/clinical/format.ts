import { t } from "@/lib/i18n";
import type { VitalsView } from "@/server/services/clinical/record";

/** The measurements of a vitals row as display columns; "—" for anything not measured. */
export function vitalsCells(v: VitalsView): Record<"temperature" | "pulse" | "resp" | "bp" | "spo2" | "weight" | "height", string> {
  const show = (value: number | null, unit: string) => (value === null ? "—" : `${value} ${unit}`);
  return {
    temperature: show(v.temperatureC, "°C"),
    pulse: show(v.pulseBpm, t("clinical.vitals.unit.perMin")),
    resp: show(v.respRate, t("clinical.vitals.unit.perMin")),
    bp: v.bpSystolic === null || v.bpDiastolic === null ? "—" : `${v.bpSystolic}/${v.bpDiastolic} mmHg`,
    spo2: show(v.spo2Pct, "%"),
    weight: show(v.weightKg, "kg"),
    height: show(v.heightCm, "cm"),
  };
}

/** A one-line summary for timelines: only what was measured. */
export function vitalsLine(v: VitalsView): string {
  const cells = vitalsCells(v);
  const parts: [string, string][] = [
    [t("clinical.vitals.short.temperature"), cells.temperature],
    [t("clinical.vitals.short.pulse"), cells.pulse],
    [t("clinical.vitals.short.resp"), cells.resp],
    [t("clinical.vitals.short.bp"), cells.bp],
    [t("clinical.vitals.short.spo2"), cells.spo2],
    [t("clinical.vitals.short.weight"), cells.weight],
    [t("clinical.vitals.short.height"), cells.height],
  ];
  return parts
    .filter(([, value]) => value !== "—")
    .map(([label, value]) => `${label} ${value}`)
    .join(" · ");
}

/** Vitals rows as the nurse and doctor see them, with each row's correction state worked out. */
export interface VitalsDisplayRow {
  row: VitalsView;
  /** Replaced by a later row: shown struck through, with the reason given for replacing it. */
  enteredInError: { reason: string } | null;
  /** This row is a correction of an earlier one, with the reason. */
  corrects: { reason: string } | null;
  /** Can still be corrected: nothing has replaced it. */
  current: boolean;
}

/**
 * Pair every row with its correction. A correction with no measurements only strikes the
 * original out, so it isn't shown as a row of its own.
 */
export function vitalsDisplayRows(rows: VitalsView[]): VitalsDisplayRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const measured = (v: VitalsView) =>
    [v.temperatureC, v.pulseBpm, v.respRate, v.bpSystolic, v.spo2Pct, v.weightKg, v.heightCm].some((x) => x !== null);
  return rows
    .filter((row) => row.correction === null || measured(row))
    .map((row) => {
      const replacement = row.supersededById ? byId.get(row.supersededById) : undefined;
      return {
        row,
        enteredInError: row.supersededById ? { reason: replacement?.correction?.reason ?? "" } : null,
        corrects: row.correction ? { reason: row.correction.reason } : null,
        current: row.supersededById === null,
      };
    });
}
