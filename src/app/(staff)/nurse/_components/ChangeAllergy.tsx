"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import { FieldError, RadioCards } from "../../_components/RadioCards";
import { updateAllergy } from "../actions";

type Status = "active" | "resolved" | "entered_in_error";

/**
 * Change an allergy's status. The current entry stays in the record; the change is a new entry
 * that replaces it (D-007). "Entered in error" needs a reason.
 */
export function ChangeAllergy({
  patientId,
  allergyId,
  allergen,
  status,
}: {
  patientId: string;
  allergyId: string;
  allergen: string;
  status: "active" | "resolved";
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(() => uuidv7());
  const [next, setNext] = useState<Status | "">("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ status?: string; reason?: string }>({});
  const { busy, message, run } = useAction();
  const heading = useRef<HTMLHeadingElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const prefix = `allergy-${allergyId}`;

  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  const choices: Status[] = status === "active" ? ["resolved", "entered_in_error"] : ["active", "entered_in_error"];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: typeof errors = {};
    if (!next) found.status = t("clinical.allergies.change.status.error");
    if (next === "entered_in_error" && reason.trim().length < 3) found.reason = t("clinical.allergies.change.reason.error");
    setErrors(found);
    if (found.status) return document.getElementById(`${prefix}-status-${choices[0]}`)?.focus();
    if (found.reason) return reasonRef.current?.focus();
    const done = await run(
      () =>
        updateAllergy({
          id,
          patientId,
          supersedesId: allergyId,
          status: next as Status,
          reason: reason.trim() || null,
        }),
      () => t("clinical.allergies.change.saved", { allergen }),
    );
    if (done) {
      setId(uuidv7());
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <Button variant="ghost" onClick={() => setOpen(true)} aria-label={t("clinical.allergies.change.forAllergen", { allergen })}>
          {t("clinical.allergies.change")}
        </Button>
        <FormMessage message={message?.text ?? null} tone={message?.tone ?? "error"} />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby={`${prefix}-title`} className="space-y-4 rounded-md border border-border-strong p-4">
      <h4 id={`${prefix}-title`} ref={heading} tabIndex={-1} className="text-base font-bold text-heading">
        {t("clinical.allergies.change.title", { allergen })}
      </h4>
      <RadioCards
        name={`${prefix}-status`}
        legend={t("clinical.allergies.change.status")}
        value={next}
        options={choices.map((value) => ({ value, label: t(`clinical.allergies.status.${value}`) }))}
        error={errors.status}
        onChange={(value) => setNext(value as Status)}
      />
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-reason`}>
          {t("clinical.allergies.change.reason")}{" "}
          {next !== "entered_in_error" ? <span className="font-normal text-muted">{t("patients.optional")}</span> : null}
        </Label>
        <Textarea
          id={`${prefix}-reason`}
          ref={reasonRef}
          className="min-h-20"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? `${prefix}-reason-error` : undefined}
        />
        <FieldError id={`${prefix}-reason-error`} message={errors.reason} />
      </div>
      <FormMessage message={message?.tone === "error" ? message.text : null} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {t("clinical.allergies.change.submit")}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {t("clinical.allergies.cancel")}
        </Button>
      </div>
    </form>
  );
}
