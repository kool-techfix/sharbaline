"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { t } from "@/lib/i18n";

/**
 * Shown when this device can't reach the on-site server (scope §7.1 "Server unreachable").
 * Layout from Login-Working-offline-Tablet.png; title and wording follow the scope, not the
 * PNG's "Working offline" label, which means something else (D-021).
 */
export function ServerUnreachable() {
  const { recheck } = useConnection();
  const [checking, setChecking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <section aria-labelledby="unreachable-title">
      <h1 id="unreachable-title" ref={heading} tabIndex={-1} className="text-2xl font-bold outline-none focus-visible:outline-3">
        {t("auth.unreachable.title")}
      </h1>
      <p className="mt-2 text-muted">{t("auth.unreachable.body")}</p>
      <div className="mt-6 flex gap-3 rounded-lg border border-warning-text/30 bg-warning-bg p-4 text-warning-text">
        <Lock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">{t("auth.unreachable.noticeTitle")}</p>
          <p className="mt-1">{t("auth.unreachable.noticeBody")}</p>
        </div>
      </div>
      <p className="mt-6 text-muted">{t("auth.unreachable.help")}</p>
      <Button
        variant="secondary"
        size="block"
        className="mt-3"
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          await recheck();
          setChecking(false);
        }}
      >
        {t("auth.unreachable.retry")}
      </Button>
      <p className="mt-6 flex items-start gap-2 border-t border-border pt-4 text-sm text-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t("auth.unreachable.protections")}
      </p>
    </section>
  );
}
