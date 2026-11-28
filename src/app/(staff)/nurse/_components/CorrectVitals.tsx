"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import { FieldError, RadioCards } from "../../_components/RadioCards";
import { fixVitals } from "../actions";
import { firstInvalid, readVitals, valuesFrom, VitalsFields, type VitalsErrors } from "./VitalsFields";

type Mode = "replace" | "strike";

/**
 * Correct a wrong vitals entry (D-007). The original is never changed: the correction is a new
 * entry pointing at it, with a reason. "Entered in error" alone strikes it out with no new values.
 */
export function CorrectVitals({
  patientId,
  original,
  closeHref,
  recordedAt,
}: {
  patientId: string;
  original: Parameters<typeof valuesFrom>[0] & { id: string };
  /** The page without the correction open. */
  closeHref: string;
  recordedAt: string;
}) {
  const router = useRouter();
  const [id] = useState(() => uuidv7());
  const [mode, setMode] = useState<Mode | "">("");
  const [reason, setReason] = useState("");
  const [values, setValues] = useState(() => valuesFrom(original));
  const [errors, setErrors] = useState<VitalsErrors & { mode?: string; reason?: string }>({});
  const { busy, message, run } = useAction();
  const heading = useRef<HTMLHeadingElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => heading.current?.focus(), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: typeof errors = {};
    if (!mode) found.mode = t("clinical.vitals.correct.mode.error");
    if (reason.trim().length < 3) found.reason = t("clinical.vitals.correct.reason.error");
    const read = mode === "replace" ? readVitals(values) : { measurements: null, errors: {} };
    Object.assign(found, read.errors);
    setErrors(found);
    if (found.mode) return document.getElementById(`correct-mode-replace`)?.focus();
    if (found.reason) return reasonRef.current?.focus();
    if (mode === "replace" && !read.measurements) return firstInvalid("correct", found)?.focus();

    const done = await run(
      () => fixVitals({ id, patientId, supersedesId: original.id, reason: reason.trim(), measurements: read.measurements }),
      (data) => (data.struckOut ? t("clinical.vitals.correct.struckOut") : t("clinical.vitals.correct.saved")),
    );
    // The form closes on success, so the page announces the result (front desk does the same).
    if (done) router.replace(`${closeHref}?corrected=${done.struckOut ? "struck" : "replaced"}`, { scroll: false });
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="correct-title"
      className="space-y-5 rounded-md border border-border-strong p-5"
    >
      <h3 id="correct-title" ref={heading} tabIndex={-1} className="text-lg font-bold text-heading">
        {t("clinical.vitals.correct.title", { time: recordedAt })}
      </h3>
      <p className="max-w-3xl text-muted">{t("clinical.vitals.correct.intro")}</p>
      <RadioCards
        name="correct-mode"
        legend={t("clinical.vitals.correct.mode")}
        value={mode}
        options={[
          { value: "replace", label: t("clinical.vitals.correct.mode.replace") },
          { value: "strike", label: t("clinical.vitals.correct.mode.strike") },
        ]}
        error={errors.mode}
        onChange={(value) => setMode(value as Mode)}
      />
      <div className="space-y-2">
        <Label htmlFor="correct-reason">{t("clinical.vitals.correct.reason")}</Label>
        <p id="correct-reason-hint" className="text-sm text-muted">
          {t("clinical.vitals.correct.reasonHint")}
        </p>
        <Textarea
          id="correct-reason"
          ref={reasonRef}
          className="min-h-20"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? "correct-reason-hint correct-reason-error" : "correct-reason-hint"}
        />
        <FieldError id="correct-reason-error" message={errors.reason} />
      </div>
      {mode === "replace" ? <VitalsFields idPrefix="correct" values={values} errors={errors} onChange={setValues} /> : null}
      <FormMessage message={errors.form ?? null} />
      <FormMessage message={message?.tone === "error" ? message.text : null} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {t("clinical.vitals.correct.submit")}
        </Button>
        <Link
          href={closeHref}
          scroll={false}
          className="inline-flex min-h-11 items-center rounded-md px-4 font-semibold text-primary underline-offset-4 hover:bg-primary-soft hover:underline"
        >
          {t("clinical.vitals.correct.cancel")}
        </Link>
      </div>
    </form>
  );
}
