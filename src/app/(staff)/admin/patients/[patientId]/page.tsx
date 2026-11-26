import Link from "next/link";
import { notFound } from "next/navigation";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { t } from "@/lib/i18n";
import { UUID_PATTERN } from "@/lib/ids";
import { formatHospitalTime } from "@/lib/time";
import { requestContext } from "@/server/http/context";
import { actorOf, requireRole } from "@/server/http/guard";
import { breakGlassStatus } from "@/server/services/break-glass/break-glass";
import { getPatient } from "@/server/services/patients/records";
import { displayName } from "../../../_components/patients/format";
import { PatientDetails } from "../../../_components/patients/PatientDetails";
import { BreakGlassForm } from "../_components/BreakGlassForm";
import { EndAccess } from "../_components/EndAccess";

export const dynamic = "force-dynamic";

/**
 * A patient's record for an admin: demographics (which admins may read, audited) and the
 * clinical record, which opens only through break-glass (scope §4.1, D-035).
 */
export default async function AdminPatientPage({ params }: { params: Promise<{ patientId: string }> }) {
  const session = await requireRole("admin");
  const { patientId } = await params;
  if (!UUID_PATTERN.test(patientId)) notFound();

  const ctx = await requestContext(actorOf(session));
  const outcome = await getPatient(ctx, { patientId });
  if (!outcome.ok) notFound();
  const record = outcome.value;
  if (record.view !== "full" || record.summary.view !== "full") notFound();
  const patient = record.summary;
  const status = await breakGlassStatus(ctx, { patientId });
  const live = status.ok ? status.value : null;

  return (
    <section aria-labelledby="patient-title" className="space-y-6">
      <Link href="/admin/patients" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
        {t("patients.back")}
      </Link>

      <div className="space-y-2">
        <h1 id="patient-title" className="text-3xl font-bold">
          {displayName(patient)}
        </h1>
        <p className="text-lg">
          <span className="text-muted">{t("patients.col.number")}: </span>
          <span className="font-mono text-2xl font-bold tracking-wide text-heading">{patient.patientNumber}</span>
        </p>
      </div>

      <section aria-labelledby="clinical-title" className="space-y-4 rounded-md border border-border bg-surface p-5">
        <h2 id="clinical-title" className="flex items-center gap-2 text-xl font-bold">
          {live ? (
            <ShieldAlert aria-hidden="true" className="size-6 text-warning-text" />
          ) : (
            <LockKeyhole aria-hidden="true" className="size-6 text-muted" />
          )}
          {t("breakGlass.clinical.title")}
        </h2>
        {live ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-text bg-warning-bg p-4 text-warning-text">
              <p role="status" className="font-semibold">
                {t("breakGlass.active", { time: formatHospitalTime(live.expiresAt) })}
              </p>
              <EndAccess eventId={live.eventId} />
            </div>
            <p className="text-muted">{t("breakGlass.clinical.empty")}</p>
          </>
        ) : (
          <>
            <p className="max-w-3xl">{t("breakGlass.clinical.locked")}</p>
            <BreakGlassForm patientId={patient.id} />
          </>
        )}
      </section>

      <PatientDetails record={record} />
    </section>
  );
}
