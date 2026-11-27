import "server-only";
import { z } from "zod";
import { hospitalDateKey } from "@/lib/time";
import type { Tx } from "@/server/db/tx";

/*
 * Shared by the consultation services (M3, D-037). Every clinical read declares
 * `breakGlass: { patientId }`, so clinical inputs always carry the patient id, and every service
 * checks that the visit or row it names belongs to that patient.
 */

export const todayQueueDate = (now = new Date()) => new Date(`${hospitalDateKey(now)}T00:00:00Z`);

/** Free text from a clinician: trimmed; empty means "not given". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const requiredText = (min: number, max: number) => z.string().trim().min(min).max(max);

export interface VisitRow {
  id: string;
  patient_id: string;
  status: "open" | "closed";
  queue_entry_id: string | null;
  attending_doctor_id: string | null;
}

/**
 * The visit, or null unless it exists and belongs to the patient. With `lock`, the row is locked
 * to the end of the transaction, which serialises note version numbers and status changes.
 */
export async function loadVisit(tx: Tx, visitId: string, patientId: string, lock = false): Promise<VisitRow | null> {
  const rows = lock
    ? await tx.$queryRaw<VisitRow[]>`
        SELECT id, patient_id, status, queue_entry_id, attending_doctor_id FROM visit WHERE id = ${visitId}::uuid FOR UPDATE`
    : await tx.$queryRaw<VisitRow[]>`
        SELECT id, patient_id, status, queue_entry_id, attending_doctor_id FROM visit WHERE id = ${visitId}::uuid`;
  const visit = rows[0];
  return visit && visit.patient_id === patientId ? visit : null;
}

type QueueStatus = "waiting" | "with_nurse" | "waiting_doctor" | "with_doctor" | "done" | "left";

/**
 * Move the visit's queue entry along, only from the statuses given. Visits opened outside the
 * queue (no entry) and entries already further along are left alone.
 */
export async function moveQueue(
  tx: Tx,
  queueEntryId: string | null,
  from: readonly QueueStatus[],
  to: QueueStatus,
  userId: string,
): Promise<QueueStatus | null> {
  if (!queueEntryId) return null;
  const rows = await tx.$queryRaw<{ status: QueueStatus }[]>`
    SELECT status FROM queue_entry WHERE id = ${queueEntryId}::uuid FOR UPDATE`;
  const current = rows[0]?.status ?? null;
  if (!current || !from.includes(current)) return current;
  await tx.queueEntry.update({ where: { id: queueEntryId }, data: { status: to, updatedAt: new Date(), updatedById: userId } });
  return to;
}
