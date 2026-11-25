import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Pencil } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import { t } from "@/lib/i18n";
import { UUID_PATTERN } from "@/lib/ids";
import { formatHospitalDate } from "@/lib/time";
import { requestContext } from "@/server/http/context";
import { actorOf, requireRole } from "@/server/http/guard";
import { getPatient } from "@/server/services/patients/records";
import { AddToQueue } from "../../_components/AddToQueue";
import { ageLabel, calendarDate, displayName, phoneLabel, sexLabel } from "../../_components/format";
import { QueueStatusChip } from "../../_components/QueueStatusChip";

export const dynamic = "force-dynamic";

/** One patient's record for the front desk. The read is audited by the service (rule 7). */
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ registered?: string; saved?: string }>;
}) {
  const session = await requireRole("front_desk");
  const { patientId } = await params;
  const { registered, saved } = await searchParams;
  if (!UUID_PATTERN.test(patientId)) notFound();

  const outcome = await getPatient(await requestContext(actorOf(session)), { patientId });
  if (!outcome.ok) notFound();
  const record = outcome.value;
  // The front desk always gets the full view; anything else here would be a server bug.
  if (record.view !== "full" || record.summary.view !== "full") notFound();
  const patient = record.summary;

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
    <section aria-labelledby="patient-title" className="space-y-6">
      <Link href="/front-desk" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
        {t("patients.back")}
      </Link>

      {registered === "1" ? (
        <div role="status" className="flex items-start gap-3 rounded-md border border-success-text bg-success-bg p-4 text-success-text">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
          <div>
            <p className="text-lg font-bold">{t("patients.registered.title")}</p>
            <p>{t("patients.registered.body", { number: patient.patientNumber })}</p>
          </div>
        </div>
      ) : null}
      {saved === "1" || saved === "0" ? (
        <p role="status" className="flex items-center gap-2 rounded-md bg-info-bg px-3 py-2 text-info-text">
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />
          {saved === "1" ? t("patients.edit.saved") : t("patients.edit.unchanged")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 id="patient-title" className="text-3xl font-bold">
            {displayName(patient)}
          </h1>
          <p className="text-lg">
            <span className="text-muted">{t("patients.col.number")}: </span>
            <span className="font-mono text-2xl font-bold tracking-wide text-heading">{patient.patientNumber}</span>
          </p>
        </div>
        <Link
          href={`/front-desk/patients/${patient.id}/edit`}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-primary bg-surface px-4 font-semibold text-primary hover:bg-primary-soft"
        >
          <Pencil aria-hidden="true" className="size-5" />
          {t("patients.edit.link")}
        </Link>
      </div>

      <section aria-labelledby="queue-today" className="space-y-3 rounded-md border border-border bg-surface p-5">
        <h2 id="queue-today" className="text-xl font-bold">
          {t("queue.today")}
        </h2>
        {record.queueToday ? (
          <p role="status" className="flex flex-wrap items-center gap-3">
            <span>{t("queue.inQueue", { position: record.queueToday.position })}</span>
            <QueueStatusChip status={record.queueToday.status} />
          </p>
        ) : (
          <>
            <p className="text-muted">{t("queue.notInQueue")}</p>
            <AddToQueue patientId={patient.id} />
          </>
        )}
      </section>

      {record.possibleDuplicateOf ? (
        <p className="flex flex-wrap items-center gap-2">
          <StatusChip tone="warning">{t("patients.detail.checkedMatch")}</StatusChip>
          <Link
            href={`/front-desk/patients/${record.possibleDuplicateOf.id}`}
            className="inline-flex min-h-11 items-center font-semibold text-primary underline"
          >
            {t("patients.detail.checkedMatchLink", { number: record.possibleDuplicateOf.patientNumber })}
          </Link>
        </p>
      ) : null}

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
    </section>
  );
}
