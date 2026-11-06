import "server-only";
import { randomBytes } from "node:crypto";
import { hash, verify, type Algorithm, type Options } from "@node-rs/argon2";
import { normalizePassword } from "./password-policy";

// Argon2id with OWASP's recommended minimum (m=19 MiB, t=2, p=1). Benchmark on the reference
// server in slice 9; raise if sign-in stays well under ~250 ms. The value 2 is
// Algorithm.Argon2id; the package declares it as a const enum, unusable with isolatedModules.
const ARGON2ID = 2 as Algorithm;
const OPTIONS: Options = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(normalizePassword(password), OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, normalizePassword(password));
  } catch {
    return false; // malformed stored hash: treat as a failed match, never as an error page
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Run a full Argon2 verification against a throwaway hash. Used when the account doesn't exist
 * or is disabled, so every failed sign-in costs the same time and timing reveals nothing.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash(randomBytes(16).toString("hex"), OPTIONS);
  await verifyPassword(await dummyHash, password);
}
