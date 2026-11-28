import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/lib/i18n";
import { UUID_PATTERN } from "@/lib/ids";
import { formatHospitalDate, formatHospitalTime } from "@/lib/time";
import { requestContext } from "@/server/http/context";
import { actorOf, requireRole } from "@/server/http/guard";
import { getClinicalSummary, getVisit } from "@/server/services/clinical/record";
import { vitalsLine } from "../../../_components/clinical/format";
import { PatientHeader } from "../../../_components/clinical/PatientHeader";
import { VitalsTable } from "../../../_components/clinical/VitalsTable";
import { QueueStatusChip } from "../../../_components/QueueStatusChip";
import { ChangeAllergy } from "../../_components/ChangeAllergy";
import { CorrectVitals } from "../../_components/CorrectVitals";
import { RecordAllergy, RecordNoKnownAllergies } from "../../_components/RecordAllergy";
import { RecordVitals } from "../../_components/RecordVitals";
import { SendToDoctor } from "../../_components/SendToDoctor";
import { StartVisit } from "../../_components/StartVisit";

export const dynamic = "force-dynamic";

const correctLink =
  "inline-flex min-h-11 items-center rounded-md px-3 font-semibold text-primary underline underline-offset-4 hover:bg-primary-soft";

/**
 * The nurse's view of one patient (M3, D-037): today's visit with vitals and their corrections,
 * allergies, and earlier visits. Both reads are audited by their services (rule 7). The only
 * thing in the URL besides the patient is an opaque vitals id while correcting it (rule 2).
 */
export default async function NursePatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ correct?: string; corrected?: string }>;
}) {
  const session = await requireRole("nurse");
  const { patientId } = await params;
  const { correct, corrected } = await searchParams;
  if (!UUID_PATTERN.test(patientId)) notFound();

  const ctx = await requestContext(actorOf(session));
  const summary = await getClinicalSummary(ctx, { patientId });
  if (!summary.ok) notFound();
  const { patient, allergies, visits } = summary.value;

  const open = visits.find((visit) => visit.status === "open") ?? null;
  const detail = open ? await getVisit(ctx, { patientId, visitId: open.id }) : null;
  const visit = detail?.ok ? detail.value : null;
  const correcting =
    visit && correct && UUID_PATTERN.test(correct)
      ? (visit.vitals.find((row) => row.id === correct && row.supersededById === null) ?? null)
      : null;
  const earlier = visits.filter((v) => v.status === "closed");
  const pageHref = `/nurse/patients/${patientId}`;
  const hasActiveAllergy = allergies.allergies.some((allergy) => allergy.status === "active");

  return (
    <section aria-labelledby="patient-title" className="space-y-6">
      <Link href="/nurse" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
        {t("nurse.back")}
      </Link>

      {corrected === "replaced" || corrected === "struck" ? (
        <p role="status" className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-info-text">
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />
          {corrected === "struck" ? t("clinical.vitals.correct.struckOut") : t("clinical.vitals.correct.saved")}
        </p>
      ) : null}

      <PatientHeader patient={patient} allergies={allergies} />

      <section aria-labelledby="visit-title" className="space-y-5 rounded-md border border-border bg-surface p-5">
        <h2 id="visit-title" className="text-2xl font-bold">
          {t("nurse.visit.title")}
        </h2>
        {!open ? (
          <>
            <p className="text-muted">{t("nurse.visit.none")}</p>
            <StartVisit patientId={patientId} chooseType />
          </>
        ) : !visit ? (
          <p>{t("errors.unexpected")}</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{t(`clinical.visitType.${visit.visitType}`)}</span>
              <span>{t("nurse.visit.openedAt", { time: formatHospitalTime(visit.openedAt) })}</span>
              {visit.attendingDoctor ? <span>{t("nurse.visit.doctor", { name: visit.attendingDoctor })}</span> : null}
              {visit.queueStatus ? <QueueStatusChip status={visit.queueStatus} /> : null}
            </p>

            <section aria-labelledby="vitals-title" className="space-y-5">
              <h3 id="vitals-title" className="text-xl font-bold">
                {t("clinical.vitals.title")}
              </h3>
              <VitalsTable
                rows={visit.vitals}
                caption={t("clinical.vitals.caption")}
                action={(row) => (
                  <Link
                    href={`${pageHref}?correct=${row.id}`}
                    scroll={false}
                    className={correctLink}
                    aria-label={t("clinical.vitals.correct.forTime", { time: formatHospitalTime(row.recordedAt) })}
                  >
                    {t("clinical.vitals.correct.link")}
                  </Link>
                )}
              />
              {correcting ? (
                <CorrectVitals
                  key={correcting.id}
                  patientId={patientId}
                  original={correcting}
                  closeHref={pageHref}
                  recordedAt={formatHospitalTime(correcting.recordedAt)}
                />
              ) : (
                <RecordVitals visitId={visit.id} patientId={patientId} />
              )}
            </section>

            <section aria-labelledby="handover-title" className="space-y-3 border-t border-border pt-5">
              <h3 id="handover-title" className="text-xl font-bold">
                {t("nurse.visit.handover")}
              </h3>
              <SendToDoctor
                visitId={visit.id}
                patientId={patientId}
                state={
                  visit.queueStatus === "waiting" || visit.queueStatus === "with_nurse"
                    ? "ready"
                    : visit.queueStatus === null
                      ? "notQueued"
                      : "sent"
                }
              />
            </section>
          </>
        )}
      </section>

      <section aria-labelledby="allergies-title" className="space-y-4 rounded-md border border-border bg-surface p-5">
        <h2 id="allergies-title" className="text-2xl font-bold">
          {t("clinical.allergies.title")}
        </h2>
        {allergies.allergies.length === 0 ? (
          <p className="text-muted">
            {allergies.noKnownAllergies ? t("clinical.allergies.noneKnown") : t("clinical.allergies.notRecordedHint")}
          </p>
        ) : (
          <ul className="space-y-3">
            {allergies.allergies.map((allergy) => (
              <li key={allergy.id} className="space-y-2 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg font-bold">{allergy.allergen}</span>
                  <StatusChip tone={allergy.status === "active" ? "danger" : "neutral"}>
                    {t(`clinical.allergies.status.${allergy.status}`)}
                  </StatusChip>
                  {allergy.severity ? (
                    <span>
                      {t("clinical.allergies.severity")}: {t(`clinical.allergies.severity.${allergy.severity}`)}
                    </span>
                  ) : null}
                </div>
                <p>
                  <span className="text-muted">{t("clinical.allergies.reaction")}: </span>
                  {allergy.reaction ?? t("patients.none")}
                </p>
                <p className="text-sm text-muted">
                  {t("clinical.allergies.recordedOn", { date: formatHospitalDate(allergy.recordedAt) })}
                </p>
                <ChangeAllergy
                  patientId={patientId}
                  allergyId={allergy.id}
                  allergen={allergy.allergen}
                  status={allergy.status}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-start gap-3">
          <RecordAllergy patientId={patientId} />
          {!hasActiveAllergy && !allergies.noKnownAllergies ? <RecordNoKnownAllergies patientId={patientId} /> : null}
        </div>
      </section>

      <section aria-labelledby="history-title" className="space-y-4 rounded-md border border-border bg-surface p-5">
        <h2 id="history-title" className="text-2xl font-bold">
          {t("clinical.history.title")}
        </h2>
        {earlier.length === 0 ? (
          <p className="text-muted">{t("clinical.history.none")}</p>
        ) : (
          <Table>
            <TableCaption>{t("clinical.history.title")}</TableCaption>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("clinical.history.col.date")}</TableHeaderCell>
                <TableHeaderCell>{t("clinical.history.col.type")}</TableHeaderCell>
                <TableHeaderCell>{t("clinical.history.col.doctor")}</TableHeaderCell>
                <TableHeaderCell>{t("clinical.history.col.diagnosis")}</TableHeaderCell>
                <TableHeaderCell>{t("clinical.history.col.vitals")}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {earlier.map((past) => (
                <TableRow key={past.id}>
                  <TableCell>{formatHospitalDate(past.openedAt)}</TableCell>
                  <TableCell>{t(`clinical.visitType.${past.visitType}`)}</TableCell>
                  <TableCell>{past.attendingDoctor ?? t("patients.none")}</TableCell>
                  <TableCell>{past.latestNote?.diagnosisText ?? t("patients.none")}</TableCell>
                  <TableCell>{past.vitals[0] ? vitalsLine(past.vitals[0]) : t("patients.none")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {summary.value.truncated ? <p className="text-muted">{t("clinical.history.truncated")}</p> : null}
      </section>
    </section>
  );
}
