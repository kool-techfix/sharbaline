import { AlertTriangle, CircleHelp, ShieldCheck } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import { t } from "@/lib/i18n";
import type { AllergyList } from "@/server/services/clinical/allergies";

/**
 * Active allergies as prominent chips (icon and text, never colour alone). "No known allergies"
 * shows only when someone recorded it; an empty list says the allergies aren't recorded yet.
 */
export function AllergyChips({ list }: { list: AllergyList }) {
  const active = list.allergies.filter((allergy) => allergy.status === "active");
  return (
    <ul aria-label={t("clinical.allergies.chipsLabel")} className="flex flex-wrap gap-2">
      {active.map((allergy) => (
        <li key={allergy.id}>
          <StatusChip tone="danger" icon={AlertTriangle} className="text-base">
            {allergy.severity && allergy.severity !== "unknown"
              ? t("clinical.allergies.chipSeverity", {
                  allergen: allergy.allergen,
                  severity: t(`clinical.allergies.severity.${allergy.severity}`),
                })
              : t("clinical.allergies.chip", { allergen: allergy.allergen })}
          </StatusChip>
        </li>
      ))}
      {active.length === 0 && list.noKnownAllergies ? (
        <li>
          <StatusChip tone="success" icon={ShieldCheck} className="text-base">
            {t("clinical.allergies.noneKnown")}
          </StatusChip>
        </li>
      ) : null}
      {active.length === 0 && !list.noKnownAllergies ? (
        <li>
          <StatusChip tone="warning" icon={CircleHelp} className="text-base">
            {t("clinical.allergies.notRecorded")}
          </StatusChip>
        </li>
      ) : null}
    </ul>
  );
}
