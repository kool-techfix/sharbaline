import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dammIsValid } from "@/lib/domain/damm";
import { ValidationError } from "@/server/kernel/errors";
import { getPatient, searchPatients, updatePatient } from "@/server/services/patients/records";
import { findPossibleDuplicates, registerPatient } from "@/server/services/patients/register";
import { addToQueue, listQueue, markLeftQueue } from "@/server/services/queue/queue";
import { auditFor } from "../helpers/auth";
import { userContext } from "../helpers/context";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { makePatient, patientInput } from "../helpers/patients";

// Lets one test make registration fail after the patient row is written, to prove rollback.
const collideIds = vi.hoisted(() => ({ with: null as string | null }));
vi.mock("@/lib/ids", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ids")>();
  return { ...original, uuidv7: () => collideIds.with ?? original.uuidv7() };
});
const { uuidv7 } = await import("@/lib/ids");

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const desk = () => userContext("front_desk");

describe("registration", () => {
  it("assigns an HSP number with a valid Damm check digit and records consent, next of kin and audit", async () => {
    const ctx = desk();
    const input = patientInput({ phone: "0803 111 2233", legacyCardNumber: "OLD/1234" });
    const outcome = await registerPatient(ctx, input, t.db);
    expect(outcome).toMatchObject({ ok: true, value: { patientId: input.id, alreadyRegistered: false } });
    if (!outcome.ok) return;
    expect(outcome.value.patientNumber).toMatch(/^HSP-\d{5,}$/);
    expect(dammIsValid(outcome.value.patientNumber.slice(4))).toBe(true);

    const { rows } = await t.appPool.query(
      `SELECT p.phone_e164, p.consent_version, p.consent_recorded_by_id, k.relationship
         FROM patient p JOIN next_of_kin k ON k.patient_id = p.id WHERE p.id = $1`,
      [input.id],
    );
    expect(rows).toEqual([
      {
        phone_e164: "+2348031112233",
        consent_version: "draft-1",
        consent_recorded_by_id: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        relationship: "Sibling",
      },
    ]);
    const audit = await auditFor(t, ctx.requestId);
    expect(audit).toMatchObject([{ action: "patients.register", outcome: "success", resource_id: input.id }]);
    expect(JSON.stringify(audit)).not.toContain(input.surname);
  });

  it("stores an age-only birth date as 1 July, marked estimated", async () => {
    const { id } = await makePatient(t, { birth: { kind: "estimated", ageYears: 40 } });
    const { rows } = await t.appPool.query(
      "SELECT to_char(date_of_birth, 'MM-DD') AS md, dob_is_estimated FROM patient WHERE id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ md: "07-01", dob_is_estimated: true });
  });

  it("is safe to call twice: the retry returns the same patient and number", async () => {
    const ctx = desk();
    const input = patientInput();
    const first = await registerPatient(ctx, input, t.db);
    const again = await registerPatient(ctx, input, t.db);
    expect(again).toMatchObject({ ok: true, value: { alreadyRegistered: true } });
    expect(again.ok && first.ok && again.value.patientNumber === first.value.patientNumber).toBe(true);
    expect(await registerPatient(desk(), input, t.db)).toMatchObject({ ok: false, reasonCode: "id_conflict" });
  });

  it("rejects invalid input: no consent, a bad phone, an unknown sex, a future or impossible date", async () => {
    for (const bad of [
      { consentConfirmed: false },
      { phone: "12345" },
      { sex: "unknown" },
    ] as const) {
      await expect(registerPatient(desk(), { ...patientInput(), ...bad }, t.db)).rejects.toBeInstanceOf(ValidationError);
    }
    for (const date of ["2999-01-01", "2001-02-30"]) {
      expect(await registerPatient(desk(), patientInput({ birth: { kind: "exact", date } }), t.db)).toMatchObject({
        ok: false,
        reasonCode: "invalid_birth_date",
      });
    }
  });

  it("rolls back entirely when something fails after the patient row is written", async () => {
    const existing = await makePatient(t);
    const { rows: kin } = await t.appPool.query("SELECT id FROM next_of_kin WHERE patient_id = $1", [existing.id]);
    const ctx = desk();
    const input = patientInput();
    collideIds.with = kin[0].id; // the next-of-kin insert reuses an existing id → primary key error
    try {
      await expect(registerPatient(ctx, { ...input, id: input.id }, t.db)).rejects.toThrow();
    } finally {
      collideIds.with = null;
    }
    const { rows } = await t.appPool.query("SELECT count(*)::int AS n FROM patient WHERE id = $1", [input.id]);
    expect(rows[0].n).toBe(0);
    expect(await auditFor(t, ctx.requestId)).toMatchObject([{ action: "patients.register", outcome: "error" }]);
  });
});

describe("duplicate warning", () => {
  it("refuses a likely duplicate until it is confirmed as a different person, then logs the override", async () => {
    const original = await makePatient(t, {
      surname: "Yusufdup",
      firstName: "Amina",
      birth: { kind: "exact", date: "1991-03-04" },
      phone: "0803 456 2187",
    });
    const lookalike = patientInput({
      surname: "Yusufdup",
      firstName: "Aminat",
      birth: { kind: "exact", date: "1991-03-04" },
      phone: "0803 456 2187",
    });

    const check = await findPossibleDuplicates(desk(), lookalike, t.db);
    expect(check.ok && check.value.candidates.map((c) => c.patient.id)).toEqual([original.id]);

    const refused = await registerPatient(desk(), lookalike, t.db);
    expect(refused).toMatchObject({ ok: false, reasonCode: "possible_duplicate" });
    const { rows: none } = await t.appPool.query("SELECT 1 FROM patient WHERE id = $1", [lookalike.id]);
    expect(none).toEqual([]);

    const ctx = desk();
    const confirmed = await registerPatient(ctx, { ...lookalike, acknowledgedDuplicateIds: [original.id] }, t.db);
    expect(confirmed).toMatchObject({ ok: true, value: { duplicatesOverridden: 1 } });
    const { rows } = await t.appPool.query(
      `SELECT p.possible_duplicate_of_id, o.suspected_patient_id, o.score
         FROM patient p JOIN duplicate_override o ON o.new_patient_id = p.id WHERE p.id = $1`,
      [lookalike.id],
    );
    expect(rows[0]).toMatchObject({ possible_duplicate_of_id: original.id, suspected_patient_id: original.id });
    expect(rows[0].score).toBeGreaterThanOrEqual(60);
    expect(await auditFor(t, ctx.requestId)).toMatchObject([
      { action: "patients.register", outcome: "success", metadata: { duplicates_overridden: 1 } },
    ]);
  });

  it("doesn't warn for a family member who shares a phone", async () => {
    await makePatient(t, { surname: "Okafam", firstName: "Chinedu", birth: { kind: "exact", date: "1970-05-05" }, phone: "0816 207 4491" });
    const child = patientInput({ surname: "Okafam", firstName: "Ifeoma", birth: { kind: "exact", date: "2015-09-09" }, phone: "0816 207 4491" });
    const check = await findPossibleDuplicates(desk(), child, t.db);
    expect(check.ok && check.value.candidates).toEqual([]);
  });
});

describe("search", () => {
  it("finds by patient number with or without prefix, and flags a wrong check digit", async () => {
    const { id, patientNumber } = await makePatient(t);
    const digits = patientNumber.slice(4);
    for (const query of [patientNumber, patientNumber.toLowerCase(), digits]) {
      const outcome = await searchPatients(desk(), { query }, t.db);
      expect(outcome.ok && outcome.value.results[0]?.id).toBe(id);
    }
    const wrong = `${digits.slice(0, -1)}${(Number(digits.slice(-1)) + 1) % 10}`;
    const outcome = await searchPatients(desk(), { query: `HSP-${wrong}` }, t.db);
    expect(outcome).toMatchObject({ ok: true, value: { checkDigitInvalid: true } });
  });

  it("finds by phone in any format, by legacy card number, and by name with typos or accents", async () => {
    const { id } = await makePatient(t, {
      surname: "Adébáyọ̀search",
      firstName: "Olúwaseun",
      phone: "0902 741 6508",
      legacyCardNumber: "MC-77812",
    });
    for (const query of ["+234 902 741 6508", "09027416508", "mc-77812", "adebayosearch oluwaseun", "Adebayosarch"]) {
      const outcome = await searchPatients(desk(), { query }, t.db);
      expect(outcome.ok && outcome.value.results.map((r) => r.id), query).toContain(id);
    }
  });

  it("audits the patient ids returned, never the search text", async () => {
    const { id } = await makePatient(t, { surname: "Auditsearchname" });
    const ctx = desk();
    await searchPatients(ctx, { query: "Auditsearchname" }, t.db);
    const audit = await auditFor(t, ctx.requestId);
    expect(audit).toMatchObject([{ action: "patients.search", outcome: "success" }]);
    expect(String(audit[0]?.metadata.patient_ids)).toContain(id);
    expect(JSON.stringify(audit)).not.toContain("Auditsearchname");
  });

  it("shows lab and pharmacist identity only, and won't let them search by phone (D-004, D-008)", async () => {
    const { id, patientNumber } = await makePatient(t, { phone: "0805 222 3344" });
    for (const role of ["lab", "pharmacist"] as const) {
      const byNumber = await searchPatients(userContext(role), { query: patientNumber }, t.db);
      expect(byNumber.ok && byNumber.value.results[0]).toEqual(
        expect.objectContaining({ id, view: "identity" }),
      );
      expect(byNumber.ok && JSON.stringify(byNumber.value.results[0])).not.toMatch(/phone|dateOfBirth|2348052223344/);
      const byPhone = await searchPatients(userContext(role), { query: "0805 222 3344" }, t.db);
      expect(byPhone.ok && byPhone.value.results.map((r) => r.id)).not.toContain(id);
    }
  });
});

describe("viewing and editing", () => {
  it("shows the full record to front desk (with next of kin and today's queue), identity to lab, and audits each view", async () => {
    const { id } = await makePatient(t);
    await addToQueue(desk(), { id: uuidv7(), patientId: id }, t.db);
    const ctx = desk();
    const full = await getPatient(ctx, { patientId: id }, t.db);
    expect(full).toMatchObject({
      ok: true,
      value: { view: "full", nextOfKin: { relationship: "Sibling" }, queueToday: { status: "waiting" } },
    });
    expect(await auditFor(t, ctx.requestId)).toMatchObject([{ action: "patients.view", resource_id: id }]);
    const { rows } = await t.appPool.query("SELECT patient_id FROM audit_log WHERE request_id = $1", [ctx.requestId]);
    expect(rows[0].patient_id).toBe(id);

    const lab = await getPatient(userContext("lab"), { patientId: id }, t.db);
    expect(lab.ok && Object.keys(lab.value).sort()).toEqual(["summary", "view"]);
    const admin = await getPatient(userContext("admin"), { patientId: id }, t.db);
    expect(admin).toMatchObject({ ok: true, value: { view: "full", queueToday: null } }); // admin can't see the queue
  });

  it("updates details, audits field names only, and refuses an edit based on a stale read", async () => {
    const { id, input, patientNumber } = await makePatient(t);
    const read = await getPatient(desk(), { patientId: id }, t.db);
    if (!read.ok || read.value.view !== "full") throw new Error("read failed");
    const base = {
      ...input,
      patientId: id,
      expectedUpdatedAt: read.value.updatedAt.toISOString(),
      paperFolderStatus: "partial" as const,
    };
    const ctx = userContext("doctor");
    const outcome = await updatePatient(ctx, { ...base, phone: "0807 999 0000", priorityFolder: true }, t.db);
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.ok && outcome.value.changed.sort()).toEqual(["paperFolderStatus", "phoneE164", "priorityFolder"]);
    const audit = await auditFor(t, ctx.requestId);
    expect(audit).toMatchObject([{ action: "patients.update", metadata: { fields: expect.stringContaining("phoneE164") } }]);
    expect(JSON.stringify(audit)).not.toContain("2348079990000");

    const { rows } = await t.appPool.query("SELECT patient_number FROM patient WHERE id = $1", [id]);
    expect(rows[0].patient_number).toBe(patientNumber);
    expect(await updatePatient(desk(), { ...base, surname: "Changed" }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "changed_elsewhere",
    });
  });
});

describe("today's queue", () => {
  it("adds in order, is safe to call twice, lists with patients, and marks 'left' once", async () => {
    const [a, b] = [await makePatient(t), await makePatient(t)];
    const first = await addToQueue(desk(), { id: uuidv7(), patientId: a.id }, t.db);
    const second = await addToQueue(desk(), { id: uuidv7(), patientId: b.id }, t.db);
    const again = await addToQueue(desk(), { id: uuidv7(), patientId: a.id }, t.db);
    expect(again).toMatchObject({ ok: true, value: { alreadyQueued: true } });
    expect(first.ok && second.ok && second.value.position).toBe(first.ok ? first.value.position + 1 : -1);

    const ctx = userContext("nurse");
    const list = await listQueue(ctx, {}, t.db);
    const ids = list.ok ? list.value.entries.map((e) => e.patient.id) : [];
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    expect(String((await auditFor(t, ctx.requestId))[0]?.metadata.patient_ids)).toContain(a.id);

    if (!first.ok) return;
    expect(await markLeftQueue(desk(), { entryId: first.value.entryId }, t.db)).toMatchObject({ ok: true });
    expect(await markLeftQueue(desk(), { entryId: first.value.entryId }, t.db)).toMatchObject({
      ok: false,
      reasonCode: "queue_closed",
    });
  });

  it("gives simultaneous additions unique, consecutive positions", async () => {
    const patients = await Promise.all(Array.from({ length: 8 }, () => makePatient(t)));
    const results = await Promise.all(
      patients.map((p) => addToQueue(desk(), { id: uuidv7(), patientId: p.id }, t.db)),
    );
    const positions = results.map((r) => (r.ok ? r.value.position : -1)).sort((x, y) => x - y);
    expect(new Set(positions).size).toBe(8);
    expect(positions[7]! - positions[0]!).toBe(7);
  });
});

describe("database guards (any login, including owner or superuser)", () => {
  it("never changes a patient number or deletes a patient record", async () => {
    const { id } = await makePatient(t);
    await expect(
      t.ownerPool.query("UPDATE patient SET patient_number = 'HSP-10009' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: "HM003" });
    await expect(t.ownerPool.query("DELETE FROM patient WHERE id = $1", [id])).rejects.toMatchObject({ code: "HM004" });
    await expect(t.ownerPool.query("DELETE FROM next_of_kin WHERE patient_id = $1", [id])).rejects.toMatchObject({
      code: "HM004",
    });
    await expect(t.appPool.query("DELETE FROM patient WHERE id = $1", [id])).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps duplicate overrides append-only", async () => {
    const facts = { surname: "Guardcase", firstName: "Halima", birth: { kind: "exact" as const, date: "1988-08-08" } };
    const original = await makePatient(t, facts);
    const copy = await makePatient(t, { ...facts, firstName: "Halimat" });
    const { rows } = await t.appPool.query(
      "SELECT id FROM duplicate_override WHERE new_patient_id = $1 AND suspected_patient_id = $2",
      [copy.id, original.id],
    );
    expect(rows).toHaveLength(1);
    for (const sql of ["UPDATE duplicate_override SET score = 0 WHERE id = $1", "DELETE FROM duplicate_override WHERE id = $1"]) {
      await expect(t.ownerPool.query(sql, [rows[0].id])).rejects.toMatchObject({ code: "HM002" });
    }
  });
});
