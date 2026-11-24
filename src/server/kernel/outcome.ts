import type { MessageKey } from "@/lib/i18n";
import type { AuditMetadata } from "@/server/audit/write";
import type { Role } from "@/server/permissions/roles";

/**
 * The account an audit entry is about when the caller wasn't signed in yet, e.g. a sign-in
 * attempt: the request is anonymous, but the entry must name the account (M1 audit rules).
 */
export interface AuditActor {
  userId: string;
  role: Role | null;
  sessionId: string | null;
}

/**
 * What a service returns. An expected failure (wrong password, item no longer pending) is a
 * value, not an exception: the transaction COMMITS, so its side effects persist (e.g. a failed
 * login counter) and a `failure` audit entry is written with it. Throwing means something is
 * actually wrong: the transaction ROLLS BACK and an `error` entry is written separately (D-017).
 */
export type Outcome<T> =
  | { ok: true; value: T; auditActor?: AuditActor }
  | {
      ok: false;
      reasonCode: string;
      messageKey: MessageKey;
      metadata?: AuditMetadata;
      auditActor?: AuditActor;
    };

export function ok<T>(value: T, options: { auditActor?: AuditActor } = {}): Outcome<T> {
  return options.auditActor ? { ok: true, value, auditActor: options.auditActor } : { ok: true, value };
}

export function fail<T = never>(
  reasonCode: string,
  messageKey: MessageKey,
  options: { metadata?: AuditMetadata; auditActor?: AuditActor | null } = {},
): Outcome<T> {
  return {
    ok: false,
    reasonCode,
    messageKey,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.auditActor ? { auditActor: options.auditActor } : {}),
  };
}
