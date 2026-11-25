import { t } from "@/lib/i18n";
import type { NavItem } from "@/components/Sidebar";
import { ROLE_HOME } from "@/server/auth/stage";
import type { Role } from "@/server/permissions/roles";

/**
 * Navigation for each role's workspace. Grows with each slice; every link target must itself
 * call requireRole()/requireSignedIn() (D-025), so this list is never what enforces access.
 */
export function navFor(role: Role): NavItem[] {
  return [{ href: ROLE_HOME[role], label: t("staff.home") }];
}
