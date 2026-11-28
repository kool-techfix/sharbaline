import { t } from "@/lib/i18n";
import type { AllergyList } from "@/server/services/clinical/allergies";
import type { PatientSummary } from "@/server/services/patients/shared";
import { ageLabel, displayName, sexLabel } from "../patients/format";
import { AllergyChips } from "./AllergyChips";

/** Who the patient is, at a glance, with their allergies: the top of every clinical screen. */
export function PatientHeader({ patient, allergies }: { patient: PatientSummary; allergies: AllergyList }) {
  return (
    <header className="space-y-3 rounded-md border border-border bg-surface p-5">
      <h1 id="patient-title" className="text-3xl font-bold">
        {displayName(patient)}
      </h1>
      <p className="flex flex-wrap gap-x-6 gap-y-1 text-lg">
        <span>
          <span className="text-muted">{t("patients.col.number")}: </span>
          <span className="font-mono text-xl font-bold tracking-wide text-heading">{patient.patientNumber}</span>
        </span>
        <span>
          {sexLabel(patient.sex)} · {ageLabel(patient)}
        </span>
      </p>
      <AllergyChips list={allergies} />
    </header>
  );
}
