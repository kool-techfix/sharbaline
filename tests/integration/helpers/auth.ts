import { randomBytes } from "node:crypto";
import { uuidv7 } from "@/lib/ids";
import { withTransaction } from "@/server/db/tx";
import { authHmacKey, mfaEncryptionKey } from "@/server/auth/keys";
import { encryptSecret } from "@/server/auth/mfa-crypto";
import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from "@/server/auth/recovery-codes";
import { codeForStep, newTotpSecret, timeStep } from "@/server/auth/totp";
import type { Role } from "@/server/permissions/roles";
import { insertUser } from "@/server/services/users/shared";
import type { TestDatabase } from "./db";

/** Synthetic users only (CLAUDE.md rule 1). */
export const TEST_PASSWORD = "correct horse battery";

export interface TestUser {
  id: string;
  staffId: string;
  password: string;
}

export async function makeUser(
  t: TestDatabase,
  options: { roles: Role[]; mustChangePassword?: boolean; disabled?: boolean; password?: string },
): Promise<TestUser> {
  const staffId = `test.${randomBytes(4).toString("hex")}`;
  const password = options.password ?? TEST_PASSWORD;
  const id = await withTransaction(t.db, (tx) =>
    insertUser(
      tx,
      {
        staffId,
        email: `${staffId}@hospital.test`,
        displayName: "Test Staff",
        roles: options.roles,
        password,
        mustChangePassword: options.mustChangePassword ?? false,
      },
      new Date(),
    ),
  );
  if (options.disabled) await t.ownerPool.query("UPDATE \"user\" SET disabled_at = now() WHERE id = $1", [id]);
  return { id, staffId, password };
}

/** Give a user an active authenticator and recovery codes, as if they had enrolled. */
export async function enrollTotp(
  t: TestDatabase,
  userId: string,
): Promise<{ secret: Buffer; recoveryCodes: string[] }> {
  const secret = newTotpSecret();
  const { key, version } = mfaEncryptionKey();
  const encrypted = encryptSecret(key, version, userId, secret);
  const mfaId = uuidv7();
  const recoveryCodes = Array.from({ length: 8 }, generateRecoveryCode);
  await t.db.mfaSecret.create({
    data: {
      id: mfaId,
      userId,
      status: "active",
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      keyVersion: version,
      confirmedAt: new Date(),
    },
  });
  await t.db.recoveryCode.createMany({
    data: recoveryCodes.map((code) => ({
      id: uuidv7(),
      userId,
      mfaSecretId: mfaId,
      codeHash: hashRecoveryCode(authHmacKey(), userId, normalizeRecoveryCode(code)),
    })),
  });
  return { secret, recoveryCodes };
}

export function totpNow(secret: Buffer, stepOffset = 0): string {
  return codeForStep(secret, timeStep(Date.now()) + stepOffset);
}

export async function auditFor(t: TestDatabase, requestId: string) {
  const { rows } = await t.appPool.query(
    `SELECT action, outcome, reason_code, actor_user_id, actor_role, session_id, resource_id, metadata
       FROM audit_log WHERE request_id = $1 ORDER BY seq`,
    [requestId],
  );
  return rows as {
    action: string;
    outcome: string;
    reason_code: string | null;
    actor_user_id: string | null;
    actor_role: string | null;
    session_id: string | null;
    resource_id: string | null;
    metadata: Record<string, unknown>;
  }[];
}
