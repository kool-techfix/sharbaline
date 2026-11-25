import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import type { Role } from "@/server/permissions/roles";
import { switchRole } from "../actions";

/**
 * For staff with more than one role: shows the role in use and one button per other role.
 * A plain form post, so it works without client JavaScript; the server checks the role (D-026).
 */
export function RoleSwitcher({ roles, active }: { roles: Role[]; active: Role }) {
  if (roles.length < 2) return null;
  const others = roles.filter((role) => role !== active);
  return (
    <section aria-labelledby="role-switcher" className="flex flex-col gap-2 border-t border-border pt-4">
      <h2 id="role-switcher" className="px-3 text-sm font-semibold text-muted">
        {t("staff.roles")}
      </h2>
      <p className="px-3 text-base">{t("staff.workingAs", { role: t(`role.${active}`) })}</p>
      <form action={switchRole} className="flex flex-col gap-2">
        {others.map((role) => (
          <Button key={role} type="submit" name="role" value={role} variant="secondary">
            {t("staff.switchTo", { role: t(`role.${role}`) })}
          </Button>
        ))}
      </form>
    </section>
  );
}
