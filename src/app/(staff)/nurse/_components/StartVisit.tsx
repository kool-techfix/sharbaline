"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import { RadioCards } from "../../_components/RadioCards";
import { startVisit } from "../actions";

type VisitType = "outpatient" | "follow_up" | "emergency";
const TYPES: VisitType[] = ["outpatient", "follow_up", "emergency"];

/**
 * Open a visit and go to the patient. If one is already open (another nurse got there first),
 * the server returns that one instead, so nobody ends up with two visits for one patient.
 * From the queue it starts an outpatient visit straight away; on the patient page the type
 * can be chosen first.
 */
export function StartVisit({ patientId, name, chooseType }: { patientId: string; name?: string; chooseType?: boolean }) {
  const router = useRouter();
  const [id] = useState(() => uuidv7());
  const [visitType, setVisitType] = useState<VisitType>("outpatient");
  const { busy, message, run } = useAction();

  async function start() {
    const result = await run(
      () => startVisit({ id, patientId, visitType }),
      (data) => (data.alreadyOpen ? t("nurse.visit.alreadyOpen") : t("nurse.visit.started")),
    );
    if (result) router.push(`/nurse/patients/${patientId}`);
  }

  return (
    <div className="space-y-3">
      {chooseType ? (
        <RadioCards
          name="visit-type"
          legend={t("nurse.visit.type")}
          value={visitType}
          options={TYPES.map((value) => ({ value, label: t(`clinical.visitType.${value}`) }))}
          onChange={(value) => setVisitType(value as VisitType)}
        />
      ) : null}
      <Button onClick={start} disabled={busy} aria-label={name ? t("nurse.visit.startFor", { name }) : undefined}>
        <Play aria-hidden="true" />
        {t("nurse.visit.start")}
      </Button>
      <FormMessage message={message?.tone === "error" ? message.text : null} />
    </div>
  );
}
