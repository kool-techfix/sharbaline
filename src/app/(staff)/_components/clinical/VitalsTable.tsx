import type { ReactNode } from "react";
import { History, XCircle } from "lucide-react";
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
import { formatHospitalTime } from "@/lib/time";
import type { VitalsView } from "@/server/services/clinical/record";
import { cn } from "@/lib/utils";
import { vitalsCells, vitalsDisplayRows } from "./format";

/**
 * Every vitals entry on a visit, newest first. A wrong entry stays visible, struck through and
 * labelled "Entered in error" with the reason (D-007): nothing in the record is hidden.
 */
export function VitalsTable({
  rows,
  caption,
  action,
}: {
  rows: VitalsView[];
  caption: string;
  /** Rendered beside each entry that can still be corrected (nurses only). */
  action?: (row: VitalsView) => ReactNode;
}) {
  const display = vitalsDisplayRows(rows);
  if (display.length === 0) return <p className="text-muted">{t("clinical.vitals.none")}</p>;

  return (
    <Table>
      <TableCaption>{caption}</TableCaption>
      <TableHead>
        <TableRow>
          <TableHeaderCell>{t("clinical.vitals.col.time")}</TableHeaderCell>
          <TableHeaderCell>{t("clinical.vitals.short.temperature")}</TableHeaderCell>
          <TableHeaderCell>{t("clinical.vitals.short.pulse")}</TableHeaderCell>
          <TableHeaderCell>{t("clinical.vitals.short.resp")}</TableHeaderCell>
          <TableHeaderCell>{t("clinical.vitals.short.bp")}</TableHeaderCell>
          <TableHeaderCell>{t("clinical.vitals.short.spo2")}</TableHeaderCell>
          <TableHeaderCell>{t("clinical.vitals.short.weight")}</TableHeaderCell>
          <TableHeaderCell>{t("clinical.vitals.short.height")}</TableHeaderCell>
          {action ? (
            <TableHeaderCell>
              <span className="sr-only">{t("queue.col.actions")}</span>
            </TableHeaderCell>
          ) : null}
        </TableRow>
      </TableHead>
      <TableBody>
        {display.map(({ row, enteredInError, corrects, current }) => {
          const cells = vitalsCells(row);
          const struck = enteredInError ? "line-through text-muted" : undefined;
          return (
            <TableRow key={row.id}>
              <TableCell className="align-top">
                <div className="space-y-1">
                  <p className="font-semibold">{formatHospitalTime(row.recordedAt)}</p>
                  <p className="text-sm text-muted">{row.recordedBy ?? t("clinical.unknownStaff")}</p>
                  {enteredInError ? (
                    <>
                      <StatusChip tone="neutral" icon={XCircle}>
                        {t("clinical.vitals.enteredInError")}
                      </StatusChip>
                      <p className="text-sm">{t("clinical.vitals.reason", { reason: enteredInError.reason })}</p>
                    </>
                  ) : null}
                  {corrects ? (
                    <>
                      <StatusChip tone="info" icon={History}>
                        {t("clinical.vitals.correction")}
                      </StatusChip>
                      <p className="text-sm">{t("clinical.vitals.reason", { reason: corrects.reason })}</p>
                    </>
                  ) : null}
                  {row.note ? <p className={cn("text-sm", struck)}>{row.note}</p> : null}
                </div>
              </TableCell>
              <TableCell className={cn("align-top", struck)}>{cells.temperature}</TableCell>
              <TableCell className={cn("align-top", struck)}>{cells.pulse}</TableCell>
              <TableCell className={cn("align-top", struck)}>{cells.resp}</TableCell>
              <TableCell className={cn("align-top", struck)}>{cells.bp}</TableCell>
              <TableCell className={cn("align-top", struck)}>{cells.spo2}</TableCell>
              <TableCell className={cn("align-top", struck)}>{cells.weight}</TableCell>
              <TableCell className={cn("align-top", struck)}>{cells.height}</TableCell>
              {action ? <TableCell className="align-top">{current ? action(row) : null}</TableCell> : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
