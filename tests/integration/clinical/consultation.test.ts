/**
 * Consultation (M3, D-037): visits and the queue, vitals and corrections, allergies, versioned
 * notes with conflicts, drafts, and who can read what. All data is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/lib/ids";
import type { RequestContext } from "@/server/kernel/context";
import { ForbiddenError, ValidationError } from "@/server/kernel/errors";
import { startBreakGlass } from "@/server/services/break-glass/break-glass";
import { changeAllergy, getAllergies, recordAllergy } from "@/server/services/clinical/allergies";
import { discardNoteDraft, saveNote, saveNoteDraft } from "@/server/services/clinical/notes";
import { getClinicalSummary, getVisit } from "@/server/services/clinical/record";
import { closeVisit, openVisit, sendToDoctor, takeVisit } from "@/server/services/clinical/visits";
import { correctVitals, recordVitals } from "@/server/services/clinical/vitals";
import { addToQueue } from "@/server/services/queue/queue";
import { auditFor } from "../helpers/auth";
import { userContext } from "../helpers/context";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { makePatient } from "../helpers/patients";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const COMPLAINT = "Synthetic: headache since Tuesday";
const empty = { presentingComplaint: null, history: null, examination: null, diagnosisText: null, plan: null };

/** The same staff member making another request (same user and session, new request id). */
function again(ctx: RequestContext): RequestContext {
  if (ctx.actor.kind !== "user") throw new Error("user context expected");
  return userContext(ctx.actor.role, { actor: ctx.actor });
}

async function queueStatus(patientId: string): Promise<string | null> {
  const { rows } = await t.appPool.query("SELECT status FROM queue_entry WHERE patient_id = $1", [patientId]);
  return rows[0]?.status ?? null;
}

async function queuedPatient() {
  const { id: patientId } = await makePatient(t);
  const outcome = await addToQueue(userContext("front_desk"), { id: uuidv7(), patientId }, t.db);
  if (!outcome.ok) throw new Error("queue failed");
  return patientId;
}

async function open(ctx: RequestContext, patientId: string) {
  const outcome = await openVisit(ctx, { id: uuidv7(), patientId, visitType: "outpatient" }, t.db);
  if (!outcome.ok) throw new Error(`open failed: ${outcome.reasonCode}`);
  return outcome.value.visitId;
}

async function denial(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.catch((caught: unknown) => caught);
  return error instanceof ForbiddenError ? error.reasonCode : null;
}

describe("visits and the queue", () => {
  it("follows the patient from nurse to doctor to done", async () => {
    const patientId = await queuedPatient();
    const nurse = userContext("nurse");
    const visitId = await open(nurse, patientId);
    expect(await queueStatus(patientId)).toBe("with_nurse");
    expect(await auditFor(t, nurse.requestId)).toMatchObject([{ action: "visits.open", outcome: "success", patient_id: patientId }]);

    // A second open returns the same visit.
    expect(await openVisit(userContext("nurse"), { id: uuidv7(), patientId, visitType: "outpatient" }, t.db)).toMatchObject({
      ok: true,
      value: { visitId, alreadyOpen: true },
    });

    await sendToDoctor(again(nurse), { visitId, patientId }, t.db);
    expect(await queueStatus(patientId)).toBe("waiting_doctor");
    // The visit read carries the queue status, so the nurse's screen knows it was sent.
    expect(await getVisit(userContext("nurse"), { patientId, visitId }, t.db)).toMatchObject({
      ok: true,
      value: { queueStatus: "waiting_doctor" },
    });

    const doctor = userContext("doctor");
    await takeVisit(doctor, { visitId, patientId }, t.db);
    expect(await queueStatus(patientId)).toBe("with_doctor");

    expect(await closeVisit(again(doctor), { visitId, patientId }, t.db)).toMatchObject({ ok: true, value: { alreadyClosed: false } });
    expect(await closeVisit(again(doctor), { visitId, patientId }, t.db)).toMatchObject({ ok: true, value: { alreadyClosed: true } });
    expect(await queueStatus(patientId)).toBe("done");
    const { rows } = await t.appPool.query("SELECT status, attending_doctor_id FROM visit WHERE id = $1", [visitId]);
    expect(rows[0]).toEqual({ status: "closed", attending_doctor_id: doctor.actor.kind === "user" ? doctor.actor.userId : null });

    const late = await recordVitals(userContext("nurse"), { id: uuidv7(), visitId, patientId, measurements: { pulseBpm: 70 } }, t.db);
    expect(late).toMatchObject({ ok: false, reasonCode: "visit_closed" });
  });

  it("lets a doctor open a visit directly, and keeps one open visit per patient under concurrency", async () => {
    const patientId = await queuedPatient();
    const results = await Promise.all([open(userContext("doctor"), patientId), open(userContext("nurse"), patientId)]);
    expect(results[0]).toBe(results[1]);
    const { rows } = await t.appPool.query("SELECT count(*)::int AS n FROM visit WHERE patient_id = $1", [patientId]);
    expect(rows[0].n).toBe(1);
  });

  it("works for a patient who isn't in today's queue", async () => {
    const { id: patientId } = await makePatient(t);
    const visitId = await open(userContext("nurse"), patientId);
    expect(await sendToDoctor(userContext("nurse"), { visitId, patientId }, t.db)).toMatchObject({ ok: true, value: { queueStatus: null } });
    expect(await getVisit(userContext("nurse"), { patientId, visitId }, t.db)).toMatchObject({ ok: true, value: { queueStatus: null } });
  });

  it("refuses a visit id that belongs to another patient", async () => {
    const { id: patientId } = await makePatient(t);
    const { id: otherPatient } = await makePatient(t);
    const visitId = await open(userContext("nurse"), patientId);
    expect(await sendToDoctor(userContext("nurse"), { visitId, patientId: otherPatient }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "not_found",
    });
  });

  it("never changes a closed visit, even for the owner role", async () => {
    const { id: patientId } = await makePatient(t);
    const visitId = await open(userContext("doctor"), patientId);
    await closeVisit(userContext("doctor"), { visitId, patientId }, t.db);
    await expect(t.ownerPool.query("UPDATE visit SET status = 'open', closed_at = NULL, closed_by_id = NULL WHERE id = $1", [visitId])).rejects.toThrow(
      /closed visit/,
    );
    await expect(t.ownerPool.query("DELETE FROM visit WHERE id = $1", [visitId])).rejects.toThrow(/never deleted/);
  });
});

describe("vitals", () => {
  it("records plausible values and refuses typos and half a blood pressure", async () => {
    const { id: patientId } = await makePatient(t);
    const visitId = await open(userContext("nurse"), patientId);
    const nurse = userContext("nurse");
    const measurements = { temperatureC: 37.8, pulseBpm: 96, bpSystolic: 128, bpDiastolic: 84, spo2Pct: 97, weightKg: 71.5 };
    expect(await recordVitals(nurse, { id: uuidv7(), visitId, patientId, measurements }, t.db)).toMatchObject({ ok: true });
    expect(await auditFor(t, nurse.requestId)).toMatchObject([
      { action: "vitals.record", metadata: { fields: "temperatureC,pulseBpm,bpSystolic,spo2Pct,weightKg" } },
    ]);

    for (const bad of [{ temperatureC: 378 }, { bpSystolic: 120 }, { bpSystolic: 80, bpDiastolic: 90 }, {}]) {
      await expect(recordVitals(userContext("nurse"), { id: uuidv7(), visitId, patientId, measurements: bad }, t.db)).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(
      t.ownerPool.query("INSERT INTO vitals (id, visit_id, patient_id, temperature_c, recorded_by_id) VALUES ($1, $2, $3, 3.7, $4)", [
        uuidv7(),
        visitId,
        patientId,
        uuidv7(),
      ]),
    ).rejects.toThrow(/vitals_temperature_range/);
  });

  it("corrects by superseding: the original stays, shown as entered in error; each row is corrected once", async () => {
    const { id: patientId } = await makePatient(t);
    const visitId = await open(userContext("nurse"), patientId);
    const firstId = uuidv7();
    await recordVitals(userContext("nurse"), { id: firstId, visitId, patientId, measurements: { pulseBpm: 100, temperatureC: 39.9 } }, t.db);
    const secondId = uuidv7();
    await recordVitals(userContext("nurse"), { id: secondId, visitId, patientId, measurements: { weightKg: 7.2 } }, t.db);

    const fixId = uuidv7();
    const corrected = await correctVitals(
      userContext("nurse"),
      { id: fixId, patientId, supersedesId: firstId, reason: "Thermometer misread", measurements: { pulseBpm: 100, temperatureC: 36.9 } },
      t.db,
    );
    expect(corrected).toMatchObject({ ok: true, value: { struckOut: false } });
    await correctVitals(userContext("nurse"), { id: uuidv7(), patientId, supersedesId: secondId, reason: "Wrong patient", measurements: null }, t.db);

    // Two nurses correct the same row at once: exactly one wins.
    const races = await Promise.all(
      [1, 2].map(() => correctVitals(userContext("nurse"), { id: uuidv7(), patientId, supersedesId: fixId, reason: "Typed twice", measurements: null }, t.db)),
    );
    expect(races.map((r) => (r.ok ? "ok" : r.reasonCode)).sort()).toEqual(["already_corrected", "ok"]);

    const detail = await getVisit(userContext("doctor"), { patientId, visitId }, t.db);
    if (!detail.ok) throw new Error("visit read failed");
    expect(detail.value.vitals).toHaveLength(5);
    expect(detail.value.vitals.find((v) => v.id === firstId)).toMatchObject({ temperatureC: 39.9, supersededById: fixId });
    expect(detail.value.vitals.find((v) => v.id === fixId)).toMatchObject({ correction: { supersedesId: firstId, reason: "Thermometer misread" } });

    // The timeline shows only what is current: the struck-out rows and the strike-outs disappear.
    const summary = await getClinicalSummary(userContext("doctor"), { patientId }, t.db);
    expect(summary.ok && summary.value.visits[0]?.vitals).toEqual([]);

    await expect(t.appPool.query("UPDATE vitals SET pulse_bpm = 90 WHERE id = $1", [firstId])).rejects.toThrow();
    await expect(t.ownerPool.query("DELETE FROM vitals WHERE id = $1", [firstId])).rejects.toThrow(/append-only/);
  });
});

describe("allergies", () => {
  it("records none known explicitly, retires it when an allergy is recorded, and keeps every change", async () => {
    const { id: patientId } = await makePatient(t);
    const nurse = userContext("nurse");
    expect(await getAllergies(userContext("front_desk"), { patientId }, t.db)).toEqual({
      ok: true,
      value: { allergies: [], noKnownAllergies: false },
    });
    await recordAllergy(nurse, { id: uuidv7(), patientId, kind: "no_known_allergies" }, t.db);
    expect(await getAllergies(userContext("pharmacist"), { patientId }, t.db)).toMatchObject({ value: { noKnownAllergies: true } });

    const penicillin = uuidv7();
    await recordAllergy(userContext("doctor"), { id: penicillin, patientId, kind: "allergy", allergen: "Penicillin", severity: "severe", reaction: "Rash" }, t.db);
    const after = await getAllergies(userContext("lab"), { patientId }, t.db);
    expect(after).toMatchObject({ value: { noKnownAllergies: false, allergies: [{ allergen: "Penicillin", severity: "severe", status: "active" }] } });
    expect(await recordAllergy(userContext("nurse"), { id: uuidv7(), patientId, kind: "no_known_allergies" }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "has_active_allergies",
    });

    const resolvedId = uuidv7();
    await changeAllergy(userContext("doctor"), { id: resolvedId, patientId, supersedesId: penicillin, status: "resolved" }, t.db);
    // Changing the old row again is refused: someone already changed it.
    expect(await changeAllergy(userContext("nurse"), { id: uuidv7(), patientId, supersedesId: penicillin, status: "active" }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "changed_elsewhere",
    });
    await expect(
      changeAllergy(userContext("nurse"), { id: uuidv7(), patientId, supersedesId: resolvedId, status: "entered_in_error" }, t.db),
    ).rejects.toBeInstanceOf(ValidationError);
    await changeAllergy(
      userContext("nurse"),
      { id: uuidv7(), patientId, supersedesId: resolvedId, status: "entered_in_error", reason: "Recorded for the wrong patient" },
      t.db,
    );
    expect(await getAllergies(userContext("doctor"), { patientId }, t.db)).toMatchObject({ value: { allergies: [], noKnownAllergies: false } });

    const { rows } = await t.appPool.query("SELECT count(*)::int AS n FROM patient_allergy WHERE patient_id = $1", [patientId]);
    expect(rows[0].n).toBe(5);
    await expect(t.appPool.query("DELETE FROM patient_allergy WHERE patient_id = $1", [patientId])).rejects.toThrow();
  });
});

describe("notes", () => {
  it("saves numbered versions, flags a conflict when two doctors save from the same version, and keeps both", async () => {
    const { id: patientId } = await makePatient(t);
    const visitId = await open(userContext("doctor"), patientId);
    const v1 = uuidv7();
    const first = await saveNote(userContext("doctor"), { id: v1, visitId, patientId, parentVersionId: null, fields: { ...empty, presentingComplaint: COMPLAINT } }, t.db);
    expect(first).toMatchObject({ ok: true, value: { versionNo: 1, isConflict: false } });

    const saves = await Promise.all(
      ["Malaria, uncomplicated", "Viral fever"].map((diagnosisText) =>
        saveNote(userContext("doctor"), { id: uuidv7(), visitId, patientId, parentVersionId: v1, fields: { ...empty, diagnosisText } }, t.db),
      ),
    );
    const results = saves.map((r) => (r.ok ? r.value : null));
    expect(results.map((r) => r?.versionNo).sort()).toEqual([2, 3]);
    expect(results.filter((r) => r?.isConflict)).toHaveLength(1);

    const detail = await getVisit(userContext("nurse"), { patientId, visitId }, t.db);
    if (!detail.ok) throw new Error("visit read failed");
    expect(detail.value.noteVersions.map((n) => n.versionNo)).toEqual([3, 2, 1]);
    expect(detail.value.noteVersions[0]?.isConflict).toBe(true);
    expect(new Set(detail.value.noteVersions.map((n) => n.diagnosisText))).toEqual(new Set(["Malaria, uncomplicated", "Viral fever", null]));

    // Resolving: a new version based on the newest one is not a conflict.
    const resolved = await saveNote(
      userContext("doctor"),
      { id: uuidv7(), visitId, patientId, parentVersionId: detail.value.noteVersions[0]!.id, fields: { ...empty, diagnosisText: "Malaria, uncomplicated" } },
      t.db,
    );
    expect(resolved).toMatchObject({ value: { versionNo: 4, isConflict: false } });

    // Notes can't be edited in place, by anyone.
    await expect(t.ownerPool.query("UPDATE visit_note_version SET plan = 'changed' WHERE id = $1", [v1])).rejects.toThrow(/append-only/);
  });

  it("keeps each doctor's draft to themselves and drops it when the note is saved", async () => {
    const { id: patientId } = await makePatient(t);
    const visitId = await open(userContext("doctor"), patientId);
    const doctor = userContext("doctor");
    const draft = await saveNoteDraft(doctor, { visitId, patientId, baseVersionId: null, fields: { ...empty, history: "Synthetic history" } }, t.db);
    expect(draft.ok).toBe(true);
    expect(JSON.stringify(await auditFor(t, doctor.requestId))).not.toContain("Synthetic history");

    const mine = await getVisit(again(doctor), { patientId, visitId }, t.db);
    expect(mine.ok && mine.value.myDraft?.fields.history).toBe("Synthetic history");
    const theirs = await getVisit(userContext("doctor"), { patientId, visitId }, t.db);
    expect(theirs.ok && theirs.value.myDraft).toBeNull();

    await saveNote(again(doctor), { id: uuidv7(), visitId, patientId, parentVersionId: null, fields: { ...empty, history: "Synthetic history" } }, t.db);
    const afterSave = await getVisit(again(doctor), { patientId, visitId }, t.db);
    expect(afterSave.ok && afterSave.value.myDraft).toBeNull();

    await saveNoteDraft(again(doctor), { visitId, patientId, baseVersionId: null, fields: { ...empty, plan: "Synthetic plan" } }, t.db);
    expect(await discardNoteDraft(again(doctor), { visitId, patientId }, t.db)).toMatchObject({ value: { discarded: true } });
  });

  it("never puts note text in the audit log", async () => {
    const { id: patientId } = await makePatient(t);
    const visitId = await open(userContext("doctor"), patientId);
    const doctor = userContext("doctor");
    await saveNote(doctor, { id: uuidv7(), visitId, patientId, parentVersionId: null, fields: { ...empty, presentingComplaint: COMPLAINT } }, t.db);
    const audit = await auditFor(t, doctor.requestId);
    expect(audit).toMatchObject([{ action: "notes.save", metadata: { fields: "presentingComplaint", version_no: 1 } }]);
    expect(JSON.stringify(audit)).not.toContain("headache");
  });
});

describe("who can read the clinical record", () => {
  it("nurses and doctors by role, lab and pharmacists never, admins only through break-glass", async () => {
    const { id: patientId } = await makePatient(t);
    const visitId = await open(userContext("nurse"), patientId);
    for (const role of ["nurse", "doctor"] as const) {
      expect((await getClinicalSummary(userContext(role), { patientId }, t.db)).ok).toBe(true);
    }
    for (const role of ["lab", "pharmacist", "front_desk"] as const) {
      expect(await denial(getVisit(userContext(role), { patientId, visitId }, t.db))).toBe("role_not_permitted");
    }

    const admin = userContext("admin");
    expect(await denial(getClinicalSummary(admin, { patientId }, t.db))).toBe("break_glass_required");
    const started = await startBreakGlass(
      again(admin),
      { id: uuidv7(), patientId, reasonCategory: "complaint_investigation", reasonDetails: "Synthetic complaint review" },
      t.db,
    );
    if (!started.ok) throw new Error("break-glass failed");
    const reading = again(admin);
    expect((await getVisit(reading, { patientId, visitId }, t.db)).ok).toBe(true);
    expect(await auditFor(t, reading.requestId)).toMatchObject([
      { action: "clinical.visit", outcome: "success", break_glass_event_id: started.value.eventId },
    ]);
    // Break-glass is read-only: admins still can't write clinical data.
    expect(await denial(recordVitals(again(admin), { id: uuidv7(), visitId, patientId, measurements: { pulseBpm: 70 } }, t.db))).toBe(
      "role_not_permitted",
    );
  });
});
