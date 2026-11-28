"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import { saveVitals } from "../actions";
import { EMPTY_VITALS, firstInvalid, readVitals, VitalsFields, type VitalsErrors } from "./VitalsFields";

/**
 * Record a set of vitals. The id is made once per entry, so a retry after a dropped connection
 * can't save it twice (rule 11); a fresh id is made only after a successful save.
 */
export function RecordVitals({ visitId, patientId }: { visitId: string; patientId: string }) {
  const [id, setId] = useState(() => uuidv7());
  const [values, setValues] = useState(EMPTY_VITALS);
  const [errors, setErrors] = useState<VitalsErrors>({});
  const { busy, message, run } = useAction();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { measurements, errors: found } = readVitals(values);
    setErrors(found);
    if (!measurements) {
      firstInvalid("vitals", found)?.focus();
      return;
    }
    const saved = await run(() => saveVitals({ id, visitId, patientId, measurements }), () => t("clinical.vitals.saved"));
    if (saved !== null) {
      setValues(EMPTY_VITALS);
      setId(uuidv7());
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="record-vitals-title" className="space-y-5">
      <h3 id="record-vitals-title" className="text-lg font-bold text-heading">
        {t("clinical.vitals.recordTitle")}
      </h3>
      <p className="text-muted">{t("clinical.vitals.recordHint")}</p>
      <VitalsFields idPrefix="vitals" values={values} errors={errors} onChange={setValues} />
      <FormMessage message={errors.form ?? null} />
      <FormMessage message={message?.text ?? null} tone={message?.tone ?? "error"} />
      <Button type="submit" disabled={busy}>
        <Save aria-hidden="true" />
        {t("clinical.vitals.save")}
      </Button>
    </form>
  );
}
