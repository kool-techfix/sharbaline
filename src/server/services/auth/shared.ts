import "server-only";
import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import type { Tx } from "@/server/db/tx";
import type { AuditActor } from "@/server/kernel/outcome";
import type { Role } from "@/server/permissions/roles";
import { isEmailIdentifier } from "@/server/auth/identifiers";
import { EMPTY_THROTTLE, type ThrottleState } from "@/server/auth/lockout";
import { AUTH_POLICY } from "@/server/auth/policy";
import { nextStage, pathForStage, type SessionStage } from "@/server/auth/stage";
import { SESSION_TOKEN_PATTERN, hashSessionToken, newSessionToken } from "@/server/auth/tokens";

/** Session token as it arrives from the cookie. Never logged or audited. */
export const sessionTokenSchema = z.string().regex(SESSION_TOKEN_PATTERN);

const userInclude = {
  roles: true,
  mfaSecrets: { where: { status: "active" as const } },
} as const;

export interface LoadedUser {
  id: string;
  staffId: string;
  email: string | null;
  displayName: string;
  passwordHash: string;
  mustChangePassword: boolean;
  disabledAt: Date | null;
  roles: Role[];
  activeMfa: {
    id: string;
    secretCiphertext: Uint8Array;
    secretIv: Uint8Array;
    keyVersion: number;
    lastUsedStep: bigint | null;
  } | null;
}

type UserRow = NonNullable<Awaited<ReturnType<typeof findUserRow>>>;

function findUserRow(tx: Tx, where: { id: string } | { staffId: string } | { email: string }) {
  return tx.user.findUnique({ where, include: userInclude });
}

function toLoadedUser(row: UserRow): LoadedUser {
  const mfa = row.mfaSecrets[0];
  return {
    id: row.id,
    staffId: row.staffId,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    mustChangePassword: row.mustChangePassword,
    disabledAt: row.disabledAt,
    roles: row.roles.map((r) => r.role),
    activeMfa: mfa
      ? {
          id: mfa.id,
          secretCiphertext: mfa.secretCiphertext,
          secretIv: mfa.secretIv,
          keyVersion: mfa.keyVersion,
          lastUsedStep: mfa.lastUsedStep,
        }
      : null,
  };
}

export async function findUserByIdentifier(tx: Tx, normalized: string): Promise<LoadedUser | null> {
  const row = await findUserRow(tx, isEmailIdentifier(normalized) ? { email: normalized } : { staffId: normalized });
  return row ? toLoadedUser(row) : null;
}

export async function findUserById(tx: Tx, id: string): Promise<LoadedUser | null> {
  const row = await findUserRow(tx, { id });
  return row ? toLoadedUser(row) : null;
}

export function auditActorFor(user: LoadedUser, role: Role | null, sessionId: string | null): AuditActor {
  return { userId: user.id, role, sessionId };
}

// ─── Throttle rows (locked FOR UPDATE so concurrent attempts are counted one at a time) ───

export type ThrottleKey = Uint8Array<ArrayBuffer>;

export async function lockThrottle(tx: Tx, key: ThrottleKey): Promise<ThrottleState> {
  await tx.$executeRaw`INSERT INTO login_throttle (key_hash) VALUES (${key}) ON CONFLICT (key_hash) DO NOTHING`;
  const rows = await tx.$queryRaw<
    { failed_count: number; first_failed_at: Date | null; locked_until: Date | null }[]
  >`SELECT failed_count, first_failed_at, locked_until FROM login_throttle WHERE key_hash = ${key} FOR UPDATE`;
  const row = rows[0];
  return row
    ? { failedCount: row.failed_count, firstFailedAt: row.first_failed_at, lockedUntil: row.locked_until }
    : EMPTY_THROTTLE;
}

export async function saveThrottle(tx: Tx, key: ThrottleKey, state: ThrottleState, now: Date): Promise<void> {
  await tx.loginThrottle.update({
    where: { keyHash: key },
    data: {
      failedCount: state.failedCount,
      firstFailedAt: state.firstFailedAt,
      lockedUntil: state.lockedUntil,
      updatedAt: now,
    },
  });
}

export async function clearThrottle(tx: Tx, key: ThrottleKey, now: Date): Promise<void> {
  await saveThrottle(tx, key, EMPTY_THROTTLE, now);
}

// ─── Sessions ───

export interface LockedSession {
  id: string;
  userId: string;
  activeRole: Role;
  stage: SessionStage;
  stageExpiresAt: Date | null;
  mfaVerifiedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  lockedAt: Date | null;
  lastActivityAt: Date;
  unlockFailures: number;
  user: LoadedUser;
}

/** Find a session by its token and lock its row for the rest of the transaction. */
export async function lockSessionByToken(tx: Tx, token: string): Promise<LockedSession | null> {
  const hash = hashSessionToken(token);
  const ids = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM session WHERE token_hash = ${hash} FOR UPDATE`;
  const id = ids[0]?.id;
  if (!id) return null;
  const row = await tx.session.findUnique({ where: { id }, include: { user: { include: userInclude } } });
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    activeRole: row.activeRole,
    stage: row.stage,
    stageExpiresAt: row.stageExpiresAt,
    mfaVerifiedAt: row.mfaVerifiedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lockedAt: row.lockedAt,
    lastActivityAt: row.lastActivityAt,
    unlockFailures: row.unlockFailures,
    user: toLoadedUser(row.user),
  };
}

export function stageDeadline(stage: SessionStage, now: Date): Date | null {
  if (stage === "active") return null;
  const ms =
    stage === "mfa_enrollment_required" ? AUTH_POLICY.session.enrollmentStageMs : AUTH_POLICY.session.stageMs;
  return new Date(now.getTime() + ms);
}

export async function upsertDevice(tx: Tx, deviceId: string, userAgent: string | null, now: Date): Promise<void> {
  await tx.device.upsert({
    where: { id: deviceId },
    create: { id: deviceId, userAgent, firstSeenAt: now, lastSeenAt: now },
    update: { lastSeenAt: now, userAgent },
  });
}

export async function createSession(
  tx: Tx,
  args: {
    userId: string;
    role: Role;
    stage: SessionStage;
    deviceId: string | null;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  },
): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const sessionId = uuidv7();
  const expiresAt = new Date(args.now.getTime() + AUTH_POLICY.session.absoluteMs);
  await tx.session.create({
    data: {
      id: sessionId,
      tokenHash: hashSessionToken(token),
      userId: args.userId,
      deviceId: args.deviceId,
      activeRole: args.role,
      stage: args.stage,
      stageExpiresAt: stageDeadline(args.stage, args.now),
      ip: args.ip,
      userAgent: args.userAgent,
      createdAt: args.now,
      lastActivityAt: args.now,
      lastSeenAt: args.now,
      expiresAt,
    },
  });
  return { sessionId, token, expiresAt };
}

export interface StageResult {
  stage: SessionStage;
  token: string;
  redirectTo: string;
  expiresAt: Date;
}

/**
 * Move a session to whatever comes next after a completed step, issuing a NEW token (the old
 * one stops working), so a token captured before a step can't be used after it.
 */
export async function advanceSession(
  tx: Tx,
  session: LockedSession,
  facts: { mfaEnrolled: boolean; mfaVerified: boolean; mustChangePassword: boolean },
  now: Date,
): Promise<StageResult> {
  const stage = nextStage({ roles: session.user.roles, ...facts });
  const token = newSessionToken();
  await tx.session.update({
    where: { id: session.id },
    data: {
      tokenHash: hashSessionToken(token),
      stage,
      stageExpiresAt: stageDeadline(stage, now),
      ...(facts.mfaVerified && !session.mfaVerifiedAt ? { mfaVerifiedAt: now } : {}),
      ...(stage === "active" ? { lastActivityAt: now } : {}),
      lastSeenAt: now,
    },
  });
  return { stage, token, redirectTo: pathForStage(stage, session.activeRole), expiresAt: session.expiresAt };
}

export async function revokeSession(tx: Tx, sessionId: string, reason: string, now: Date, byUserId?: string) {
  await tx.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason, revokedById: byUserId ?? null },
  });
}

export async function revokeUserSessions(
  tx: Tx,
  userId: string,
  reason: string,
  now: Date,
  options: { exceptSessionId?: string; byUserId?: string } = {},
): Promise<number> {
  const { count } = await tx.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: now, revokedReason: reason, revokedById: options.byUserId ?? null },
  });
  return count;
}
