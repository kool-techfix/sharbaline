import "server-only";
import { cookies } from "next/headers";
import { UUID_PATTERN, uuidv7 } from "@/lib/ids";

/*
 * __Host- cookies: Secure, Path=/, no Domain, so no other host or path can set or read them.
 * Browsers accept Secure cookies on http://localhost, so this works in development too.
 */
export const SESSION_COOKIE = "__Host-hms_session";
export const DEVICE_COOKIE = "__Host-hms_device";

const base = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

export async function sessionTokenFromCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, { ...base, expires: expiresAt });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { ...base, maxAge: 0 });
}

export async function deviceIdFromCookie(): Promise<string | null> {
  const value = (await cookies()).get(DEVICE_COOKIE)?.value;
  return value && UUID_PATTERN.test(value) ? value : null;
}

/** Device cookies are random IDs for audit, not credentials. Only settable in actions/routes. */
export async function ensureDeviceId(): Promise<string> {
  const existing = await deviceIdFromCookie();
  if (existing) return existing;
  const id = uuidv7();
  (await cookies()).set(DEVICE_COOKIE, id, { ...base, maxAge: 400 * 24 * 60 * 60 });
  return id;
}
