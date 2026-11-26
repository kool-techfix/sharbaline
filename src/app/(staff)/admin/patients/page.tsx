import { t } from "@/lib/i18n";
import { requireRole } from "@/server/http/guard";
import { PatientSearch } from "../../_components/patients/PatientSearch";
import { search } from "./actions";

export const dynamic = "force-dynamic";

/** Admins find patients here; opening their clinical record needs break-glass (D-035). */
export default async function AdminPatientsPage() {
  await requireRole("admin");
  return (
    <section aria-labelledby="patients-title" className="space-y-6">
      <div>
        <h1 id="patients-title" className="text-3xl font-bold">
          {t("patients.search.title")}
        </h1>
        <p className="mt-2 max-w-3xl text-muted">{t("admin.patients.intro")}</p>
      </div>
      <PatientSearch search={search} recordPath="/admin/patients" />
    </section>
  );
}
