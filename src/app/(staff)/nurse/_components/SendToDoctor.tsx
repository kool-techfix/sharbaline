"use client";

import { Send } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { sendPatientToDoctor } from "../actions";

/**
 * The nurse is done: the patient moves to "Waiting for doctor" in today's queue. Stays mounted
 * in every state, so the confirmation is still announced after the page refreshes.
 */
export function SendToDoctor({
  visitId,
  patientId,
  state,
}: {
  visitId: string;
  patientId: string;
  /** ready: still with the nurse; sent: already further along; notQueued: no queue entry today. */
  state: "ready" | "sent" | "notQueued";
}) {
  const { busy, message, run } = useAction();
  return (
    <div className="space-y-3">
      {state === "ready" ? (
        <>
          <p className="text-muted">{t("nurse.visit.sendHint")}</p>
          <Button
            onClick={() => run(() => sendPatientToDoctor({ visitId, patientId }), () => t("nurse.visit.sent"))}
            disabled={busy}
          >
            <Send aria-hidden="true" />
            {t("nurse.visit.send")}
          </Button>
        </>
      ) : (
        <p className="text-muted">{t(state === "sent" ? "nurse.visit.alreadySent" : "nurse.visit.notQueued")}</p>
      )}
      <FormMessage message={message?.text ?? null} tone={message?.tone ?? "error"} />
    </div>
  );
}
