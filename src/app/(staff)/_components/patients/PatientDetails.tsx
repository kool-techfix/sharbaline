import { t } from "@/lib/i18n";
import { formatHospitalDate } from "@/lib/time";
import type { PatientRecord } from "@/server/services/patients/records";
import { ageLabel, calendarDate, phoneLabel, sexLabel } from "./format";

type FullRecord = Extract<PatientRecord, { view: "full" }>;

/** A patient's demographic details, for roles with the full view (front desk, admin). */
export function PatientDetails({ record }: { record: FullRecord }) {
  const patient = record.summary;
  if (patient.view !== "full") return null;
  const rows: [string, string][] = [
    [
      t("patients.field.dob"),
      patient.ageIsEstimated
        ? t("patients.detail.dobEstimated", { age: ageLabel(patient) })
        : `${calendarDate(patient.dateOfBirth)} (${ageLabel(patient)})`,
    ],
    [t("patients.field.sex"), sexLabel(patient.sex)],
    [t("patients.field.phone"), phoneLabel(patient.phoneE164)],
    [t("patients.field.address"), record.address ?? t("patients.none")],
    [t("patients.field.legacyCardNumber"), patient.legacyCardNumber ?? t("patients.none")],
    [
      t("patients.form.nextOfKin"),
      record.nextOfKin
        ? [record.nextOfKin.name, record.nextOfKin.relationship, record.nextOfKin.phoneE164 ? phoneLabel(record.nextOfKin.phoneE164) : null]
            .filter(Boolean)
            .join(" · ")
        : t("patients.none"),
    ],
    [t("patients.field.paperFolderStatus"), t(`patients.folder.${record.paperFolderStatus}`)],
    [t("patients.detail.priorityFolder"), record.priorityFolder ? t("patients.yes") : t("patients.no")],
    [t("patients.detail.registered"), formatHospitalDate(record.registeredAt)],
  ];

  return (
    <section aria-labelledby="details-title" className="rounded-md border border-border bg-surface p-5">
      <h2 id="details-title" className="mb-4 text-xl font-bold">
        {t("patients.detail.title")}
      </h2>
      <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm font-semibold text-muted">{label}</dt>
            <dd className="text-base text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
