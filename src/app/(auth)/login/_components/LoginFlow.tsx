"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { FormMessage } from "@/components/FormMessage";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { t, tPlural } from "@/lib/i18n";
import { cancelSignIn, signIn, submitRecoveryCode, submitTotpCode } from "../../actions";
import { CodeInput } from "../../_components/CodeInput";
import { ServerUnreachable } from "../../_components/ServerUnreachable";
import { StepHeading } from "../../_components/StepHeading";

type Step = "credentials" | "totp" | "recovery";
type Result = { ok: true; data: { stage: string; redirectTo: string } } | { ok: false; code: string; message: string };

/** Results that mean the half-finished sign-in is over: start again at step 1. */
const RESTART_CODES = ["session_invalid", "locked"];

export function LoginFlow({
  initialStep,
  notice,
  signedInHome,
}: {
  initialStep: Step;
  notice: string | null;
  /** Set when the session is already fully signed in: leave as soon as nothing is left to show. */
  signedInHome: string | null;
}) {
  const router = useRouter();
  const { state: connection, reportUnreachable } = useConnection();
  const [step, setStep] = useState<Step>(initialStep);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "notice" } | null>(
    notice ? { text: notice, tone: "notice" } : null,
  );
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [lowCodes, setLowCodes] = useState<{ remaining: number; redirectTo: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Opened /login while already signed in: go home. Only the value at first render counts;
  // during a flow, the re-render triggered by a new session cookie must not navigate away
  // before the flow has shown what it needs to (e.g. the low-recovery-codes warning).
  const homeOnArrival = useRef(signedInHome);
  useEffect(() => {
    if (homeOnArrival.current) router.replace(homeOnArrival.current);
  }, [router]);

  // Move focus to the new step's heading so keyboard and screen-reader users land in context.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, lowCodes]);

  async function run(action: () => Promise<Result>, onOk: (data: { stage: string; redirectTo: string }) => void) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result.ok) return onOk(result.data);
      if (RESTART_CODES.includes(result.code) && step !== "credentials") {
        setCode("");
        setStep("credentials");
      }
      setMessage({ text: result.message || t("auth.error.sessionExpired"), tone: "error" });
    } catch {
      // The request itself failed: the server can't be reached.
      reportUnreachable();
      setMessage({ text: t("auth.error.serverUnavailable"), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  function proceed(data: { stage: string; redirectTo: string }) {
    if (data.stage === "mfa_pending") {
      setCode("");
      setStep("totp");
    } else {
      router.replace(data.redirectTo);
    }
  }

  async function onCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const identifier = String(data.get("identifier") ?? "");
    const password = String(data.get("password") ?? "");
    await run(() => signIn({ identifier, password }), proceed);
    // Never keep a typed password around after an attempt.
    const passwordInput = form.elements.namedItem("password");
    if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
  }

  async function onTotp(value: string) {
    if (value.length !== 6 || busy) return;
    await run(() => submitTotpCode({ code: value }), proceed);
    setCode("");
  }

  async function onRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("recovery") ?? "");
    await run(
      () => submitRecoveryCode({ code: value }),
      (data) => {
        const remaining = (data as { remaining?: number }).remaining ?? 99;
        if (remaining <= 2) setLowCodes({ remaining, redirectTo: data.redirectTo });
        else proceed(data);
      },
    );
  }

  async function backToStart() {
    await cancelSignIn().catch(() => undefined);
    setCode("");
    setMessage(null);
    setStep("credentials");
  }

  if (connection === "server_unreachable") return <ServerUnreachable />;

  if (lowCodes) {
    return (
      <div>
        <StepHeading ref={heading} title={t("auth.verify.recoveryTitle")} />
        <FormMessage tone="notice" message={tPlural("auth.verify.lowCodes", lowCodes.remaining)} />
        <Button size="block" className="mt-6" onClick={() => router.replace(lowCodes.redirectTo)}>
          {t("auth.enroll.continue")}
        </Button>
      </div>
    );
  }

  if (step === "credentials") {
    return (
      <form onSubmit={onCredentials} noValidate={false} aria-describedby="signin-message">
        <StepHeading
          ref={heading}
          step={{ number: 1, label: t("auth.signIn.step1") }}
          title={t("auth.signIn.title")}
          intro={t("auth.signIn.intro")}
        />
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="identifier">{t("auth.signIn.identifier")}</Label>
            <Input
              id="identifier"
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("auth.signIn.password")}</Label>
            <PasswordField id="password" name="password" autoComplete="current-password" required />
          </div>
          <FormMessage id="signin-message" message={message?.text ?? null} tone={message?.tone} />
          <Button type="submit" size="block" disabled={busy}>
            {busy ? t("auth.signIn.submitting") : t("auth.signIn.submit")}
          </Button>
        </div>
      </form>
    );
  }

  if (step === "totp") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onTotp(code);
        }}
      >
        <StepHeading
          ref={heading}
          step={{ number: 2, label: t("auth.verify.step") }}
          title={t("auth.verify.title")}
          intro={t("auth.verify.intro")}
        />
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="code">{t("auth.verify.code")}</Label>
            <p id="code-hint" className="text-sm text-muted">
              {t("auth.verify.codeHint")}
            </p>
          </div>
          <CodeInput
            id="code"
            value={code}
            onChange={setCode}
            onComplete={(value) => void onTotp(value)}
            describedBy="code-hint totp-message"
            invalid={message?.tone === "error"}
            disabled={busy}
          />
          <FormMessage id="totp-message" message={message?.text ?? null} tone={message?.tone} />
          <Button type="submit" size="block" disabled={busy || code.length !== 6}>
            {t("auth.verify.submit")}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={backToStart}>
              <ArrowLeft aria-hidden="true" />
              {t("auth.verify.back")}
            </Button>
            <Button variant="ghost" onClick={() => setCode("")} disabled={code.length === 0}>
              {t("auth.verify.clear")}
            </Button>
          </div>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setMessage(null);
              setStep("recovery");
            }}
          >
            {t("auth.verify.useRecovery")}
          </Button>
          <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted">
            <Lock aria-hidden="true" className="size-4 shrink-0" />
            {t("auth.verify.neverShare")}
          </p>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onRecovery}>
      <StepHeading
        ref={heading}
        step={{ number: 2, label: t("auth.verify.step") }}
        title={t("auth.verify.recoveryTitle")}
        intro={t("auth.verify.recoveryIntro")}
      />
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="recovery">{t("auth.verify.recoveryLabel")}</Label>
          <p id="recovery-hint" className="text-sm text-muted">
            {t("auth.verify.recoveryHint")}
          </p>
          <Input
            id="recovery"
            name="recovery"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby="recovery-hint recovery-message"
            className="font-mono uppercase tracking-wider"
            required
          />
        </div>
        <FormMessage id="recovery-message" message={message?.text ?? null} tone={message?.tone} />
        <Button type="submit" size="block" disabled={busy}>
          {t("auth.verify.recoverySubmit")}
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => {
            setMessage(null);
            setStep("totp");
          }}
        >
          {t("auth.verify.useApp")}
        </Button>
      </div>
    </form>
  );
}
