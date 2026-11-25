import { t } from "@/lib/i18n";
import type { Role } from "@/server/permissions/roles";

const ALL_ROLES: Role[] = ["front_desk", "nurse", "doctor", "lab", "pharmacist", "admin"];

/** Role checkboxes as one fieldset: a single choice point, keyboard-friendly, 44px rows. */
export function RolePicker({
  name,
  selected,
  onChange,
  describedBy,
  disabled,
}: {
  name: string;
  selected: Role[];
  onChange: (roles: Role[]) => void;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={describedBy}>
      <legend className="text-base font-semibold text-heading">{t("users.field.roles")}</legend>
      <p id={`${name}-hint`} className="text-sm text-muted">
        {t("users.field.rolesHint")}
      </p>
      <div className="grid gap-1 sm:grid-cols-2">
        {ALL_ROLES.map((role) => (
          <label key={role} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-primary-soft">
            <input
              type="checkbox"
              name={name}
              value={role}
              checked={selected.includes(role)}
              disabled={disabled}
              onChange={(event) =>
                onChange(event.target.checked ? [...selected, role] : selected.filter((r) => r !== role))
              }
              className="size-5 accent-primary"
            />
            <span>{t(`role.${role}`)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
