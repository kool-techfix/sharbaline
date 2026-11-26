import "server-only";
import type { Db } from "@/server/db/client";
import type { Tx } from "@/server/db/tx";

/** How long one break-glass access lasts (D-035). The database refuses more than an hour. */
export const BREAK_GLASS_MINUTES = 30;

/**
 * The caller's live break-glass event for this patient, if any: theirs, in this session (so
 * signing out ends it), not ended early and not expired.
 */
export async function liveBreakGlassEventId(
  client: Db | Tx,
  actor: { userId: string; sessionId: string },
  patientId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const event = await client.breakGlassEvent.findFirst({
    where: { userId: actor.userId, sessionId: actor.sessionId, patientId, endedAt: null, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
    select: { id: true },
  });
  return event?.id ?? null;
}
