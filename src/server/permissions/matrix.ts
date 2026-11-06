import type { Role } from "./roles";

/**
 * Role permissions: the code form of the matrix in docs/scope.md §4.1. Change both together.
 *
 * This answers "may this ROLE perform this ACTION on this KIND of resource at all".
 * Qualifiers in the scope are enforced by the service that owns the resource, on top of this:
 *   - pharmacist demographics read: limited fields only (name, age, sex, ID, allergies) — D-004
 *   - lab demographics read: basic identity only (name, age, sex, ID) — D-008
 *   - doctor stock read: availability only
 *   - prescriptions amend: only while the item is pending — D-009
 *   - scanned documents void: front_desk/nurse only their own uploads; admin any — D-009
 *   - admin clinical access: only via break-glass, never via this matrix
 */
export const PERMISSIONS = {
  patient_demographics: {
    create: ["front_desk"],
    read: ["front_desk", "nurse", "doctor", "lab", "pharmacist", "admin"],
    update: ["front_desk", "doctor"],
  },
  allergies: {
    create: ["nurse", "doctor"],
    read: ["front_desk", "nurse", "doctor", "lab", "pharmacist"],
    correct: ["nurse", "doctor"],
  },
  consultation_notes: {
    create: ["doctor"],
    read: ["nurse", "doctor"],
    update: ["doctor"],
  },
  vitals: {
    create: ["nurse"],
    read: ["nurse", "doctor"],
    correct: ["nurse"],
  },
  test_orders: {
    create: ["doctor"],
    read: ["nurse", "doctor", "lab"],
    update: ["lab"],
  },
  test_results: {
    create: ["lab"],
    read: ["nurse", "doctor", "lab"],
    update: ["lab"],
  },
  prescriptions: {
    create: ["doctor"],
    read: ["nurse", "doctor", "pharmacist"],
    amend: ["doctor"],
    dispense: ["pharmacist"],
  },
  allergy_override_acks: {
    create: ["pharmacist"],
    read: ["pharmacist"],
  },
  stock: {
    create: ["pharmacist"],
    read: ["nurse", "doctor", "pharmacist", "admin"],
    update: ["pharmacist"],
  },
  stock_corrections: {
    create: ["pharmacist"],
    read: ["pharmacist", "admin"],
    review: ["admin"],
  },
  scanned_documents: {
    create: ["front_desk", "nurse"],
    read: ["front_desk", "nurse", "doctor"],
    read_metadata: ["front_desk", "nurse", "doctor", "admin"],
    void: ["front_desk", "nurse", "admin"],
    restore: ["admin"],
  },
  users: {
    create: ["admin"],
    read: ["admin"],
    update: ["admin"],
  },
  audit_log: {
    read: ["admin"],
  },
  system_status: {
    read: ["admin"],
  },
} as const satisfies Record<string, Record<string, readonly Role[]>>;

export type Resource = keyof typeof PERMISSIONS;
export type ActionOf<R extends Resource> = keyof (typeof PERMISSIONS)[R] & string;
export type Permission = { [R in Resource]: { resource: R; action: ActionOf<R> } }[Resource];

export function can(role: Role, permission: Permission): boolean {
  const actions = PERMISSIONS[permission.resource] as Record<string, readonly Role[]>;
  return actions[permission.action]?.includes(role) ?? false;
}
