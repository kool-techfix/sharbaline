"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ShieldAlert } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import type { BreakGlassReason } from "@/server/services/break-glass/break-glass";
import { FieldError, RadioCards } from "../../_components/RadioCards";
import { openClinicalRecord } from "../actions";

const REASONS: BreakGlassReason[] = [
  "emergency_care",
  "patient_request",
  "complaint_investigation",
  "records_correction",
  "legal_regulatory",
  "other",
];

/**
 * The break-glass reason form, shown inline (no browser dialogs). The server checks the same
 * rules; these checks only save a round trip and say what's missing next to the field.
 */
export function BreakGlassForm({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const [id] = useState(() => uuidv7());
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [errors, setErrors] = useState<{ category?: string; details?: string }>({});
  const { busy, message, run } = useAction();
  const heading = useRef<HTMLHeadingElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <ShieldAlert aria-hidden="true" />
        {t("breakGlass.open")}
      </Button>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: typeof errors = {};
    if (!category) found.category = t("breakGlass.form.category.error");
    if (details.trim().length < 10) found.details = t("breakGlass.form.details.error");
    setErrors(found);
    if (found.category) {
      document.getElementById(`bg-reason-${REASONS[0]}`)?.focus();
      return;
    }
    if (found.details) {
      detailsRef.current?.focus();
      return;
    }
    await run(
      () =>
        openClinicalRecord({
          id,
          patientId,
          reasonCategory: category as BreakGlassReason,
          reasonDetails: details.trim(),
        }),
      () => t("breakGlass.opened"),
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="bg-form-title" className="space-y-5 rounded-md border border-border-strong p-5">
      <h3 id="bg-form-title" ref={heading} tabIndex={-1} className="text-lg font-bold text-heading">
        {t("breakGlass.form.title")}
      </h3>
      <RadioCards
        name="bg-reason"
        legend={t("breakGlass.form.category")}
        value={category}
        options={REASONS.map((value) => ({ value, label: t(`breakGlass.reason.${value}`) }))}
        error={errors.category}
        onChange={setCategory}
      />
      <div className="space-y-2">
        <Label htmlFor="bg-details">{t("breakGlass.form.details")}</Label>
        <p id="bg-details-hint" className="text-sm text-muted">
          {t("breakGlass.form.detailsHint")}
        </p>
        <Textarea
          id="bg-details"
          ref={detailsRef}
          value={details}
          maxLength={500}
          onChange={(event) => setDetails(event.target.value)}
          aria-invalid={errors.details ? true : undefined}
          aria-describedby={errors.details ? "bg-details-hint bg-details-error" : "bg-details-hint"}
        />
        <FieldError id="bg-details-error" message={errors.details} />
      </div>
      <FormMessage message={message?.tone === "error" ? message.text : null} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {t("breakGlass.form.submit")}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {t("breakGlass.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
