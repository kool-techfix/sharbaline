/**
 * Break-glass (D-028, D-035): starting, using, ending and reviewing it, and what the database
 * itself refuses. All data is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import type { RequestContext } from "@/server/kernel/context";
import { defineService } from "@/server/kernel/define-service";
import { ForbiddenError, ValidationError } from "@/server/kernel/errors";
import { ok } from "@/server/kernel/outcome";
import {
  breakGlassStatus,
  endBreakGlass,
  listBreakGlass,
  reviewBreakGlass,
  startBreakGlass,
} from "@/server/services/break-glass/break-glass";
import { auditFor } from "../helpers/auth";
import { userContext } from "../helpers/context";
import { createTestDatabase, type TestDatabase } from "../helpers/db";
import { makePatient } from "../helpers/patients";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => t.drop());

const REASON = "Synthetic: family asked about a referral letter";

/** Stand-in for an M3 clinical read: nurses and doctors by role, admins only via break-glass. */
const readClinical = defineService({
  action: "test.clinical_read",
  input: z.object({ patientId: z.uuid() }),
  permission: { resource: "vitals", action: "read" },
  breakGlass: { patientId: (input) => input.patientId },
  audit: { resourceType: "vitals", patientId: (input) => input.patientId },
  run: async ({ breakGlass }) => ok({ viaBreakGlass: breakGlass !== null }),
});

function sameAdmin(ctx: RequestContext, overrides: { sessionId?: string } = {}): RequestContext {
  if (ctx.actor.kind !== "user") throw new Error("user context expected");
  return userContext("admin", { actor: { ...ctx.actor, ...overrides } });
}

async function start(ctx: RequestContext, patientId: string, id = uuidv7()) {
  const outcome = await startBreakGlass(ctx, { id, patientId, reasonCategory: "patient_request", reasonDetails: REASON }, t.db);
  if (!outcome.ok) throw new Error(`start failed: ${outcome.reasonCode}`);
  return outcome.value;
}

async function denial(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.catch((caught: unknown) => caught);
  return error instanceof ForbiddenError ? error.reasonCode : null;
}

describe("starting break-glass", () => {
  it("opens 30 minutes for one patient and audits the category, never the reason text", async () => {
    const admin = userContext("admin");
    const { id: patientId } = await makePatient(t);
    const id = uuidv7();
    const before = Date.now();
    const value = await start(admin, patientId, id);

    expect(value).toMatchObject({ eventId: id, alreadyActive: false });
    const minutes = (value.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThanOrEqual(30.1);

    const { rows } = await t.appPool.query("SELECT reason_category, reason_details, patient_id FROM break_glass_event WHERE id = $1", [id]);
    expect(rows).toEqual([{ reason_category: "patient_request", reason_details: REASON, patient_id: patientId }]);

    const audit = await auditFor(t, admin.requestId);
    expect(audit).toMatchObject([
      { action: "break_glass.start", outcome: "success", resource_id: id, patient_id: patientId },
    ]);
    expect(JSON.stringify(audit)).not.toContain("referral");
  });

  it("is safe to submit twice, and a second request for the same patient reuses the live access", async () => {
    const admin = userContext("admin");
    const { id: patientId } = await makePatient(t);
    const first = await start(admin, patientId);
    expect(await start(sameAdmin(admin), patientId, first.eventId)).toMatchObject({ eventId: first.eventId, alreadyActive: true });
    expect(await start(sameAdmin(admin), patientId)).toMatchObject({ eventId: first.eventId, alreadyActive: true });
    const { rows } = await t.appPool.query("SELECT count(*)::int AS n FROM break_glass_event WHERE patient_id = $1", [patientId]);
    expect(rows[0].n).toBe(1);
  });

  it("needs a reason of at least 10 characters and an existing patient", async () => {
    const admin = userContext("admin");
    const { id: patientId } = await makePatient(t);
    const short = startBreakGlass(admin, { id: uuidv7(), patientId, reasonCategory: "other", reasonDetails: "  because " }, t.db);
    await expect(short).rejects.toBeInstanceOf(ValidationError);
    expect(await auditFor(t, admin.requestId)).toMatchObject([{ outcome: "failure", reason_code: "invalid_input" }]);

    const missing = await startBreakGlass(
      userContext("admin"),
      { id: uuidv7(), patientId: uuidv7(), reasonCategory: "other", reasonDetails: REASON },
      t.db,
    );
    expect(missing).toMatchObject({ ok: false, reasonCode: "not_found" });
  });

  it("refuses a reused id from another admin", async () => {
    const { id: patientId } = await makePatient(t);
    const { eventId } = await start(userContext("admin"), patientId);
    const reused = await startBreakGlass(
      userContext("admin"),
      { id: eventId, patientId, reasonCategory: "other", reasonDetails: REASON },
      t.db,
    );
    expect(reused).toMatchObject({ ok: false, reasonCode: "id_conflict" });
  });
});

describe("what break-glass unlocks (kernel)", () => {
  it("lets an admin in only with a live event for this patient in this session, and tags the audit entry", async () => {
    const admin = userContext("admin");
    const { id: patientId } = await makePatient(t);
    const { id: otherPatient } = await makePatient(t);

    expect(await denial(readClinical(admin, { patientId }, t.db))).toBe("break_glass_required");
    expect(await auditFor(t, admin.requestId)).toMatchObject([
      { action: "test.clinical_read", outcome: "denied", reason_code: "break_glass_required", patient_id: patientId },
    ]);

    const { eventId } = await start(sameAdmin(admin), patientId);
    const allowed = sameAdmin(admin);
    expect(await readClinical(allowed, { patientId }, t.db)).toEqual({ ok: true, value: { viaBreakGlass: true } });
    expect(await auditFor(t, allowed.requestId)).toMatchObject([
      { action: "test.clinical_read", outcome: "success", break_glass_event_id: eventId },
    ]);

    expect(await denial(readClinical(sameAdmin(admin), { patientId: otherPatient }, t.db))).toBe("break_glass_required");
    // A new session (signing out and in again) starts without access.
    expect(await denial(readClinical(sameAdmin(admin, { sessionId: uuidv7() }), { patientId }, t.db))).toBe(
      "break_glass_required",
    );
  });

  it("stops after the event is ended or has expired", async () => {
    const admin = userContext("admin");
    const { id: patientId } = await makePatient(t);
    const { eventId } = await start(admin, patientId);
    expect(await endBreakGlass(sameAdmin(admin), { eventId }, t.db)).toMatchObject({ ok: true, value: { alreadyEnded: false } });
    expect(await endBreakGlass(sameAdmin(admin), { eventId }, t.db)).toMatchObject({ ok: true, value: { alreadyEnded: true } });
    expect(await denial(readClinical(sameAdmin(admin), { patientId }, t.db))).toBe("break_glass_required");
    expect(await breakGlassStatus(sameAdmin(admin), { patientId }, t.db)).toEqual({ ok: true, value: null });

    // An event that ran its 30 minutes.
    const expired = userContext("admin");
    if (expired.actor.kind !== "user") throw new Error("user context expected");
    await t.ownerPool.query(
      `INSERT INTO break_glass_event (id, user_id, session_id, patient_id, reason_category, reason_details, started_at, expires_at)
       VALUES ($1, $2, $3, $4, 'other', $5, now() - interval '40 minutes', now() - interval '10 minutes')`,
      [uuidv7(), expired.actor.userId, expired.actor.sessionId, patientId, REASON],
    );
    expect(await denial(readClinical(expired, { patientId }, t.db))).toBe("break_glass_required");
  });

  it("leaves roles the matrix allows untouched, and other roles get the usual refusal", async () => {
    const { id: patientId } = await makePatient(t);
    const nurse = userContext("nurse");
    expect(await readClinical(nurse, { patientId }, t.db)).toEqual({ ok: true, value: { viaBreakGlass: false } });
    expect(await auditFor(t, nurse.requestId)).toMatchObject([{ outcome: "success", break_glass_event_id: null }]);
    expect(await denial(readClinical(userContext("lab"), { patientId }, t.db))).toBe("role_not_permitted");
  });

  it("only lets an admin end their own access", async () => {
    const { id: patientId } = await makePatient(t);
    const { eventId } = await start(userContext("admin"), patientId);
    expect(await endBreakGlass(userContext("admin"), { eventId }, t.db)).toMatchObject({ ok: false, reasonCode: "not_found" });
  });

  it("keeps the audit chain intact, with the event id inside the hash", async () => {
    const { rows: broken } = await t.appPool.query("SELECT * FROM audit_log_verify_chain()");
    expect(broken).toEqual([]);
    const { rows } = await t.appPool.query(
      `SELECT a.hash = audit_log_digest(a.prev_hash, a) AS matches,
              a.hash = audit_log_digest(a.prev_hash, jsonb_populate_record(a, '{"break_glass_event_id": null}')) AS matches_without_event
         FROM audit_log a WHERE a.break_glass_event_id IS NOT NULL`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toEqual({ matches: true, matches_without_event: false });
  });
});

describe("review", () => {
  it("is done by a different admin, with a comment unless appropriate, once", async () => {
    const breaker = userContext("admin");
    const { id: patientId } = await makePatient(t);
    const { eventId } = await start(breaker, patientId);

    const self = await reviewBreakGlass(sameAdmin(breaker), { id: uuidv7(), eventId, outcome: "appropriate", comment: null }, t.db);
    expect(self).toMatchObject({ ok: false, reasonCode: "self_review" });

    const reviewer = userContext("admin");
    await expect(
      reviewBreakGlass(reviewer, { id: uuidv7(), eventId, outcome: "inappropriate", comment: null }, t.db),
    ).rejects.toBeInstanceOf(ValidationError);

    const reviewId = uuidv7();
    const input = { id: reviewId, eventId, outcome: "needs_follow_up" as const, comment: "Ask about the letter" };
    expect(await reviewBreakGlass(userContext("admin"), input, t.db)).toMatchObject({ ok: true, value: { alreadyReviewed: false } });
    expect(await reviewBreakGlass(userContext("admin"), input, t.db)).toMatchObject({ ok: true, value: { alreadyReviewed: true } });
    const second = await reviewBreakGlass(userContext("admin"), { ...input, id: uuidv7(), outcome: "appropriate", comment: null }, t.db);
    expect(second).toMatchObject({ ok: false, reasonCode: "already_reviewed" });
  });

  it("lists events awaiting review and reviewed ones, with who, why and how often the record was opened", async () => {
    const breaker = userContext("admin");
    if (breaker.actor.kind !== "user") throw new Error("user context expected");
    const { id: patientId } = await makePatient(t);
    const { eventId } = await start(breaker, patientId);
    await readClinical(sameAdmin(breaker), { patientId }, t.db);
    await readClinical(sameAdmin(breaker), { patientId }, t.db);

    const mine = await listBreakGlass(sameAdmin(breaker), { status: "awaiting" }, t.db);
    if (!mine.ok) throw new Error("list failed");
    const item = mine.value.items.find((i) => i.id === eventId);
    expect(item).toMatchObject({ reasonDetails: REASON, accessCount: 2, canReview: false, review: null, patient: { id: patientId } });
    expect(mine.value.awaitingCount).toBeGreaterThanOrEqual(1);

    const other = await listBreakGlass(userContext("admin"), { status: "awaiting" }, t.db);
    expect(other.ok && other.value.items.find((i) => i.id === eventId)?.canReview).toBe(true);

    await reviewBreakGlass(userContext("admin"), { id: uuidv7(), eventId, outcome: "appropriate", comment: null }, t.db);
    const reviewed = await listBreakGlass(userContext("admin"), { status: "reviewed" }, t.db);
    expect(reviewed.ok && reviewed.value.items.find((i) => i.id === eventId)).toMatchObject({
      review: { outcome: "appropriate" },
      canReview: false,
    });
    const audit = await auditFor(t, breaker.requestId);
    expect(JSON.stringify(audit)).not.toContain("referral");
  });
});

describe("the database itself", () => {
  async function event() {
    const breaker = userContext("admin");
    const { id: patientId } = await makePatient(t);
    const { eventId } = await start(breaker, patientId);
    return { eventId, breaker };
  }

  it("lets the app only set ended_at, once", async () => {
    const { eventId } = await event();
    await expect(t.appPool.query("UPDATE break_glass_event SET reason_details = 'changed reason text' WHERE id = $1", [eventId])).rejects.toThrow();
    await expect(t.appPool.query("DELETE FROM break_glass_event WHERE id = $1", [eventId])).rejects.toThrow();
    await t.appPool.query("UPDATE break_glass_event SET ended_at = now() WHERE id = $1", [eventId]);
    await expect(t.appPool.query("UPDATE break_glass_event SET ended_at = now() WHERE id = $1", [eventId])).rejects.toThrow(/only end it once/);
  });

  it("blocks edits, deletes and self-review even for the owner role", async () => {
    const { eventId, breaker } = await event();
    if (breaker.actor.kind !== "user") throw new Error("user context expected");
    await expect(
      t.ownerPool.query("UPDATE break_glass_event SET patient_id = patient_id, reason_details = 'x changed text' WHERE id = $1", [eventId]),
    ).rejects.toThrow(/only end it once/);
    await expect(t.ownerPool.query("DELETE FROM break_glass_event WHERE id = $1", [eventId])).rejects.toThrow(/append-only/);
    await expect(
      t.ownerPool.query(
        "INSERT INTO break_glass_review (id, event_id, reviewer_id, outcome) VALUES ($1, $2, $3, 'appropriate')",
        [uuidv7(), eventId, breaker.actor.userId],
      ),
    ).rejects.toThrow(/different admin/);

    const reviewId = uuidv7();
    await t.ownerPool.query("INSERT INTO break_glass_review (id, event_id, reviewer_id, outcome) VALUES ($1, $2, $3, 'appropriate')", [
      reviewId,
      eventId,
      uuidv7(),
    ]);
    await expect(t.ownerPool.query("UPDATE break_glass_review SET outcome = 'inappropriate' WHERE id = $1", [reviewId])).rejects.toThrow(
      /append-only/,
    );
    await expect(t.ownerPool.query("DELETE FROM break_glass_review WHERE id = $1", [reviewId])).rejects.toThrow(/append-only/);
  });

  it("refuses access windows over an hour", async () => {
    const { id: patientId } = await makePatient(t);
    await expect(
      t.appPool.query(
        `INSERT INTO break_glass_event (id, user_id, session_id, patient_id, reason_category, reason_details, started_at, expires_at)
         VALUES ($1, $2, $3, $4, 'other', $5, now(), now() + interval '2 hours')`,
        [uuidv7(), uuidv7(), uuidv7(), patientId, REASON],
      ),
    ).rejects.toThrow(/break_glass_event_window/);
  });
});
