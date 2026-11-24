import "server-only";
import type { AuditOutcome } from "@/generated/prisma/enums";
import { uuidv7 } from "@/lib/ids";
import type { Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";
import type { RequestContext } from "@/server/kernel/context";
import type { AuditActor } from "@/server/kernel/outcome";

/**
 * Small, flat, non-identifying facts only: counts, field names, codes, opaque IDs.
 * Never names, phone numbers, notes, free text or secrets.
 */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  /** Dotted machine name, e.g. "auth.login" (enforced by a CHECK constraint). */
  action: string;
  outcome: AuditOutcome;
  resourceType?: string | null;
  resourceId?: string | null;
  patientId?: string | null;
  reasonCode?: string | null;
  metadata?: AuditMetadata;
}

/**
 * Append one audit entry. Pass the service's transaction so the entry commits or rolls back
 * with the change it describes. seq, prev_hash and hash are filled by the database trigger.
 * `subject` names the account when the request itself is anonymous (sign-in steps).
 */
export async function writeAudit(
  client: Tx | Db,
  ctx: RequestContext,
  entry: AuditEntry,
  subject?: AuditActor,
): Promise<void> {
  const actor: AuditActor | null =
    ctx.actor.kind === "user"
      ? { userId: ctx.actor.userId, role: ctx.actor.role, sessionId: ctx.actor.sessionId }
      : (subject ?? null);
  await client.auditLog.create({
    data: {
      id: uuidv7(),
      actorUserId: actor?.userId ?? null,
      actorRole: actor?.role ?? null,
      sessionId: actor?.sessionId ?? null,
      deviceId: ctx.deviceId,
      ip: ctx.ip,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      patientId: entry.patientId ?? null,
      outcome: entry.outcome,
      reasonCode: entry.reasonCode ?? null,
      requestId: ctx.requestId,
      metadata: entry.metadata ?? {},
    },
  });
}
