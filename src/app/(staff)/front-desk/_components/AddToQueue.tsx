"use client";

import { useState } from "react";
import { ListPlus } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import { queuePatient } from "../actions";

/** Adds the patient to today's queue. A double click or retry is the same request (rule 11). */
export function AddToQueue({ patientId }: { patientId: string }) {
  const [id] = useState(() => uuidv7());
  const { busy, message, run } = useAction();

  return (
    <div className="space-y-2">
      <Button
        disabled={busy}
        onClick={() =>
          run(
            () => queuePatient({ id, patientId }),
            (data) => t("queue.added", { position: data.position }),
          )
        }
      >
        <ListPlus aria-hidden="true" />
        {t("queue.add")}
      </Button>
      <FormMessage message={message?.text ?? null} tone={message?.tone ?? "error"} />
    </div>
  );
}
