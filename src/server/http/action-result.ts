import "server-only";
import { t } from "@/lib/i18n";
import { ForbiddenError, ValidationError } from "@/server/kernel/errors";
import type { RequestContext } from "@/server/kernel/context";
import type { Outcome } from "@/server/kernel/outcome";
import { callerContext } from "./guard";

/** What a server action returns to the browser: data, or a plain-language message. Never internals. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export async function toActionResult<T, R>(
  call: () => Promise<Outcome<T>>,
  onOk: (value: T) => Promise<R> | R,
): Promise<ActionResult<R>> {
  try {
    const outcome = await call();
    if (!outcome.ok) return { ok: false, code: outcome.reasonCode, message: t(outcome.messageKey) };
    return { ok: true, data: await onOk(outcome.value) };
  } catch (error) {
    // The kernel has already audited and logged (without details) whatever went wrong.
    if (error instanceof ValidationError) return { ok: false, code: error.code, message: t(error.messageKey) };
    if (error instanceof ForbiddenError) return { ok: false, code: error.code, message: t(error.messageKey) };
    return { ok: false, code: "unexpected", message: t("errors.unexpected") };
  }
}

/** Run a service as the signed-in caller; a missing, locked or half-signed-in session is refused. */
export async function actAsCaller<T, R>(
  call: (ctx: RequestContext) => Promise<Outcome<T>>,
  onOk: (value: T) => Promise<R> | R,
): Promise<ActionResult<R>> {
  const ctx = await callerContext();
  if (!ctx) return { ok: false, code: "session_invalid", message: t("auth.error.signedOut") };
  return toActionResult(() => call(ctx), onOk);
}
