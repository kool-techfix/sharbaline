import "server-only";
import { z } from "zod";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { actorId, actorRole } from "../patients/shared";
import { loadVisit, moveQueue, todayQueueDate } from "./shared";

/*
 * Visits (scope §5 M3, D-037). The queue follows the visit:
 *   nurse opens      waiting → with_nurse
 *   nurse sends on   with_nurse → waiting_doctor
 *   doctor takes it  waiting / with_nurse / waiting_doctor → with_doctor
 *   doctor closes    → done
 * Visits opened outside the queue (no entry today) work the same, without the queue.
 */

export const VISIT_TYPES = ["outpatient", "follow_up", "emergency"] as const;

const visitRef = z.object({ visitId: z.uuid(), patientId: z.uuid() });

/** Open a visit for the patient, or return the one already open. Safe to call twice. */
export const openVisit = defineService({
  action: "visits.open",
  input: z.object({ id: z.uuid(), patientId: z.uuid(), visitType: z.enum(VISIT_TYPES).default("outpatient") }),
  permission: { resource: "visits", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ visitId: string; alreadyOpen: boolean }>> {
    const userId = actorId(ctx);
    const role = actorRole(ctx);
    // One opener per patient at a time, so "already open?" and the insert can't race.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`visit:${input.patientId}`}))`;

    const same = await tx.visit.findUnique({ where: { id: input.id }, select: { patientId: true } });
    if (same) {
      if (same.patientId !== input.patientId) return fail("id_conflict", "clinical.error.idConflict");
      return ok({ visitId: input.id, alreadyOpen: true });
    }
    const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
    if (!patient) return fail("not_found", "patients.error.notFound");
    const open = await tx.visit.findFirst({ where: { patientId: input.patientId, status: "open" }, select: { id: true } });
    if (open) return ok({ visitId: open.id, alreadyOpen: true });

    const entry = await tx.queueEntry.findUnique({
      where: { queueDate_patientId: { queueDate: todayQueueDate(), patientId: input.patientId } },
      select: { id: true, status: true },
    });
    const queueEntryId = entry && entry.status !== "done" && entry.status !== "left" ? entry.id : null;
    await tx.visit.create({
      data: {
        id: input.id,
        patientId: input.patientId,
        queueEntryId,
        visitType: input.visitType,
        openedById: userId,
        attendingDoctorId: role === "doctor" ? userId : null,
      },
    });
    if (role === "doctor") {
      await moveQueue(tx, queueEntryId, ["waiting", "with_nurse", "waiting_doctor"], "with_doctor", userId);
    } else {
      await moveQueue(tx, queueEntryId, ["waiting"], "with_nurse", userId);
    }
    return ok({ visitId: input.id, alreadyOpen: false });
  },
  audit: {
    resourceType: "visit",
    resourceId: (input, value) => value?.visitId ?? input.id,
    patientId: (input) => input.patientId,
    metadata: (input, value) => ({ visit_type: input.visitType, already_open: value?.alreadyOpen ?? null }),
  },
});

/** The nurse is done: the patient waits for a doctor. */
export const sendToDoctor = defineService({
  action: "visits.send_to_doctor",
  input: visitRef,
  permission: { resource: "visits", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<{ queueStatus: string | null }>> {
    const visit = await loadVisit(tx, input.visitId, input.patientId, true);
    if (!visit) return fail("not_found", "clinical.error.visitNotFound");
    if (visit.status === "closed") return fail("visit_closed", "clinical.error.visitClosed");
    const queueStatus = await moveQueue(tx, visit.queue_entry_id, ["waiting", "with_nurse"], "waiting_doctor", actorId(ctx));
    return ok({ queueStatus });
  },
  audit: {
    resourceType: "visit",
    resourceId: (input) => input.visitId,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ queue_status: value?.queueStatus ?? null }),
  },
});

/** A doctor starts seeing the patient and becomes the attending doctor. */
export const takeVisit = defineService({
  action: "visits.take",
  input: visitRef,
  permission: { resource: "consultation_notes", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ queueStatus: string | null }>> {
    const userId = actorId(ctx);
    const visit = await loadVisit(tx, input.visitId, input.patientId, true);
    if (!visit) return fail("not_found", "clinical.error.visitNotFound");
    if (visit.status === "closed") return fail("visit_closed", "clinical.error.visitClosed");
    if (visit.attending_doctor_id !== userId) {
      await tx.visit.update({ where: { id: visit.id }, data: { attendingDoctorId: userId } });
    }
    const queueStatus = await moveQueue(
      tx,
      visit.queue_entry_id,
      ["waiting", "with_nurse", "waiting_doctor"],
      "with_doctor",
      userId,
    );
    return ok({ queueStatus });
  },
  audit: {
    resourceType: "visit",
    resourceId: (input) => input.visitId,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ queue_status: value?.queueStatus ?? null }),
  },
});

/** The doctor closes the visit; the patient leaves the queue as done. Closing twice is a no-op. */
export const closeVisit = defineService({
  action: "visits.close",
  input: visitRef,
  permission: { resource: "consultation_notes", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ alreadyClosed: boolean }>> {
    const userId = actorId(ctx);
    const visit = await loadVisit(tx, input.visitId, input.patientId, true);
    if (!visit) return fail("not_found", "clinical.error.visitNotFound");
    if (visit.status === "closed") return ok({ alreadyClosed: true });
    await tx.visit.update({
      where: { id: visit.id },
      data: { status: "closed", closedAt: new Date(), closedById: userId, attendingDoctorId: visit.attending_doctor_id ?? userId },
    });
    await moveQueue(tx, visit.queue_entry_id, ["waiting", "with_nurse", "waiting_doctor", "with_doctor"], "done", userId);
    return ok({ alreadyClosed: false });
  },
  audit: {
    resourceType: "visit",
    resourceId: (input) => input.visitId,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ already_closed: value?.alreadyClosed ?? null }),
  },
});
