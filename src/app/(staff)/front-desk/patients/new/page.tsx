import Link from "next/link";
import { t } from "@/lib/i18n";
import { requireRole } from "@/server/http/guard";
import { PatientForm } from "../../_components/PatientForm";

export const dynamic = "force-dynamic";

export default async function RegisterPatientPage() {
  await requireRole("front_desk");
  return (
    <section aria-labelledby="register-title" className="space-y-6">
      <Link href="/front-desk" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
        {t("patients.back")}
      </Link>
      <div>
        <h1 id="register-title" className="text-3xl font-bold">
          {t("patients.register.title")}
        </h1>
        <p className="mt-2 text-muted">{t("patients.register.intro")}</p>
      </div>
      <PatientForm mode="register" />
    </section>
  );
}
