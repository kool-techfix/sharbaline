"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/FormMessage";
import { PasswordField } from "@/components/PasswordField";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { t } from "@/lib/i18n";
import { submitNewPassword } from "../../actions";
import { ServerUnreachable } from "../../_components/ServerUnreachable";
import { StepHeading } from "../../_components/StepHeading";

export function ChangePasswordForm() {
  const router = useRouter();
  const { state: connection, reportUnreachable } = useConnection();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== String(data.get("confirmPassword") ?? "")) {
      setError(t("auth.password.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await submitNewPassword({ newPassword });
      if (result.ok) return router.replace(result.data.redirectTo);
      if (result.code === "session_invalid") return router.replace("/login");
      setError(result.message);
    } catch {
      reportUnreachable();
      setError(t("auth.error.serverUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  if (connection === "server_unreachable") return <ServerUnreachable />;

  return (
    <form onSubmit={onSubmit}>
      <StepHeading title={t("auth.changePassword.title")} intro={t("auth.changePassword.intro")} />
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="newPassword">{t("auth.changePassword.new")}</Label>
          <p id="new-password-hint" className="text-sm text-muted">
            {t("auth.changePassword.hint")}
          </p>
          <PasswordField
            id="newPassword"
            name="newPassword"
            autoComplete="new-password"
            aria-describedby="new-password-hint change-message"
            minLength={10}
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("auth.changePassword.confirm")}</Label>
          <PasswordField id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
        </div>
        <FormMessage id="change-message" message={error} />
        <Button type="submit" size="block" disabled={busy}>
          {t("auth.changePassword.submit")}
        </Button>
      </div>
    </form>
  );
}
