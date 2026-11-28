/**
 * Synthetic e2e accounts, seeded by scripts/e2e/server.ts into a throwaway database.
 * One account per scenario: TOTP replay protection and lockout are per account, so sharing
 * accounts between tests would make them interfere.
 */
export const E2E_PASSWORD = "e2e synthetic only";
/**
 * Short enough for the idle-lock test, long enough that a slow laptop's server round trip plus
 * an accessibility scan (no input meanwhile) doesn't lock the screen mid-test.
 */
export const E2E_IDLE_SECONDS = 25;

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
  frontDeskRegister: { staffId: "e2e.desk.register", displayName: "E2E Desk Register", role: "front_desk", enrolled: false },
  frontDeskDuplicate: { staffId: "e2e.desk.duplicate", displayName: "E2E Desk Duplicate", role: "front_desk", enrolled: false },
  frontDeskSearch: { staffId: "e2e.desk.search", displayName: "E2E Desk Search", role: "front_desk", enrolled: false },
  labNoDesk: { staffId: "e2e.lab", displayName: "E2E Lab", role: "lab", enrolled: false },
  /** Signs in once in global setup, so the first real test doesn't pay the cold-start cost. */
  warmup: { staffId: "e2e.warmup", displayName: "E2E Warm-up", role: "front_desk", enrolled: false },
  adminEnrolled: { staffId: "e2e.admin", displayName: "E2E Admin", role: "admin", enrolled: true },
  adminBreakGlass: { staffId: "e2e.admin.bg", displayName: "E2E Admin Breaker", role: "admin", enrolled: true },
  adminReviewer: { staffId: "e2e.admin.review", displayName: "E2E Admin Reviewer", role: "admin", enrolled: true },
  nurseVisits: { staffId: "e2e.nurse.visits", displayName: "E2E Visits Nurse", role: "nurse", enrolled: false },
  nurseMfaSetup: { staffId: "e2e.nurse.mfa", displayName: "E2E MFA Nurse", role: "nurse", enrolled: false },
  nurseAndLab: {
    staffId: "e2e.nurse.lab",
    displayName: "E2E Nurse Lab",
    role: "nurse",
    extraRoles: ["lab"],
    enrolled: false,
  },
} as const;

/** Known recovery codes for e2e.doctor2. */
export const E2E_RECOVERY_CODES = ["7K2QM-X9D4P", "H3NWB-6RT8C"];

/** A synthetic patient seeded for the break-glass test (made-up name, no other test uses it). */
export const E2E_PATIENT = { surname: "Kolavendu", firstName: "Temisaro", dateOfBirth: "1968-05-09" };

/** A synthetic patient seeded into today's queue for the nurse test (made-up name, no other test uses it). */
export const E2E_NURSE_PATIENT = { surname: "Abiodara", firstName: "Kesiena", dateOfBirth: "1991-02-14" };
