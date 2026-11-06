import "server-only";

/**
 * The only logger the app uses. It accepts a fixed set of fields so patient data cannot be
 * passed in by accident (CLAUDE.md rule 2): no free-form messages, no error.message
 * (database errors can echo row values), only names, codes and opaque IDs.
 */
export interface LogFields {
  requestId?: string;
  action?: string;
  errorName?: string;
  errorCode?: string;
  durationMs?: number;
  count?: number;
}

export function logEvent(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/** Extract loggable identifiers from an error without its message. */
export function describeError(error: unknown): Pick<LogFields, "errorName" | "errorCode"> {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const code = (error as { code?: unknown }).code;
  return {
    errorName: error.name,
    ...(typeof code === "string" && /^[A-Z0-9_]{1,20}$/i.test(code) ? { errorCode: code } : {}),
  };
}
