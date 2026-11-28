import Link from "next/link";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { t, tPlural } from "@/lib/i18n";
import { formatHospitalTime } from "@/lib/time";
import { requestContext } from "@/server/http/context";
import { actorOf, requireRole } from "@/server/http/guard";
import { listQueue } from "@/server/services/queue/queue";
import { ageLabel, calendarDate, displayName, sexLabel } from "../_components/patients/format";
import { QueueStatusChip } from "@/app/(staff)/_components/QueueStatusChip";
import { StartVisit } from "./_components/StartVisit";

export const dynamic = "force-dynamic";

const openLink =
  "inline-flex min-h-11 items-center rounded-md border border-primary bg-surface px-4 font-semibold text-primary hover:bg-primary-soft";

/**
 * Nurse home: today's queue (M3, D-037). A waiting patient is started from here, which opens a
 * visit and moves them to "With nurse". The read is audited by the service.
 */
export default async function NurseHomePage() {
  const session = await requireRole("nurse");
  const outcome = await listQueue(await requestContext(actorOf(session)), {});
  const entries = outcome.ok ? outcome.value.entries : [];
  const waiting = entries.filter((entry) => entry.status === "waiting").length;

  return (
    <section aria-labelledby="welcome" className="space-y-6">
      <div>
        <h1 id="welcome" className="text-3xl font-bold">
          {t("staff.placeholderTitle", { name: session.user.displayName })}
        </h1>
        <p className="mt-2 text-muted">{t("nurse.home.intro")}</p>
      </div>

      <section aria-labelledby="queue-title" className="space-y-4">
        <div>
          <h2 id="queue-title" className="text-2xl font-bold">
            {t("queue.title")}
          </h2>
          <p className="mt-1 text-muted">
            {outcome.ok ? calendarDate(outcome.value.date) : null}
            {entries.length > 0 ? ` · ${tPlural("queue.summary", entries.length, { waiting })}` : null}
          </p>
        </div>

        {!outcome.ok ? <p>{t("errors.unexpected")}</p> : null}
        {outcome.ok && entries.length === 0 ? (
          <p>
            {t("nurse.queue.empty")}{" "}
            <Link href="/nurse/patients" className="font-semibold text-primary underline">
              {t("nurse.queue.emptyLink")}
            </Link>
          </p>
        ) : null}

        {entries.length > 0 ? (
          <Table>
            <TableCaption>{t("queue.title")}</TableCaption>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("queue.col.position")}</TableHeaderCell>
                <TableHeaderCell>{t("patients.col.name")}</TableHeaderCell>
                <TableHeaderCell>{t("patients.col.number")}</TableHeaderCell>
                <TableHeaderCell>{t("queue.col.patient")}</TableHeaderCell>
                <TableHeaderCell>{t("queue.col.added")}</TableHeaderCell>
                <TableHeaderCell>{t("queue.col.status")}</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">{t("queue.col.actions")}</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const name = displayName(entry.patient);
                const href = `/nurse/patients/${entry.patient.id}`;
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="text-lg font-bold">{entry.position}</TableCell>
                    <TableCell>
                      <Link
                        href={href}
                        className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
                      >
                        {name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono">{entry.patient.patientNumber}</TableCell>
                    <TableCell>
                      {sexLabel(entry.patient.sex)} · {ageLabel(entry.patient)}
                    </TableCell>
                    <TableCell>{formatHospitalTime(entry.addedAt)}</TableCell>
                    <TableCell>
                      <QueueStatusChip status={entry.status} />
                    </TableCell>
                    <TableCell>
                      {entry.status === "waiting" ? (
                        <StartVisit patientId={entry.patient.id} name={name} />
                      ) : entry.status === "with_nurse" ? (
                        <Link href={href} className={openLink} aria-label={t("nurse.queue.continueFor", { name })}>
                          {t("nurse.queue.continue")}
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </section>
    </section>
  );
}
