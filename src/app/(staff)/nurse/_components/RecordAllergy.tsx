"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import { FieldError, RadioCards } from "../../_components/RadioCards";
import { addAllergy } from "../actions";

type Severity = "mild" | "moderate" | "severe" | "unknown";
const SEVERITIES: Severity[] = ["mild", "moderate", "severe", "unknown"];

/** Add an allergy. Recording one retires an earlier "no known allergies" (server-side). */
export function RecordAllergy({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(() => uuidv7());
  const [allergen, setAllergen] = useState("");
  const [reaction, setReaction] = useState("");
  const [severity, setSeverity] = useState<Severity>("unknown");
  const [error, setError] = useState<string | null>(null);
  const { busy, message, run } = useAction();
  const allergenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) allergenRef.current?.focus();
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allergen.trim()) {
      setError(t("clinical.allergies.allergen.error"));
      allergenRef.current?.focus();
      return;
    }
    setError(null);
    const done = await run(
      () =>
        addAllergy({
          id,
          patientId,
          kind: "allergy",
          allergen: allergen.trim(),
          reaction: reaction.trim() || null,
          severity,
        }),
      () => t("clinical.allergies.recorded", { allergen: allergen.trim() }),
    );
    if (done) {
      setAllergen("");
      setReaction("");
      setSeverity("unknown");
      setId(uuidv7());
      setOpen(false);
    }
  }

  return (
    <div className="space-y-3">
      {open ? (
        <form onSubmit={onSubmit} noValidate aria-labelledby="add-allergy-title" className="space-y-5 rounded-md border border-border-strong p-5">
          <h3 id="add-allergy-title" className="text-lg font-bold text-heading">
            {t("clinical.allergies.addTitle")}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="allergen">{t("clinical.allergies.allergen")}</Label>
              <p id="allergen-hint" className="text-sm text-muted">
                {t("clinical.allergies.allergenHint")}
              </p>
              <Input
                id="allergen"
                ref={allergenRef}
                autoComplete="off"
                maxLength={100}
                value={allergen}
                onChange={(event) => setAllergen(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "allergen-hint allergen-error" : "allergen-hint"}
              />
              <FieldError id="allergen-error" message={error} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reaction">
                {t("clinical.allergies.reaction")} <span className="font-normal text-muted">{t("patients.optional")}</span>
              </Label>
              <p id="reaction-hint" className="text-sm text-muted">
                {t("clinical.allergies.reactionHint")}
              </p>
              <Input
                id="reaction"
                autoComplete="off"
                maxLength={200}
                value={reaction}
                onChange={(event) => setReaction(event.target.value)}
                aria-describedby="reaction-hint"
              />
            </div>
          </div>
          <RadioCards
            name="severity"
            legend={t("clinical.allergies.severity")}
            value={severity}
            options={SEVERITIES.map((value) => ({ value, label: t(`clinical.allergies.severity.${value}`) }))}
            onChange={(value) => setSeverity(value as Severity)}
          />
          <FormMessage message={message?.tone === "error" ? message.text : null} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy}>
              {t("clinical.allergies.save")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              {t("clinical.allergies.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          {t("clinical.allergies.add")}
        </Button>
      )}
      <FormMessage message={!open && message?.tone === "notice" ? message.text : null} tone="notice" />
    </div>
  );
}

/** Record that the patient has no known allergies: an explicit statement, never assumed. */
export function RecordNoKnownAllergies({ patientId }: { patientId: string }) {
  const [id] = useState(() => uuidv7());
  const { busy, message, run } = useAction();
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          run(() => addAllergy({ id, patientId, kind: "no_known_allergies" }), () => t("clinical.allergies.noneKnownRecorded"))
        }
      >
        <ShieldCheck aria-hidden="true" />
        {t("clinical.allergies.recordNoneKnown")}
      </Button>
      <FormMessage message={message?.text ?? null} tone={message?.tone ?? "error"} />
    </div>
  );
}
