"use server";

import QRCode from "qrcode";
import { toActionResult, type ActionResult } from "@/server/http/action-result";
import { sessionTokenFromCookie } from "@/server/http/cookies";
import { requestContext } from "@/server/http/context";
import { confirmOwnMfaEnrollment, startOwnMfaEnrollment } from "@/server/services/auth/mfa";

/* "My account". Every export here is a public endpoint; the services check the session itself. */

async function token(): Promise<string | null> {
  return (await sessionTokenFromCookie()) ?? null;
}

const signedOut = { ok: false as const, code: "session_invalid", message: "" };

export async function beginOwnEnrollment(input: {
  password: string;
}): Promise<ActionResult<{ qrDataUrl: string; manualKey: string }>> {
  const current = await token();
  if (!current) return signedOut;
  return toActionResult(
    async () => startOwnMfaEnrollment(await requestContext(), { token: current, password: input.password }),
    async (result) => {
      // Rendered on the server: the secret never goes to any external QR service.
      const svg = await QRCode.toString(result.otpauthUri, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
      return { qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, manualKey: result.manualKey };
    },
  );
}

export async function finishOwnEnrollment(input: { code: string }): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const current = await token();
  if (!current) return signedOut;
  return toActionResult(
    async () => confirmOwnMfaEnrollment(await requestContext(), { token: current, code: input.code }),
    (result) => ({ recoveryCodes: result.recoveryCodes }),
  );
}
