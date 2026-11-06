import type { MessageKey } from "@/lib/i18n";
import type { AuditMetadata } from "@/server/audit/write";

/**
 * What a service returns. An expected failure (wrong password, item no longer pending) is a
 * value, not an exception: the transaction COMMITS, so its side effects persist (e.g. a failed
 * login counter) and a `failure` audit entry is written with it. Throwing means something is
 * actually wrong: the transaction ROLLS BACK and an `error` entry is written separately (D-017).
 */
export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; reasonCode: string; messageKey: MessageKey; metadata?: AuditMetadata };

export function ok<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function fail<T = never>(
  reasonCode: string,
  messageKey: MessageKey,
  metadata?: AuditMetadata,
): Outcome<T> {
  return metadata === undefined
    ? { ok: false, reasonCode, messageKey }
    : { ok: false, reasonCode, messageKey, metadata };
}
