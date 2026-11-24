"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { signOut, unlockScreen } from "../actions";

const SIGNED_OUT_CODES = ["session_invalid", "unlock_failed_signed_out", "locked"];

/**
 * Replaces the page while locked: the page's content is unmounted, not just covered, so no
 * patient information stays on screen or in the DOM. Password only (M1 proposal c).
 */
export function LockScreen({ displayName, onUnlocked }: { displayName: string; onUnlocked: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      const result = await unlockScreen({ password });
      if (result.ok) return onUnlocked();
      if (SIGNED_OUT_CODES.includes(result.code)) {
        // Full reload on purpose: it discards the client-side page cache, which may hold patient data.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login?reason=signed_out");
        return;
      }
      setError(result.message);
    } catch {
      setError(t("auth.error.serverUnavailable"));
    } finally {
      setBusy(false);
      const input = form.elements.namedItem("password");
      if (input instanceof HTMLInputElement) input.value = "";
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <section aria-labelledby="lock-title" className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Lock aria-hidden="true" className="size-6" />
        </div>
        <h1 id="lock-title" ref={heading} tabIndex={-1} className="text-2xl font-bold outline-none focus-visible:outline-3">
          {t("auth.lock.title")}
        </h1>
        <p className="mt-2 text-muted">{t("auth.lock.intro")}</p>
        <p className="mt-4 font-semibold text-heading">{t("auth.lock.signedInAs", { name: displayName })}</p>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unlock-password">{t("auth.lock.password")}</Label>
            <PasswordField
              id="unlock-password"
              name="password"
              autoComplete="current-password"
              aria-describedby="unlock-message"
              required
            />
          </div>
          <FormMessage id="unlock-message" message={error} />
          <Button type="submit" size="block" disabled={busy}>
            {t("auth.lock.submit")}
          </Button>
        </form>
        <form action={signOut} className="mt-3">
          <Button type="submit" variant="ghost" className="w-full">
            {t("auth.lock.notYou")}
          </Button>
        </form>
      </section>
    </div>
  );
}
