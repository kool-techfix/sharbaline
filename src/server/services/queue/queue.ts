import "server-only";
import { z } from "zod";
import { hospitalDateKey } from "@/lib/time";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { actorId, actorRole, auditIds, summarySelect, toSummary, viewFor, type PatientSummary } from "../patients/shared";

/*
 * Today's queue (scope §5 M2, D-032): front desk adds patients; front desk, nurses and doctors
 * see it. In M2 the only status change is "left"; nurse/doctor statuses arrive with M3.
 * The day is the Lagos calendar day (rule 14).
 */

const todayDate = (now = new Date()) => new Date(`${hospitalDateKey(now)}T00:00:00Z`);

export interface QueueItem {
  id: string;
  position: number;
  status: "waiting" | "with_nurse" | "waiting_doctor" | "with_doctor" | "done" | "left";
  addedAt: Date;
  patient: PatientSummary;
}

/** Add a patient to today's queue. Safe to call twice: a patient is in a day's queue once. */
export const addToQueue = defineService({
  action: "queue.add",
  input: z.object({ id: z.uuid(), patientId: z.uuid() }),
  permission: { resource: "queue", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ entryId: string; position: number; alreadyQueued: boolean }>> {
    const now = new Date();
    const queueDate = todayDate(now);
    const day = hospitalDateKey(now);
    // One writer per day's queue at a time, so positions are unique and gap-free.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`queue:${day}`}))`;

    const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
    if (!patient) return fail("not_found", "patients.error.notFound");
    const existing = await tx.queueEntry.findUnique({
      where: { queueDate_patientId: { queueDate, patientId: input.patientId } },
      select: { id: true, position: true },
    });
    if (existing) return ok({ entryId: existing.id, position: existing.position, alreadyQueued: true });

    const last = await tx.queueEntry.aggregate({ where: { queueDate }, _max: { position: true } });
    const position = (last._max.position ?? 0) + 1;
    const userId = actorId(ctx);
    await tx.queueEntry.create({
      data: {
        id: input.id,
        patientId: input.patientId,
        queueDate,
        position,
        addedById: userId,
        createdAt: now,
        updatedAt: now,
        updatedById: userId,
      },
    });
    return ok({ entryId: input.id, position, alreadyQueued: false });
  },
  audit: {
    resourceType: "queue_entry",
    resourceId: (input, value) => value?.entryId ?? input.id,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ position: value?.position ?? null, already_queued: value?.alreadyQueued ?? null }),
  },
});

/** Today's queue in order, with each patient's summary. Audited with the patient ids shown. */
export const listQueue = defineService({
  action: "queue.view",
  input: z.object({}),
  permission: { resource: "queue", action: "read" },
  async run({ tx, ctx }): Promise<Outcome<{ date: string; entries: QueueItem[] }>> {
    const now = new Date();
    const view = viewFor(actorRole(ctx));
    const rows = await tx.queueEntry.findMany({
      where: { queueDate: todayDate(now) },
      orderBy: { position: "asc" },
      select: { id: true, position: true, status: true, createdAt: true, patient: { select: summarySelect } },
    });
    return ok({
      date: hospitalDateKey(now),
      entries: rows.map((row) => ({
        id: row.id,
        position: row.position,
        status: row.status,
        addedAt: row.createdAt,
        patient: toSummary(row.patient, view, now),
      })),
    });
  },
  audit: {
    resourceType: "queue_entry",
    metadata: (_input, value) => ({
      results: value?.entries.length ?? null,
      patient_ids: value ? auditIds(value.entries.map((e) => e.patient.id)) : null,
    }),
  },
});

/** The patient left before being seen. Kept in the list (never deleted), marked "left". */
export const markLeftQueue = defineService({
  action: "queue.mark_left",
  input: z.object({ entryId: z.uuid() }),
  permission: { resource: "queue", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<{ patientId: string }>> {
    const rows = await tx.$queryRaw<{ patient_id: string; status: string }[]>`
      SELECT patient_id, status FROM queue_entry WHERE id = ${input.entryId}::uuid FOR UPDATE`;
    const entry = rows[0];
    if (!entry) return fail("not_found", "queue.error.notFound");
    if (entry.status === "done" || entry.status === "left") {
      return fail("queue_closed", "queue.error.closed", { metadata: { status: entry.status } });
    }
    await tx.queueEntry.update({
      where: { id: input.entryId },
      data: { status: "left", updatedAt: new Date(), updatedById: actorId(ctx) },
    });
    return ok({ patientId: entry.patient_id });
  },
  audit: {
    resourceType: "queue_entry",
    resourceId: (input) => input.entryId,
    patientId: (_input, value) => value?.patientId ?? null,
  },
});
