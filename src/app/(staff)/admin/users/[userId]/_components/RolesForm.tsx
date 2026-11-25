"use client";

import { useState, type FormEvent } from "react";
import { FormMessage } from "@/components/FormMessage";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import type { Role } from "@/server/permissions/roles";
import { saveRoles } from "../../actions";
import { RolePicker } from "../../_components/RolePicker";
import { useAction } from "./useAction";

export function RolesForm({ userId, roles }: { userId: string; roles: Role[] }) {
  const [selected, setSelected] = useState<Role[]>(roles);
  const { busy, message, run } = useAction();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(
      () => saveRoles({ userId, roles: selected }),
      (data) => t(data.changed ? "users.roles.saved" : "users.roles.unchanged"),
    );
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby="roles-title" className="space-y-4">
      <h2 id="roles-title" className="text-xl font-bold">
        {t("users.roles.title")}
      </h2>
      <RolePicker name="roles" selected={selected} onChange={setSelected} disabled={busy} />
      <FormMessage message={message?.text ?? null} tone={message?.tone} />
      <Button type="submit" variant="secondary" disabled={busy || selected.length === 0}>
        {t("users.roles.save")}
      </Button>
    </form>
  );
}
