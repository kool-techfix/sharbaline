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
import { calendarDate, ageLabel, displayName, sexLabel } from "@/app/(staff)/_components/patients/format";
import { MarkLeft } from "../_components/MarkLeft";
import { QueueStatusChip } from "@/app/(staff)/_components/QueueStatusChip";

export const dynamic = "force-dynamic";

/** Today's queue (Lagos calendar day), in arrival order. The read is audited by the service. */
export default async function QueuePage() {
  const session = await requireRole("front_desk");
  const outcome = await listQueue(await requestContext(actorOf(session)), {});
  const entries = outcome.ok ? outcome.value.entries : [];
  const waiting = entries.filter((entry) => entry.status === "waiting").length;

  return (
    <section aria-labelledby="queue-title" className="space-y-6">
      <div>
        <h1 id="queue-title" className="text-3xl font-bold">
          {t("queue.title")}
        </h1>
        <p className="mt-2 text-muted">
          {outcome.ok ? calendarDate(outcome.value.date) : null}
          {entries.length > 0 ? ` · ${tPlural("queue.summary", entries.length, { waiting })}` : null}
        </p>
      </div>

      {!outcome.ok ? <p>{t("errors.unexpected")}</p> : null}
      {outcome.ok && entries.length === 0 ? (
        <p>
          {t("queue.empty")}{" "}
          <Link href="/front-desk" className="font-semibold text-primary underline">
            {t("queue.emptyLink")}
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
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-lg font-bold">{entry.position}</TableCell>
                <TableCell>
                  <Link
                    href={`/front-desk/patients/${entry.patient.id}`}
                    className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
                  >
                    {displayName(entry.patient)}
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
                  {entry.status === "waiting" ? <MarkLeft entryId={entry.id} name={displayName(entry.patient)} /> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}
