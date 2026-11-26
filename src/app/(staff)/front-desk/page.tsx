import Link from "next/link";
import { UserPlus } from "lucide-react";
import { t } from "@/lib/i18n";
import { requireRole } from "@/server/http/guard";
import { PatientSearch } from "../_components/patients/PatientSearch";
import { search } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Front desk home: find a patient or register one. No "recent patients" list: it would show
 * patients' details before anyone has searched for them (D-032 design deviations).
 */
export default async function FrontDeskPage() {
  await requireRole("front_desk");
  return (
    <section aria-labelledby="patients-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="patients-title" className="text-3xl font-bold">
            {t("patients.search.title")}
          </h1>
          <p className="mt-2 text-muted">{t("patients.search.intro")}</p>
        </div>
        <Link
          href="/front-desk/patients/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover"
        >
          <UserPlus aria-hidden="true" className="size-5" />
          {t("patients.register.link")}
        </Link>
      </div>
      <PatientSearch search={search} recordPath="/front-desk/patients" registerHref="/front-desk/patients/new" />
    </section>
  );
}
