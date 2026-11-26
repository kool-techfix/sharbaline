"use client";

import { FormMessage } from "@/components/FormMessage";
import { useAction } from "@/components/useAction";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { endAccess } from "../actions";

/** Ends the admin's own break-glass access before its 30 minutes are up. */
export function EndAccess({ eventId }: { eventId: string }) {
  const { busy, message, run } = useAction();
  return (
    <div className="space-y-2">
      <Button variant="secondary" disabled={busy} onClick={() => run(() => endAccess({ eventId }), () => t("breakGlass.ended"))}>
        {t("breakGlass.end")}
      </Button>
      <FormMessage message={message?.tone === "error" ? message.text : null} />
    </div>
  );
}
