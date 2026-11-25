"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/FormMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnection } from "@/components/connection/ConnectionProvider";
import { t } from "@/lib/i18n";
import { uuidv7 } from "@/lib/ids";
import type { Role } from "@/server/permissions/roles";
import { createAccount } from "../../actions";
import { RolePicker } from "../../_components/RolePicker";

type Created = { userId: string; temporaryPassword: string; name: string };

export function NewUserForm() {
  const router = useRouter();
  const { reportUnreachable } = useConnection();
  // One id per form: a retried submit is the same request, so it can't create a second account.
  const [id] = useState(() => uuidv7());
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [handedOver, setHandedOver] = useState(false);
  const createdHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (created) createdHeading.current?.focus();
  }, [created]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const displayName = String(data.get("displayName") ?? "");
    setBusy(true);
    setError(null);
    try {
      const result = await createAccount({
        id,
        staffId: String(data.get("staffId") ?? ""),
        displayName,
        email: email === "" ? null : email,
        roles,
      });
      if (result.ok) setCreated({ ...result.data, name: displayName.trim() });
      else setError(result.message);
    } catch {
      reportUnreachable();
      setError(t("auth.error.serverUnavailable"));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <section aria-labelledby="created-title" className="space-y-4 rounded-md border border-border bg-surface p-6">
        <h2 id="created-title" ref={createdHeading} tabIndex={-1} className="text-2xl font-bold">
          {t("users.new.createdTitle")}
        </h2>
        <p>{t("users.new.createdIntro", { name: created.name })}</p>
        <p>
          <span className="block text-sm font-semibold text-muted">{t("users.new.tempPassword")}</span>
          <span className="font-mono text-2xl tracking-wider select-all">{created.temporaryPassword}</span>
        </p>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={handedOver}
            onChange={(event) => setHandedOver(event.target.checked)}
            className="size-6 accent-primary"
          />
          <span className="font-semibold text-heading">{t("users.new.handedOver")}</span>
        </label>
        <Button disabled={!handedOver} onClick={() => router.replace(`/admin/users/${created.userId}`)}>
          {t("users.new.done")}
        </Button>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="staffId">{t("users.field.staffId")}</Label>
        <p id="staffId-hint" className="text-sm text-muted">
          {t("users.field.staffIdHint")}
        </p>
        <Input id="staffId" name="staffId" autoComplete="off" required maxLength={64} aria-describedby="staffId-hint" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="displayName">{t("users.field.name")}</Label>
        <Input id="displayName" name="displayName" autoComplete="off" required maxLength={120} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("users.field.email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="off" maxLength={254} />
      </div>
      <RolePicker name="roles" selected={roles} onChange={setRoles} disabled={busy} />
      <FormMessage id="new-user-message" message={error} />
      <Button type="submit" disabled={busy || roles.length === 0}>
        {t("users.new.submit")}
      </Button>
    </form>
  );
}
