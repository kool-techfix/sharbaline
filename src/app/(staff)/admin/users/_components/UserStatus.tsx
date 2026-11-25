import { CircleCheck, CircleSlash, KeyRound, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import { t } from "@/lib/i18n";
import type { Role } from "@/server/permissions/roles";
import { MFA_REQUIRED_ROLES } from "@/server/permissions/roles";

/** Status as chips with icon and text (never colour alone). */
export function UserStatus({
  user,
}: {
  user: { disabled: boolean; locked: boolean; mfa: "enrolled" | "not_enrolled"; roles: Role[]; mustChangePassword?: boolean };
}) {
  const mfaRequired = user.roles.some((role) => (MFA_REQUIRED_ROLES as readonly Role[]).includes(role));
  return (
    <span className="flex flex-wrap gap-2">
      {user.disabled ? (
        <StatusChip tone="neutral" icon={CircleSlash}>{t("users.status.disabled")}</StatusChip>
      ) : (
        <StatusChip tone="success" icon={CircleCheck}>{t("users.status.active")}</StatusChip>
      )}
      {user.locked ? <StatusChip tone="danger" icon={Lock}>{t("users.status.locked")}</StatusChip> : null}
      {user.mfa === "enrolled" ? (
        <StatusChip tone="info" icon={ShieldCheck}>{t("users.status.mfaOn")}</StatusChip>
      ) : mfaRequired ? (
        <StatusChip tone="warning" icon={ShieldAlert}>{t("users.status.mfaMissing")}</StatusChip>
      ) : (
        <StatusChip tone="neutral">{t("users.status.mfaOff")}</StatusChip>
      )}
      {user.mustChangePassword ? (
        <StatusChip tone="warning" icon={KeyRound}>{t("users.status.mustChange")}</StatusChip>
      ) : null}
    </span>
  );
}
