"use client";

import { useState } from "react";
import { FormMessage } from "@/components/FormMessage";
import { Button } from "@/components/ui/button";
import { t, tPlural } from "@/lib/i18n";
import { runAccountAction, type AccountAction } from "../../actions";
import { useAction } from "@/components/useAction";

type Spec = {
  action: AccountAction;
  label: "users.actions.disable" | "users.actions.enable" | "users.actions.tempPassword" | "users.actions.unlock" | "users.actions.resetMfa" | "users.actions.endSessions";
  help:
    | "users.actions.disableHelp"
    | "users.actions.enableHelp"
    | "users.actions.tempPasswordHelp"
    | "users.actions.unlockHelp"
    | "users.actions.resetMfaHelp"
    | "users.actions.endSessionsHelp";
  danger: boolean;
};

/**
 * Account actions. Each needs a second, explicit "Confirm" (inline, not a browser dialog), and
 * a temporary password is shown once in the page, never stored in the browser.
 */
export function AccountActions({
  userId,
  disabled,
  locked,
  mfaEnrolled,
  isSelf,
}: {
  userId: string;
  disabled: boolean;
  locked: boolean;
  mfaEnrolled: boolean;
  isSelf: boolean;
}) {
  const { busy, message, run } = useAction();
  const [confirming, setConfirming] = useState<AccountAction | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const specs: Spec[] = [
    disabled
      ? { action: "enable", label: "users.actions.enable", help: "users.actions.enableHelp", danger: false }
      : { action: "disable", label: "users.actions.disable", help: "users.actions.disableHelp", danger: true },
    { action: "temporary_password", label: "users.actions.tempPassword", help: "users.actions.tempPasswordHelp", danger: true },
    ...(locked ? [{ action: "unlock", label: "users.actions.unlock", help: "users.actions.unlockHelp", danger: false } as Spec] : []),
    ...(mfaEnrolled
      ? [{ action: "reset_mfa", label: "users.actions.resetMfa", help: "users.actions.resetMfaHelp", danger: true } as Spec]
      : []),
    { action: "end_sessions", label: "users.actions.endSessions", help: "users.actions.endSessionsHelp", danger: true },
  ];
  // The server refuses these for one's own account anyway; don't offer them.
  const offered = isSelf ? specs.filter((s) => s.action !== "disable" && s.action !== "reset_mfa") : specs;

  async function confirm(action: AccountAction) {
    setConfirming(null);
    setTempPassword(null);
    const data = await run(
      () => runAccountAction({ userId, action }),
      (result) => {
        switch (action) {
          case "disable":
            return t("users.actions.disabled");
          case "enable":
            return t("users.actions.enabled");
          case "temporary_password":
            return t("users.actions.tempPasswordIssued");
          case "unlock":
            return t("users.actions.unlocked");
          case "reset_mfa":
            return t("users.actions.mfaReset");
          case "end_sessions":
            return tPlural("users.actions.sessionsEnded", result.sessionsEnded ?? 0);
        }
      },
    );
    if (data?.temporaryPassword) setTempPassword(data.temporaryPassword);
  }

  return (
    <section aria-labelledby="actions-title" className="space-y-4">
      <h2 id="actions-title" className="text-xl font-bold">
        {t("users.actions.title")}
      </h2>
      <FormMessage message={message?.text ?? null} tone={message?.tone} />
      {tempPassword ? <p className="font-mono text-2xl tracking-wider select-all">{tempPassword}</p> : null}
      <ul className="space-y-4">
        {offered.map((spec) => (
          <li key={spec.action} className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0">
            <p id={`${spec.action}-help`} className="text-muted">
              {t(spec.help)}
            </p>
            {confirming === spec.action ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={spec.danger ? "danger" : "primary"}
                  disabled={busy}
                  onClick={() => void confirm(spec.action)}
                  aria-describedby={`${spec.action}-help`}
                  autoFocus
                >
                  {t("users.actions.confirm")}: {t(spec.label)}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(null)}>
                  {t("users.actions.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                className="self-start"
                disabled={busy}
                onClick={() => setConfirming(spec.action)}
                aria-describedby={`${spec.action}-help`}
              >
                {t(spec.label)}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
