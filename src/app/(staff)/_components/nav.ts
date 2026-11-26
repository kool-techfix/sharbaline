import { t } from "@/lib/i18n";
import type { NavItem } from "@/components/Sidebar";
import { ROLE_HOME } from "@/server/auth/stage";
import type { Role } from "@/server/permissions/roles";

/**
 * Navigation for each role's workspace. Grows with each slice; every link target must itself
 * call requireRole()/requireSignedIn() (D-025), so this list is never what enforces access.
 */
export function navFor(role: Role): NavItem[] {
  if (role === "front_desk") {
    return [
      { href: "/front-desk", label: t("staff.patients") },
      { href: "/front-desk/queue", label: t("staff.queue") },
      { href: "/account", label: t("staff.account") },
    ];
  }
  if (role === "admin") {
    return [
      { href: ROLE_HOME[role], label: t("staff.home") },
      { href: "/admin/patients", label: t("staff.patients") },
      { href: "/admin/break-glass", label: t("staff.breakGlass") },
      { href: "/admin/users", label: t("staff.users") },
      { href: "/account", label: t("staff.account") },
    ];
  }
  return [
    { href: ROLE_HOME[role], label: t("staff.home") },
    { href: "/account", label: t("staff.account") },
  ];
}
