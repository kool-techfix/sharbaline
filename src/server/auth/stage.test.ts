import { describe, expect, it } from "vitest";
import { mfaRequired, nextStage, pathForStage, primaryRole } from "./stage";
import { sessionStatus, type SessionFacts } from "./session-rules";

describe("sign-in stages", () => {
  const base = { mfaEnrolled: false, mfaVerified: false, mustChangePassword: false };

  it("requires MFA when any of the user's roles does", () => {
    expect(mfaRequired(["nurse"])).toBe(false);
    expect(mfaRequired(["nurse", "pharmacist"])).toBe(true);
  });

  it("asks an enrolled user for the second factor before anything else", () => {
    expect(nextStage({ ...base, roles: ["doctor"], mfaEnrolled: true, mustChangePassword: true })).toBe("mfa_pending");
    expect(nextStage({ ...base, roles: ["nurse"], mfaEnrolled: true })).toBe("mfa_pending");
  });

  it("then a temporary password change, then forced enrollment", () => {
    expect(nextStage({ ...base, roles: ["doctor"], mustChangePassword: true })).toBe("password_change_required");
    expect(nextStage({ ...base, roles: ["doctor"] })).toBe("mfa_enrollment_required");
    expect(nextStage({ ...base, roles: ["front_desk"] })).toBe("active");
    expect(nextStage({ ...base, roles: ["admin"], mfaEnrolled: true, mfaVerified: true })).toBe("active");
  });

  it("lands multi-role users on their highest-priority role", () => {
    expect(primaryRole(["front_desk", "doctor"])).toBe("doctor");
    expect(primaryRole([])).toBeNull();
    expect(pathForStage("active", "pharmacist")).toBe("/pharmacy");
    expect(pathForStage("mfa_enrollment_required", "doctor")).toBe("/mfa/enroll");
  });
});

describe("session status", () => {
  const now = new Date("2026-11-06T09:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  const active: SessionFacts = {
    stage: "active",
    stageExpiresAt: null,
    expiresAt: new Date(now.getTime() + 3_600_000),
    revokedAt: null,
    lockedAt: null,
    lastActivityAt: minutesAgo(1),
    userDisabledAt: null,
  };
  const idleMs = 600_000;

  it("is active with recent activity", () => {
    expect(sessionStatus(active, now, idleMs)).toBe("active");
  });

  it("goes idle only after the timeout plus the server grace period", () => {
    expect(sessionStatus({ ...active, lastActivityAt: minutesAgo(10.5) }, now, idleMs)).toBe("active");
    expect(sessionStatus({ ...active, lastActivityAt: minutesAgo(11.1) }, now, idleMs)).toBe("idle");
  });

  it("treats revoked, disabled and expired as signed out, before anything else", () => {
    expect(sessionStatus({ ...active, revokedAt: now }, now, idleMs)).toBe("revoked");
    expect(sessionStatus({ ...active, userDisabledAt: now, lockedAt: now }, now, idleMs)).toBe("disabled");
    expect(sessionStatus({ ...active, expiresAt: now }, now, idleMs)).toBe("expired");
  });

  it("gives half-finished sign-ins a deadline", () => {
    const pending = { ...active, stage: "mfa_pending" as const, stageExpiresAt: new Date(now.getTime() + 1000) };
    expect(sessionStatus(pending, now, idleMs)).toBe("pending_stage");
    expect(sessionStatus({ ...pending, stageExpiresAt: now }, now, idleMs)).toBe("stage_expired");
  });

  it("reports a lock", () => {
    expect(sessionStatus({ ...active, lockedAt: now }, now, idleMs)).toBe("locked");
  });
});
