"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/FormMessage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { t } from "@/lib/i18n";
import { beginEnrollment, finishEnrollment } from "../../../actions";
import { CodeInput } from "../../../_components/CodeInput";
import { ServerUnreachable } from "../../../_components/ServerUnreachable";
import { StepHeading } from "../../../_components/StepHeading";

type Phase =
  | { kind: "intro" }
  | { kind: "scan"; qrDataUrl: string; manualKey: string }
  | { kind: "codes"; recoveryCodes: string[]; redirectTo: string };

/** First-login authenticator setup: show code → confirm one code → show recovery codes once. */
export function EnrollFlow({ signedInHome }: { signedInHome: string | null }) {
  const router = useRouter();
  const { state: connection, reportUnreachable } = useConnection();
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const codesHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase.kind === "codes") codesHeading.current?.focus();
  }, [phase.kind]);

  // Arrived here already enrolled (e.g. browser back): go home. Only the value at first render
  // counts, so the re-render after confirming (new session cookie) can't skip the codes.
  const homeOnArrival = useRef(signedInHome);
  useEffect(() => {
    if (homeOnArrival.current) router.replace(homeOnArrival.current);
  }, [router]);

  async function guarded<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch {
      reportUnreachable();
      setError(t("auth.error.serverUnavailable"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const result = await guarded(() => beginEnrollment());
    if (!result) return;
    if (!result.ok) {
      if (result.code === "session_invalid") return router.replace("/login");
      return setError(result.message);
    }
    setPhase({ kind: "scan", ...result.data });
  }

  async function confirm(value: string) {
    if (value.length !== 6 || busy) return;
    const result = await guarded(() => finishEnrollment({ code: value }));
    setCode("");
    if (!result) return;
    if (!result.ok) {
      if (result.code === "session_invalid") return router.replace("/login");
      if (result.code === "no_pending_enrollment") setPhase({ kind: "intro" });
      return setError(result.message);
    }
    setPhase({ kind: "codes", recoveryCodes: result.data.recoveryCodes, redirectTo: result.data.redirectTo });
  }

  if (connection === "server_unreachable" && phase.kind !== "codes") return <ServerUnreachable />;

  if (phase.kind === "intro") {
    return (
      <div>
        <StepHeading ref={heading} title={t("auth.enroll.title")} intro={t("auth.enroll.intro")} />
        <FormMessage message={error} />
        <Button size="block" className="mt-4" onClick={start} disabled={busy}>
          {t("auth.enroll.start")}
        </Button>
      </div>
    );
  }

  if (phase.kind === "scan") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void confirm(code);
        }}
      >
        <StepHeading ref={heading} title={t("auth.enroll.title")} />
        <h2 className="text-lg font-semibold">{t("auth.enroll.scanTitle")}</h2>
        {/* eslint-disable-next-line @next/next/no-img-element -- inline data: SVG, nothing to optimise */}
        <img src={phase.qrDataUrl} alt={t("auth.enroll.qrAlt")} width={200} height={200} className="mx-auto my-4 bg-white" />
        <details className="mb-6 rounded-md border border-border p-3">
          <summary className="min-h-11 cursor-pointer content-center font-semibold text-primary">
            {t("auth.enroll.manualTitle")}
          </summary>
          <p className="mt-2 break-all font-mono text-lg tracking-wider select-all">{phase.manualKey}</p>
        </details>
        <h2 className="text-lg font-semibold">
          <Label htmlFor="enroll-code" className="text-lg">
            {t("auth.enroll.confirmTitle")}
          </Label>
        </h2>
        <div className="mt-3 space-y-4">
          <CodeInput
            id="enroll-code"
            value={code}
            onChange={setCode}
            onComplete={(value) => void confirm(value)}
            describedBy="enroll-message"
            invalid={Boolean(error)}
            disabled={busy}
          />
          <FormMessage id="enroll-message" message={error} />
          <Button type="submit" size="block" disabled={busy || code.length !== 6}>
            {t("auth.enroll.confirm")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <StepHeading ref={codesHeading} title={t("auth.enroll.codesTitle")} intro={t("auth.enroll.codesIntro")} />
      <ol className="grid grid-cols-2 gap-2 rounded-md border border-border bg-canvas p-4 font-mono text-lg" aria-label={t("auth.enroll.codesTitle")}>
        {phase.recoveryCodes.map((recovery) => (
          <li key={recovery} className="select-all">
            {recovery}
          </li>
        ))}
      </ol>
      <label className="mt-6 flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="size-6 accent-primary"
        />
        <span className="font-semibold text-heading">{t("auth.enroll.codesSaved")}</span>
      </label>
      <Button size="block" className="mt-4" disabled={!saved} onClick={() => router.replace(phase.redirectTo)}>
        {t("auth.enroll.continue")}
      </Button>
    </div>
  );
}
