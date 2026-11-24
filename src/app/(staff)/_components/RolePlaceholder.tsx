import { t } from "@/lib/i18n";
import type { Role } from "@/server/permissions/roles";
import { requireRole } from "@/server/http/guard";

/** Landing page for a role until its workspace is built. Server-checked: other roles are redirected. */
export async function RolePlaceholder({ role }: { role: Role }) {
  const session = await requireRole(role);
  return (
    <section aria-labelledby="welcome">
      <h1 id="welcome" className="text-3xl font-bold">
        {t("staff.placeholderTitle", { name: session.user.displayName })}
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        {t("staff.placeholderBody", { role: t(`role.${role}`) })}
      </p>
    </section>
  );
}
