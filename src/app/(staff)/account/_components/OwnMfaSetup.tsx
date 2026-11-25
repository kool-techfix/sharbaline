"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CodeInput } from "@/components/CodeInput";
import { FormMessage } from "@/components/FormMessage";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { t } from "@/lib/i18n";
import type { ActionResult } from "@/server/http/action-result";
import { beginOwnEnrollment, finishOwnEnrollment } from "../actions";

type Phase =
  | { kind: "offer" }
  | { kind: "password" }
  | { kind: "scan"; qrDataUrl: string; manualKey: string }
  | { kind: "codes"; recoveryCodes: string[] };

/** Optional authenticator setup: password → scan → confirm one code → recovery codes once. */
export function OwnMfaSetup() {
  const router = useRouter();
  const { reportUnreachable } = useConnection();
  const [phase, setPhase] = useState<Phase>({ kind: "offer" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase.kind !== "offer") stepHeading.current?.focus();
  }, [phase.kind]);

  async function call<T>(fn: () => Promise<ActionResult<T>>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result.ok) return result.data;
      if (result.code === "session_invalid" || result.code === "locked") router.refresh();
      setError(result.message || t("auth.error.signedOut"));
      return null;
    } catch {
      reportUnreachable();
      setError(t("auth.error.serverUnavailable"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const data = await call(() => beginOwnEnrollment({ password }));
    if (data) setPhase({ kind: "scan", ...data });
  }

  async function confirm(value: string) {
    if (value.length !== 6 || busy) return;
    const data = await call(() => finishOwnEnrollment({ code: value }));
    setCode("");
    if (data) setPhase({ kind: "codes", recoveryCodes: data.recoveryCodes });
  }

  const heading = (text: string) => (
    <h3 ref={stepHeading} tabIndex={-1} className="text-lg font-semibold">
      {text}
    </h3>
  );

  if (phase.kind === "offer") {
    return (
      <div className="space-y-3">
        <p>{t("account.mfa.offOptional")}</p>
        <Button onClick={() => setPhase({ kind: "password" })}>{t("account.mfa.start")}</Button>
      </div>
    );
  }

  if (phase.kind === "password") {
    return (
      <form onSubmit={submitPassword} className="max-w-md space-y-4">
        {heading(t("account.mfa.passwordIntro"))}
        <div className="space-y-2">
          <Label htmlFor="own-mfa-password">{t("account.mfa.password")}</Label>
          <PasswordField
            id="own-mfa-password"
            name="password"
            autoComplete="current-password"
            required
            aria-describedby="own-mfa-message"
          />
        </div>
        <FormMessage id="own-mfa-message" message={error} />
        <Button type="submit" disabled={busy}>
          {t("account.mfa.continue")}
        </Button>
      </form>
    );
  }

  if (phase.kind === "scan") {
    return (
      <form
        className="max-w-md space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm(code);
        }}
      >
        {heading(t("auth.enroll.scanTitle"))}
        {/* eslint-disable-next-line @next/next/no-img-element -- inline data: SVG, nothing to optimise */}
        <img src={phase.qrDataUrl} alt={t("auth.enroll.qrAlt")} width={200} height={200} className="bg-white" />
        <details className="rounded-md border border-border p-3">
          <summary className="min-h-11 cursor-pointer content-center font-semibold text-primary">
            {t("auth.enroll.manualTitle")}
          </summary>
          <p className="mt-2 break-all font-mono text-lg tracking-wider select-all">{phase.manualKey}</p>
        </details>
        <Label htmlFor="own-mfa-code">{t("auth.enroll.confirmTitle")}</Label>
        <CodeInput
          id="own-mfa-code"
          value={code}
          onChange={setCode}
          onComplete={(value) => void confirm(value)}
          describedBy="own-mfa-message"
          invalid={Boolean(error)}
          disabled={busy}
        />
        <FormMessage id="own-mfa-message" message={error} />
        <Button type="submit" disabled={busy || code.length !== 6}>
          {t("auth.enroll.confirm")}
        </Button>
      </form>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      {heading(t("auth.enroll.codesTitle"))}
      <p>{t("auth.enroll.codesIntro")}</p>
      <ol className="grid grid-cols-2 gap-2 rounded-md border border-border bg-canvas p-4 font-mono text-lg" aria-label={t("auth.enroll.codesTitle")}>
        {phase.recoveryCodes.map((recovery) => (
          <li key={recovery} className="select-all">
            {recovery}
          </li>
        ))}
      </ol>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="size-6 accent-primary" />
        <span className="font-semibold text-heading">{t("auth.enroll.codesSaved")}</span>
      </label>
      <Button disabled={!saved} onClick={() => router.refresh()}>
        {t("account.mfa.done")}
      </Button>
    </div>
  );
}
