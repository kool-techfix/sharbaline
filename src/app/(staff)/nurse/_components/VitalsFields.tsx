"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseMeasurement, VITALS_RANGES, type VitalsField } from "@/lib/domain/vitals";
import { t, type MessageKey } from "@/lib/i18n";
import type { Measurements } from "@/server/services/clinical/vitals";
import { FieldError } from "../../_components/RadioCards";

export type VitalsValues = Record<VitalsField | "note", string>;
export type VitalsErrors = Partial<Record<VitalsField | "form", string>>;

export const EMPTY_VITALS: VitalsValues = {
  temperatureC: "",
  pulseBpm: "",
  respRate: "",
  bpSystolic: "",
  bpDiastolic: "",
  spo2Pct: "",
  weightKg: "",
  heightCm: "",
  note: "",
};

const LABEL: Record<VitalsField, MessageKey> = {
  temperatureC: "clinical.vitals.field.temperatureC",
  pulseBpm: "clinical.vitals.field.pulseBpm",
  respRate: "clinical.vitals.field.respRate",
  bpSystolic: "clinical.vitals.field.bpSystolic",
  bpDiastolic: "clinical.vitals.field.bpDiastolic",
  spo2Pct: "clinical.vitals.field.spo2Pct",
  weightKg: "clinical.vitals.field.weightKg",
  heightCm: "clinical.vitals.field.heightCm",
};

/**
 * Check the typed values with the same ranges as the server (D-037). Returns the measurements
 * to send, or the problems to show next to each box.
 */
export function readVitals(values: VitalsValues): { measurements: Measurements | null; errors: VitalsErrors } {
  const errors: VitalsErrors = {};
  const parsed = {} as Record<VitalsField, number | null>;
  for (const field of Object.keys(LABEL) as VitalsField[]) {
    const result = parseMeasurement(field, values[field]);
    if (result.ok) {
      parsed[field] = result.value;
      continue;
    }
    parsed[field] = null;
    const { min, max, step } = VITALS_RANGES[field];
    errors[field] =
      result.problem === "range"
        ? t("clinical.vitals.error.range", { min, max })
        : result.problem === "decimals"
          ? t(step === "int" ? "clinical.vitals.error.whole" : "clinical.vitals.error.oneDecimal")
          : t("clinical.vitals.error.notNumber");
  }
  if (!errors.bpSystolic && !errors.bpDiastolic) {
    const upper = parsed.bpSystolic;
    const lower = parsed.bpDiastolic;
    if ((upper === null) !== (lower === null)) errors.bpDiastolic = t("clinical.vitals.error.bpBoth");
    else if (upper !== null && lower !== null && lower >= upper) errors.bpDiastolic = t("clinical.vitals.error.bpOrder");
  }
  const anyMeasured = Object.values(parsed).some((value) => value !== null);
  if (Object.keys(errors).length === 0 && !anyMeasured) errors.form = t("clinical.vitals.error.none");
  if (Object.keys(errors).length > 0) return { measurements: null, errors };
  const note = values.note.trim();
  return { measurements: { ...parsed, note: note ? note : null }, errors };
}

/** Values of an existing entry, to start a correction from. */
export function valuesFrom(row: Partial<Record<VitalsField, number | null>> & { note: string | null }): VitalsValues {
  const text = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
  return {
    temperatureC: text(row.temperatureC),
    pulseBpm: text(row.pulseBpm),
    respRate: text(row.respRate),
    bpSystolic: text(row.bpSystolic),
    bpDiastolic: text(row.bpDiastolic),
    spo2Pct: text(row.spo2Pct),
    weightKg: text(row.weightKg),
    heightCm: text(row.heightCm),
    note: row.note ?? "",
  };
}

/** The measurement boxes. Every box is optional; units are in the labels. */
export function VitalsFields({
  idPrefix,
  values,
  errors,
  onChange,
}: {
  idPrefix: string;
  values: VitalsValues;
  errors: VitalsErrors;
  onChange: (values: VitalsValues) => void;
}) {
  const box = (field: VitalsField) => {
    const id = `${idPrefix}-${field}`;
    const error = errors[field];
    return (
      <div key={field} className="space-y-2">
        <Label htmlFor={id}>{t(LABEL[field])}</Label>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          maxLength={6}
          value={values[field]}
          onChange={(event) => onChange({ ...values, [field]: event.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <FieldError id={`${id}-error`} message={error} />
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {box("temperatureC")}
        {box("pulseBpm")}
        {box("respRate")}
        {box("spo2Pct")}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-base font-semibold text-heading">{t("clinical.vitals.bpLegend")}</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {box("bpSystolic")}
          {box("bpDiastolic")}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {box("weightKg")}
        {box("heightCm")}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-note`}>
          {t("clinical.vitals.field.note")} <span className="font-normal text-muted">{t("patients.optional")}</span>
        </Label>
        <Textarea
          id={`${idPrefix}-note`}
          maxLength={500}
          className="min-h-20"
          value={values.note}
          onChange={(event) => onChange({ ...values, note: event.target.value })}
        />
      </div>
    </div>
  );
}

/** The first box with a problem, to move focus to after a failed check. */
export function firstInvalid(idPrefix: string, errors: VitalsErrors): HTMLElement | null {
  const order: VitalsField[] = ["temperatureC", "pulseBpm", "respRate", "spo2Pct", "bpSystolic", "bpDiastolic", "weightKg", "heightCm"];
  const field = order.find((key) => errors[key]);
  return field ? document.getElementById(`${idPrefix}-${field}`) : document.getElementById(`${idPrefix}-temperatureC`);
}
