import "server-only";
import { serverEnv } from "@/server/config/env";

/** Decoded secrets. Env validation already checked their lengths. */
export function authHmacKey(): Buffer {
  return Buffer.from(serverEnv().AUTH_HMAC_KEY, "base64");
}

export function mfaEncryptionKey(): { key: Buffer; version: number } {
  const env = serverEnv();
  return { key: Buffer.from(env.MFA_ENCRYPTION_KEY, "base64"), version: env.MFA_ENCRYPTION_KEY_VERSION };
}

export function totpIssuer(): string {
  const env = serverEnv();
  return env.TOTP_ISSUER ?? `HMS · ${env.HOSPITAL_NAME}`.slice(0, 60);
}
