"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { t } from "@/lib/i18n";
import type { ActionResult } from "@/server/http/action-result";

/** Runs a server action, tracks busy/message state, and refreshes the page's server data on success. */
export function useAction() {
  const router = useRouter();
  const { reportUnreachable } = useConnection();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "notice"; text: string } | null>(null);

  async function run<T>(call: () => Promise<ActionResult<T>>, success: (data: T) => string): Promise<T | null> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await call();
      if (!result.ok) {
        if (result.code === "session_invalid") router.refresh();
        setMessage({ tone: "error", text: result.message });
        return null;
      }
      setMessage({ tone: "notice", text: success(result.data) });
      router.refresh();
      return result.data;
    } catch {
      reportUnreachable();
      setMessage({ tone: "error", text: t("auth.error.serverUnavailable") });
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, run };
}
