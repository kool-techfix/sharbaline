"use server";

import QRCode from "qrcode";
import { toActionResult, type ActionResult } from "@/server/http/action-result";
import {
  clearSessionCookie,
  ensureDeviceId,
  sessionTokenFromCookie,
  setSessionCookie,
} from "@/server/http/cookies";
import { requestContext, userAgent } from "@/server/http/context";
import { login } from "@/server/services/auth/login";
import {
  confirmMfaEnrollment,
  startMfaEnrollment,
  redeemRecoveryCode,
  verifyTotpCode,
} from "@/server/services/auth/mfa";
import { changePassword, logout } from "@/server/services/auth/session";

/*
 * Sign-in steps. Each action reads the session cookie itself, calls one service, and on success
 * stores the NEW token the service issued (tokens rotate at every step).
 * Every export of a "use server" file is a public endpoint: export actions only.
 */

interface NextStep {
  stage: "mfa_pending" | "password_change_required" | "mfa_enrollment_required" | "active";
  redirectTo: string;
}

export async function signIn(input: { identifier: string; password: string }): Promise<ActionResult<NextStep>> {
  const deviceId = await ensureDeviceId();
  const ctx = await requestContext();
  const agent = await userAgent();
  return toActionResult(
    () => login({ ...ctx, deviceId }, { ...input, deviceId, userAgent: agent }),
    async (result) => {
      await setSessionCookie(result.token, result.expiresAt);
      return { stage: result.stage, redirectTo: result.redirectTo };
    },
  );
}

async function withToken<T>(
  run: (token: string) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const token = await sessionTokenFromCookie();
  if (!token) return { ok: false, code: "session_invalid", message: "" };
  return run(token);
}

export async function submitTotpCode(input: { code: string }): Promise<ActionResult<NextStep>> {
  return withToken(async (token) =>
    toActionResult(
      async () => verifyTotpCode(await requestContext(), { token, code: input.code }),
      async (result) => {
        await setSessionCookie(result.token, result.expiresAt);
        return { stage: result.stage, redirectTo: result.redirectTo };
      },
    ),
  );
}

export async function submitRecoveryCode(
  input: { code: string },
): Promise<ActionResult<NextStep & { remaining: number }>> {
  return withToken(async (token) =>
    toActionResult(
      async () => redeemRecoveryCode(await requestContext(), { token, code: input.code }),
      async (result) => {
        await setSessionCookie(result.token, result.expiresAt);
        return { stage: result.stage, redirectTo: result.redirectTo, remaining: result.remaining };
      },
    ),
  );
}

export async function beginEnrollment(): Promise<ActionResult<{ qrDataUrl: string; manualKey: string }>> {
  return withToken(async (token) =>
    toActionResult(
      async () => startMfaEnrollment(await requestContext(), { token }),
      async (result) => {
        // Rendered on the server: the secret never goes to any external QR service.
        const svg = await QRCode.toString(result.otpauthUri, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
        return {
          qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
          manualKey: result.manualKey,
        };
      },
    ),
  );
}

export async function finishEnrollment(
  input: { code: string },
): Promise<ActionResult<NextStep & { recoveryCodes: string[] }>> {
  return withToken(async (token) =>
    toActionResult(
      async () => confirmMfaEnrollment(await requestContext(), { token, code: input.code }),
      async (result) => {
        await setSessionCookie(result.token, result.expiresAt);
        return { stage: result.stage, redirectTo: result.redirectTo, recoveryCodes: result.recoveryCodes };
      },
    ),
  );
}

export async function submitNewPassword(input: { newPassword: string }): Promise<ActionResult<NextStep>> {
  return withToken(async (token) =>
    toActionResult(
      async () => changePassword(await requestContext(), { token, newPassword: input.newPassword }),
      async (result) => {
        await setSessionCookie(result.token, result.expiresAt);
        return { stage: result.stage, redirectTo: result.redirectTo };
      },
    ),
  );
}

/** "Back to sign in" from a half-finished sign-in: end that session. */
export async function cancelSignIn(): Promise<void> {
  const token = await sessionTokenFromCookie();
  if (token) {
    try {
      await logout(await requestContext(), { token });
    } catch {
      // The cookie is cleared regardless; a failed revoke leaves a session that expires in minutes.
    }
  }
  await clearSessionCookie();
}
