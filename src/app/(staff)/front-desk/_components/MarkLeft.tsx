"use client";

import { useState } from "react";
import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { markLeft } from "../actions";

/**
 * "Left without being seen", with an inline confirmation step (no browser dialogs). The buttons'
 * names say which patient, starting with the visible text (WCAG 2.5.3).
 */
export function MarkLeft({ entryId, name }: { entryId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, message, run } = useAction();

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t("queue.markLeftConfirm")}</span>
          <Button
            variant="danger"
            disabled={busy}
            aria-label={`${t("queue.markLeftYes")}: ${name}`}
            onClick={() => run(() => markLeft({ entryId }), () => t("queue.markedLeft"))}
          >
            {t("queue.markLeftYes")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            {t("queue.markLeftNo")}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" aria-label={`${t("queue.markLeft")}: ${name}`} onClick={() => setConfirming(true)}>
          {t("queue.markLeft")}
        </Button>
      )}
      <FormMessage message={message?.tone === "error" ? message.text : null} />
    </div>
  );
}
