/**
 * Synthetic e2e accounts, seeded by scripts/e2e/server.ts into a throwaway database.
 * One account per scenario: TOTP replay protection and lockout are per account, so sharing
 * accounts between tests would make them interfere.
 */
export const E2E_PASSWORD = "e2e synthetic only";
export const E2E_IDLE_SECONDS = 8;

/** Base32 TOTP secret for enrolled e2e accounts. Test-only; never used outside e2e. */
export const E2E_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export const E2E_USERS = {
  doctorEnrolled: { staffId: "e2e.doctor", displayName: "E2E Doctor", role: "doctor", enrolled: true },
  doctorRecovery: { staffId: "e2e.doctor2", displayName: "E2E Doctor Two", role: "doctor", enrolled: true },
  pharmacistNew: { staffId: "e2e.pharmacist", displayName: "E2E Pharmacist", role: "pharmacist", enrolled: false },
  nurseKeyboard: { staffId: "e2e.nurse", displayName: "E2E Nurse", role: "nurse", enrolled: false },
  nurseIdle: { staffId: "e2e.nurse.idle", displayName: "E2E Idle Nurse", role: "nurse", enrolled: false },
  nurseLockout: { staffId: "e2e.nurse.lockout", displayName: "E2E Lockout Nurse", role: "nurse", enrolled: false },
  frontDesk: { staffId: "e2e.frontdesk", displayName: "E2E Front Desk", role: "front_desk", enrolled: false },
} as const;

/** Known recovery codes for e2e.doctor2. */
export const E2E_RECOVERY_CODES = ["7K2QM-X9D4P", "H3NWB-6RT8C"];
