import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * TOTP secrets are encrypted with AES-256-GCM. The user's ID is bound in as associated data,
 * so a ciphertext copied onto another user's row fails to decrypt. The key version allows
 * rotating MFA_ENCRYPTION_KEY later without re-enrolling everyone at once.
 */
export interface EncryptedSecret {
  ciphertext: Uint8Array<ArrayBuffer>; // ciphertext || 16-byte auth tag
  iv: Uint8Array<ArrayBuffer>;
  keyVersion: number;
}

export function encryptSecret(
  key: Buffer,
  keyVersion: number,
  userId: string,
  secret: Buffer,
): EncryptedSecret {
  const iv = new Uint8Array(randomBytes(12));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = new Uint8Array(Buffer.concat([cipher.update(secret), cipher.final(), cipher.getAuthTag()]));
  return { ciphertext, iv, keyVersion };
}

export function decryptSecret(key: Buffer, userId: string, encrypted: EncryptedSecret): Buffer {
  const tag = encrypted.ciphertext.subarray(encrypted.ciphertext.length - 16);
  const body = encrypted.ciphertext.subarray(0, encrypted.ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}
