import { t } from "@/lib/i18n";
import { requireRole } from "@/server/http/guard";
import { PatientSearch } from "../../_components/patients/PatientSearch";
import { search } from "../actions";

export const dynamic = "force-dynamic";

/** Nurses find patients who aren't in today's queue, e.g. an emergency brought straight in. */
export default async function NursePatientsPage() {
  await requireRole("nurse");
  return (
    <section aria-labelledby="patients-title" className="space-y-6">
      <div>
        <h1 id="patients-title" className="text-3xl font-bold">
          {t("patients.search.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-muted">{t("nurse.patients.intro")}</p>
      </div>
      <PatientSearch search={search} recordPath="/nurse/patients" />
    </section>
  );
}
