/**
 * Playwright's web server: throwaway PostgreSQL + migrations + synthetic e2e accounts, then the
 * production build (`next start`). Run with `tsx --conditions=react-server` (see playwright.config.ts).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectionUrl, ensureDatabase, ensureRoles, runPrisma, startCluster } from "../db/cluster";
import { freePort } from "../db/free-port";
import {
  E2E_IDLE_SECONDS,
  E2E_PASSWORD,
  E2E_RECOVERY_CODES,
  E2E_TOTP_SECRET,
  E2E_USERS,
} from "../../tests/e2e/fixtures";

const port = Number(process.env.E2E_PORT ?? 3100);
const secret = () => randomBytes(18).toString("base64url");
const passwords = { ownerPassword: secret(), appPassword: secret() };
const dataDir = await mkdtemp(path.join(tmpdir(), "hms-e2e-"));
const pgPort = await freePort();
const cluster = await startCluster({ dataDir, port: pgPort, superuserPassword: secret(), persistent: false, quiet: true });

await ensureRoles(cluster, passwords);
await ensureDatabase(cluster, "hms_e2e");
await runPrisma(["migrate", "deploy"], connectionUrl(pgPort, "hms_owner", passwords.ownerPassword, "hms_e2e"), true);

const appEnv = {
  DATABASE_URL: connectionUrl(pgPort, "hms_app", passwords.appPassword, "hms_e2e"),
  APP_ORIGIN: `http://localhost:${port}`,
  HOSPITAL_NAME: "E2E Hospital",
  AUTH_HMAC_KEY: randomBytes(32).toString("base64"),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  MFA_ENCRYPTION_KEY_VERSION: "1",
  SESSION_IDLE_SECONDS_OVERRIDE: String(E2E_IDLE_SECONDS),
  // The server probes itself: e2e has no internet dependency, and "Online" is shown.
  INTERNET_PROBE_URL: `http://localhost:${port}/api/ping`,
  HMS_COMPONENT_GALLERY: "true",
  NEXT_TELEMETRY_DISABLED: "1",
};
Object.assign(process.env, appEnv);

// Imported after the environment is set: these modules read it.
const { Secret } = await import("otpauth");
const { createDb } = await import("@/server/db/client");
const { withTransaction } = await import("@/server/db/tx");
const { insertUser } = await import("@/server/services/users/shared");
const { authHmacKey, mfaEncryptionKey } = await import("@/server/auth/keys");
const { encryptSecret } = await import("@/server/auth/mfa-crypto");
const { hashRecoveryCode, normalizeRecoveryCode } = await import("@/server/auth/recovery-codes");
const { uuidv7 } = await import("@/lib/ids");

const db = createDb(appEnv.DATABASE_URL);
const totpSecret = Buffer.from(Secret.fromBase32(E2E_TOTP_SECRET).bytes);
for (const user of Object.values(E2E_USERS)) {
  await withTransaction(db, async (tx) => {
    const userId = await insertUser(
      tx,
      {
        staffId: user.staffId,
        email: null,
        displayName: user.displayName,
        roles: [user.role],
        password: E2E_PASSWORD,
        mustChangePassword: false,
      },
      new Date(),
    );
    if (!user.enrolled) return;
    const { key, version } = mfaEncryptionKey();
    const encrypted = encryptSecret(key, version, userId, totpSecret);
    const mfaId = uuidv7();
    await tx.mfaSecret.create({
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
    await tx.recoveryCode.createMany({
      data: E2E_RECOVERY_CODES.map((code) => ({
        id: uuidv7(),
        userId,
        mfaSecretId: mfaId,
        codeHash: hashRecoveryCode(authHmacKey(), userId, normalizeRecoveryCode(code)),
      })),
    });
  });
}
await db.$disconnect();

const next = spawn(path.resolve("node_modules/.bin/next"), ["start", "-p", String(port)], {
  env: { ...process.env, ...appEnv },
  stdio: "inherit",
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  next.kill("SIGTERM");
  await cluster.stop();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
next.on("exit", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
