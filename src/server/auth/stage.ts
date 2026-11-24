import type { Role } from "@/server/permissions/roles";
import { MFA_REQUIRED_ROLES } from "@/server/permissions/roles";

export type SessionStage =
  | "mfa_pending"
  | "password_change_required"
  | "mfa_enrollment_required"
  | "active";

export interface StageFacts {
  roles: readonly Role[];
  mfaEnrolled: boolean;
  mfaVerified: boolean;
  mustChangePassword: boolean;
}

/** MFA is required when ANY of the user's roles requires it (M1 proposal d). */
export function mfaRequired(roles: readonly Role[]): boolean {
  return roles.some((role) => (MFA_REQUIRED_ROLES as readonly Role[]).includes(role));
}

/**
 * What the user must do next after a successful password check. Order matters:
 *   1. prove the second factor (if enrolled) before anything else, including a password change
 *   2. replace a temporary password
 *   3. enrol in MFA if a role requires it
 */
export function nextStage(facts: StageFacts): SessionStage {
  if (facts.mfaEnrolled && !facts.mfaVerified) return "mfa_pending";
  if (facts.mustChangePassword) return "password_change_required";
  if (!facts.mfaEnrolled && mfaRequired(facts.roles)) return "mfa_enrollment_required";
  return "active";
}

/** Where each role lands after sign-in, and the order used to pick a multi-role user's first role. */
export const ROLE_HOME: Record<Role, string> = {
  admin: "/admin",
  doctor: "/doctor",
  pharmacist: "/pharmacy",
  nurse: "/nurse",
  lab: "/lab",
  front_desk: "/front-desk",
};

const LANDING_PRIORITY: readonly Role[] = ["admin", "doctor", "pharmacist", "nurse", "lab", "front_desk"];

export function primaryRole(roles: readonly Role[]): Role | null {
  return LANDING_PRIORITY.find((role) => roles.includes(role)) ?? null;
}

export const STAGE_PATH: Record<Exclude<SessionStage, "active">, string> = {
  mfa_pending: "/login",
  password_change_required: "/change-password",
  mfa_enrollment_required: "/mfa/enroll",
};

export function pathForStage(stage: SessionStage, role: Role): string {
  return stage === "active" ? ROLE_HOME[role] : STAGE_PATH[stage];
}
