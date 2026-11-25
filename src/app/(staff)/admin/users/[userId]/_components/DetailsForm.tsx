"use client";

import type { FormEvent } from "react";
import { FormMessage } from "@/components/FormMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { saveDetails } from "../../actions";
import { useAction } from "./useAction";

export function DetailsForm({ userId, displayName, email }: { userId: string; displayName: string; email: string | null }) {
  const { busy, message, run } = useAction();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newEmail = String(data.get("email") ?? "").trim();
    void run(
      () => saveDetails({ userId, displayName: String(data.get("displayName") ?? ""), email: newEmail || null }),
      () => t("users.details.saved"),
    );
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby="details-title" className="space-y-4">
      <h2 id="details-title" className="text-xl font-bold">
        {t("users.details.title")}
      </h2>
      <div className="space-y-2">
        <Label htmlFor="displayName">{t("users.field.name")}</Label>
        <Input id="displayName" name="displayName" defaultValue={displayName} required maxLength={120} autoComplete="off" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("users.field.email")}</Label>
        <Input id="email" name="email" type="email" defaultValue={email ?? ""} maxLength={254} autoComplete="off" />
      </div>
      <FormMessage message={message?.text ?? null} tone={message?.tone} />
      <Button type="submit" variant="secondary" disabled={busy}>
        {t("users.details.save")}
      </Button>
    </form>
  );
}
