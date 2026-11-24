import type { Role } from "@/generated/prisma/enums";

export type { Role };

/** Every staff role. Must equal the Prisma Role enum (checked in matrix.test.ts). */
export const ROLES = [
  "front_desk",
  "nurse",
  "doctor",
  "lab",
  "pharmacist",
  "admin",
] as const satisfies readonly Role[];

/** Roles that must use TOTP (M1 decision). */
export const MFA_REQUIRED_ROLES = ["doctor", "pharmacist", "admin"] as const satisfies readonly Role[];
