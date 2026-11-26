"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { ActionResult } from "@/server/http/action-result";
import type { SearchResult } from "@/server/services/patients/records";
import { ageLabel, displayName, phoneLabel, sexLabel } from "./format";

interface PatientSearchProps {
  /** The calling workspace's search action (each wraps the same audited service). */
  search: (input: { query: string }) => Promise<ActionResult<SearchResult>>;
  /** Where a result links to: `${recordPath}/${patientId}`. */
  recordPath: string;
  /** Offered when nothing matches, for roles that can register patients. */
  registerHref?: string;
}

/**
 * Patient search. The query goes to a server action, never into the URL (rule 2). Results show
 * only what staff need to pick the right person; the full record is one click away.
 */
export function PatientSearch({ search, recordPath, registerHref }: PatientSearchProps) {
  const { reportUnreachable } = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
    if (!query) {
      setError(t("patients.search.empty"));
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await search({ query });
      if (outcome.ok) setResult(outcome.data);
      else {
        setResult(null);
        setError(outcome.message);
      }
    } catch {
      reportUnreachable();
      setError(t("auth.error.serverUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  const status = result ? statusText(result) : "";

  return (
    <div className="space-y-6">
      <form role="search" onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" aria-busy={busy}>
        <div className="min-w-64 flex-1 space-y-2">
          <Label htmlFor="patient-query">{t("patients.search.label")}</Label>
          <p id="patient-query-hint" className="text-sm text-muted">
            {t("patients.search.hint")}
          </p>
          <Input
            id="patient-query"
            name="query"
            type="search"
            autoComplete="off"
            autoFocus
            maxLength={100}
            aria-describedby="patient-query-hint"
          />
        </div>
        <Button type="submit" disabled={busy}>
          <Search aria-hidden="true" />
          {t("patients.search.submit")}
        </Button>
      </form>

      <FormMessage id="search-error" message={error} />
      <p role="status" aria-live="polite" className={status ? "font-semibold text-heading" : "sr-only"}>
        {status}
      </p>

      {result && result.results.length > 0 ? (
        <Table>
          <TableCaption>{t("patients.search.resultsCaption")}</TableCaption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t("patients.col.number")}</TableHeaderCell>
              <TableHeaderCell>{t("patients.col.name")}</TableHeaderCell>
              <TableHeaderCell>{t("patients.col.age")}</TableHeaderCell>
              <TableHeaderCell>{t("patients.col.sex")}</TableHeaderCell>
              <TableHeaderCell>{t("patients.col.phone")}</TableHeaderCell>
              <TableHeaderCell>{t("patients.col.legacyCard")}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.results.map((patient) => (
              <TableRow key={patient.id}>
                <TableCell className="font-mono">{patient.patientNumber}</TableCell>
                <TableCell>
                  <Link
                    href={`${recordPath}/${patient.id}`}
                    className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
                  >
                    {displayName(patient)}
                  </Link>
                </TableCell>
                <TableCell>{ageLabel(patient)}</TableCell>
                <TableCell>{sexLabel(patient.sex)}</TableCell>
                <TableCell>{patient.view === "full" ? phoneLabel(patient.phoneE164) : null}</TableCell>
                <TableCell>{patient.view === "full" ? (patient.legacyCardNumber ?? t("patients.none")) : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {result && result.results.length === 0 && registerHref ? (
        <p>
          <Link href={registerHref} className="inline-flex min-h-11 items-center font-semibold text-primary underline">
            {t("patients.search.registerInstead")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function statusText(result: SearchResult): string {
  if (result.checkDigitInvalid) return t("patients.search.checkDigit");
  if (result.results.length === 0) return t("patients.search.none");
  return tPlural("patients.search.found", result.results.length);
}
