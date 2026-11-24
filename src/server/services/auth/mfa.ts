import "server-only";
import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import { writeAudit } from "@/server/audit/write";
import type { Tx } from "@/server/db/tx";
import type { RequestContext } from "@/server/kernel/context";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { throttleKey } from "@/server/auth/identifiers";
import { authHmacKey, mfaEncryptionKey, totpIssuer } from "@/server/auth/keys";
import { isLocked, registerFailure } from "@/server/auth/lockout";
import { decryptSecret, encryptSecret } from "@/server/auth/mfa-crypto";
import { AUTH_POLICY } from "@/server/auth/policy";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  isWellFormedRecoveryCode,
  normalizeRecoveryCode,
} from "@/server/auth/recovery-codes";
import { sessionStatus } from "@/server/auth/session-rules";
import { groupedKey, newTotpSecret, otpauthUri, verifyTotp } from "@/server/auth/totp";
import {
  advanceSession,
  auditActorFor,
  clearThrottle,
  lockSessionByToken,
  lockThrottle,
  revokeSession,
  saveThrottle,
  sessionTokenSchema,
  type LockedSession,
  type StageResult,
} from "./shared";

/** A session waiting for this exact step, still within its deadline. */
async function sessionAtStage(tx: Tx, token: string, stage: LockedSession["stage"], now: Date) {
  const session = await lockSessionByToken(tx, token);
  if (!session || session.stage !== stage) return null;
  const status = sessionStatus({ ...session, userDisabledAt: session.user.disabledAt }, now, Number.MAX_SAFE_INTEGER);
  return status === "pending_stage" ? session : null;
}

/**
 * Count a failed second-factor attempt against the same 5-attempt lockout as passwords
 * (M1 proposal a). Reaching the limit also ends this half-signed-in session.
 */
async function registerSecondFactorFailure<T>(
  tx: Tx,
  ctx: RequestContext,
  session: LockedSession,
  reasonCode: string,
  messageKey: "auth.error.invalidCode" | "auth.error.invalidRecoveryCode",
  now: Date,
): Promise<Outcome<T>> {
  const key = throttleKey(authHmacKey(), { userId: session.userId });
  const next = registerFailure(await lockThrottle(tx, key), now);
  await saveThrottle(tx, key, next, now);
  const actor = auditActorFor(session.user, session.activeRole, session.id);
  if (next.justLocked) {
    await revokeSession(tx, session.id, "locked", now);
    await writeAudit(
      tx,
      ctx,
      { action: "auth.lockout", outcome: "success", resourceType: "user", resourceId: session.userId },
      actor,
    );
    return fail("locked", "auth.error.locked", { auditActor: actor });
  }
  return fail(reasonCode, messageKey, { auditActor: actor, metadata: { failed_count: next.failedCount } });
}

const codeInput = z.object({ token: sessionTokenSchema, code: z.string().max(32) });

/** Step 2 of sign-in: a 6-digit code from the authenticator app. */
export const verifyTotpCode = defineService({
  action: "auth.mfa_verify",
  input: codeInput,
  permission: { public: true, reason: "Second sign-in step; the session token is the credential." },
  async run({ tx, input, ctx }): Promise<Outcome<StageResult>> {
    const now = new Date();
    const session = await sessionAtStage(tx, input.token, "mfa_pending", now);
    if (!session) return fail("session_invalid", "auth.error.sessionExpired");
    const actor = auditActorFor(session.user, session.activeRole, session.id);

    const key = throttleKey(authHmacKey(), { userId: session.userId });
    if (isLocked(await lockThrottle(tx, key), now)) {
      await revokeSession(tx, session.id, "locked", now);
      return fail("locked", "auth.error.locked", { auditActor: actor });
    }

    const mfa = session.user.activeMfa;
    if (!mfa) return fail("mfa_not_enrolled", "auth.error.sessionExpired", { auditActor: actor });
    // Lock the secret row too: two simultaneous submissions of one code must not both pass.
    const rows = await tx.$queryRaw<{ last_used_step: bigint | null }[]>`
      SELECT last_used_step FROM mfa_secret WHERE id = ${mfa.id}::uuid FOR UPDATE`;
    const lastUsedStep = rows[0]?.last_used_step ?? null;

    const { key: encKey } = mfaEncryptionKey();
    const secret = decryptSecret(encKey, session.userId, {
      ciphertext: new Uint8Array(mfa.secretCiphertext),
      iv: new Uint8Array(mfa.secretIv),
      keyVersion: mfa.keyVersion,
    });
    const check = verifyTotp(secret, input.code.trim(), now.getTime(), lastUsedStep === null ? null : Number(lastUsedStep));
    if (!check.ok) {
      return registerSecondFactorFailure(tx, ctx, session, check.reason, "auth.error.invalidCode", now);
    }

    await tx.mfaSecret.update({ where: { id: mfa.id }, data: { lastUsedStep: BigInt(check.step) } });
    await clearThrottle(tx, key, now);
    const result = await advanceSession(
      tx,
      session,
      { mfaEnrolled: true, mfaVerified: true, mustChangePassword: session.user.mustChangePassword },
      now,
    );
    return ok(result, { auditActor: actor });
  },
  audit: { resourceType: "session" },
});

/** Step 2 alternative: a one-time recovery code, for a lost or unavailable phone. */
export const redeemRecoveryCode = defineService({
  action: "auth.recovery_code",
  input: codeInput,
  permission: { public: true, reason: "Second sign-in step; the session token is the credential." },
  async run({ tx, input, ctx }): Promise<Outcome<StageResult & { remaining: number }>> {
    const now = new Date();
    const session = await sessionAtStage(tx, input.token, "mfa_pending", now);
    if (!session) return fail("session_invalid", "auth.error.sessionExpired");
    const actor = auditActorFor(session.user, session.activeRole, session.id);

    const key = throttleKey(authHmacKey(), { userId: session.userId });
    if (isLocked(await lockThrottle(tx, key), now)) {
      await revokeSession(tx, session.id, "locked", now);
      return fail("locked", "auth.error.locked", { auditActor: actor });
    }

    const mfa = session.user.activeMfa;
    const normalized = normalizeRecoveryCode(input.code);
    // One atomic UPDATE: of two simultaneous uses of the same code, exactly one succeeds.
    const used =
      mfa && isWellFormedRecoveryCode(normalized)
        ? await tx.recoveryCode.updateMany({
            where: {
              userId: session.userId,
              mfaSecretId: mfa.id,
              codeHash: hashRecoveryCode(authHmacKey(), session.userId, normalized),
              usedAt: null,
            },
            data: { usedAt: now },
          })
        : { count: 0 };
    if (used.count !== 1) {
      return registerSecondFactorFailure(tx, ctx, session, "invalid_recovery_code", "auth.error.invalidRecoveryCode", now);
    }

    const remaining = await tx.recoveryCode.count({
      where: { userId: session.userId, mfaSecretId: mfa!.id, usedAt: null },
    });
    await clearThrottle(tx, key, now);
    const result = await advanceSession(
      tx,
      session,
      { mfaEnrolled: true, mfaVerified: true, mustChangePassword: session.user.mustChangePassword },
      now,
    );
    return ok({ ...result, remaining }, { auditActor: actor });
  },
  audit: { resourceType: "session", metadata: (_input, value) => ({ remaining: value?.remaining ?? null }) },
});

export interface EnrollmentStart {
  otpauthUri: string;
  manualKey: string;
}

/** Enrollment, part 1: create a pending secret and return what the authenticator app needs. */
export const startMfaEnrollment = defineService({
  action: "auth.mfa_enroll_start",
  input: z.object({ token: sessionTokenSchema }),
  permission: { public: true, reason: "Required enrollment during sign-in; the session token is the credential." },
  async run({ tx, input }): Promise<Outcome<EnrollmentStart>> {
    const now = new Date();
    const session = await sessionAtStage(tx, input.token, "mfa_enrollment_required", now);
    if (!session) return fail("session_invalid", "auth.error.sessionExpired");

    // Only the newest setup code is valid; abandon any earlier unfinished attempt.
    await tx.mfaSecret.updateMany({
      where: { userId: session.userId, status: "pending" },
      data: { status: "revoked", revokedAt: now },
    });
    const secret = newTotpSecret();
    const { key, version } = mfaEncryptionKey();
    const encrypted = encryptSecret(key, version, session.userId, secret);
    await tx.mfaSecret.create({
      data: {
        id: uuidv7(),
        userId: session.userId,
        status: "pending",
        secretCiphertext: encrypted.ciphertext,
        secretIv: encrypted.iv,
        keyVersion: encrypted.keyVersion,
        createdAt: now,
      },
    });
    return ok(
      { otpauthUri: otpauthUri(secret, totpIssuer(), session.user.staffId), manualKey: groupedKey(secret) },
      { auditActor: auditActorFor(session.user, session.activeRole, session.id) },
    );
  },
  audit: { resourceType: "session" },
});

/** Enrollment, part 2: confirm one code, activate the secret, issue recovery codes (shown once). */
export const confirmMfaEnrollment = defineService({
  action: "auth.mfa_enroll",
  input: codeInput,
  permission: { public: true, reason: "Required enrollment during sign-in; the session token is the credential." },
  async run({ tx, input }): Promise<Outcome<StageResult & { recoveryCodes: string[] }>> {
    const now = new Date();
    const session = await sessionAtStage(tx, input.token, "mfa_enrollment_required", now);
    if (!session) return fail("session_invalid", "auth.error.sessionExpired");
    const actor = auditActorFor(session.user, session.activeRole, session.id);

    const pending = await tx.mfaSecret.findFirst({
      where: { userId: session.userId, status: "pending" },
      orderBy: { createdAt: "desc" },
    });
    if (!pending) return fail("no_pending_enrollment", "auth.error.enrollmentRestart", { auditActor: actor });

    const { key } = mfaEncryptionKey();
    const secret = decryptSecret(key, session.userId, {
      ciphertext: pending.secretCiphertext,
      iv: pending.secretIv,
      keyVersion: pending.keyVersion,
    });
    const check = verifyTotp(secret, input.code.trim(), now.getTime(), null);
    // Not counted toward lockout: the password is already proven, and the enrollment
    // deadline bounds the attempts. Typos while setting up a new app are common.
    if (!check.ok) return fail("invalid_code", "auth.error.invalidCode", { auditActor: actor });

    await tx.mfaSecret.update({
      where: { id: pending.id },
      data: { status: "active", confirmedAt: now, lastUsedStep: BigInt(check.step) },
    });
    const recoveryCodes = Array.from({ length: AUTH_POLICY.recoveryCodes.count }, generateRecoveryCode);
    await tx.recoveryCode.createMany({
      data: recoveryCodes.map((code) => ({
        id: uuidv7(),
        userId: session.userId,
        mfaSecretId: pending.id,
        codeHash: hashRecoveryCode(authHmacKey(), session.userId, normalizeRecoveryCode(code)),
        createdAt: now,
      })),
    });
    const result = await advanceSession(
      tx,
      session,
      { mfaEnrolled: true, mfaVerified: true, mustChangePassword: session.user.mustChangePassword },
      now,
    );
    return ok({ ...result, recoveryCodes }, { auditActor: actor });
  },
  audit: { resourceType: "session" },
});
