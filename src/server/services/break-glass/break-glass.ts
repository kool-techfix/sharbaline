import "server-only";
import { z } from "zod";
import { BREAK_GLASS_MINUTES, liveBreakGlassEventId } from "@/server/break-glass/live";
import type { RequestContext } from "@/server/kernel/context";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";

/*
 * Break-glass (scope §4.1, D-028, D-035): an admin opens one patient's clinical record with a
 * reason, for one session and 30 minutes; another admin reviews it afterwards. What it unlocks
 * is declared per clinical service (`breakGlass` in defineService), never by the role matrix.
 *
 * The reason text may mention the patient, so it is stored only in break_glass_event and shown
 * only on the review screen: audit entries carry the category code and ids, never the text.
 */

export const BREAK_GLASS_REASONS = [
  "emergency_care",
  "patient_request",
  "complaint_investigation",
  "records_correction",
  "legal_regulatory",
  "other",
] as const;
export type BreakGlassReason = (typeof BREAK_GLASS_REASONS)[number];

export const REVIEW_OUTCOMES = ["appropriate", "inappropriate", "needs_follow_up"] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

/** The signed-in admin's user and session. The kernel has already refused anyone else. */
function caller(ctx: RequestContext): { userId: string; sessionId: string } {
  if (ctx.actor.kind !== "user") throw new Error("A signed-in user is required");
  return { userId: ctx.actor.userId, sessionId: ctx.actor.sessionId };
}

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const startBreakGlassInput = z.object({
  /** Client-generated, so a double submit opens one event (rule 11). */
  id: z.uuid(),
  patientId: z.uuid(),
  reasonCategory: z.enum(BREAK_GLASS_REASONS),
  reasonDetails: trimmed(10, 500),
});

export interface LiveBreakGlass {
  eventId: string;
  expiresAt: Date;
}

/** Open one patient's clinical record for this session, for BREAK_GLASS_MINUTES. */
export const startBreakGlass = defineService({
  action: "break_glass.start",
  input: startBreakGlassInput,
  permission: { resource: "break_glass", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<LiveBreakGlass & { alreadyActive: boolean }>> {
    const me = caller(ctx);
    const existing = await tx.breakGlassEvent.findUnique({
      where: { id: input.id },
      select: { userId: true, patientId: true, expiresAt: true },
    });
    if (existing) {
      // A retry of the same request. Anything else reusing the id is refused.
      if (existing.userId !== me.userId || existing.patientId !== input.patientId) {
        return fail("id_conflict", "breakGlass.error.idConflict");
      }
      return ok({ eventId: input.id, expiresAt: existing.expiresAt, alreadyActive: true });
    }

    const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
    if (!patient) return fail("not_found", "patients.error.notFound");

    const now = new Date();
    const liveId = await liveBreakGlassEventId(tx, me, input.patientId, now);
    if (liveId) {
      const live = await tx.breakGlassEvent.findUniqueOrThrow({ where: { id: liveId }, select: { expiresAt: true } });
      return ok({ eventId: liveId, expiresAt: live.expiresAt, alreadyActive: true });
    }

    const expiresAt = new Date(now.getTime() + BREAK_GLASS_MINUTES * 60_000);
    await tx.breakGlassEvent.create({
      data: {
        id: input.id,
        userId: me.userId,
        sessionId: me.sessionId,
        patientId: input.patientId,
        reasonCategory: input.reasonCategory,
        reasonDetails: input.reasonDetails,
        startedAt: now,
        expiresAt,
      },
    });
    return ok({ eventId: input.id, expiresAt, alreadyActive: false });
  },
  audit: {
    resourceType: "break_glass_event",
    resourceId: (input, value) => value?.eventId ?? input.id,
    patientId: (input) => input.patientId,
    metadata: (input, value) => ({
      reason_category: input.reasonCategory,
      already_active: value?.alreadyActive ?? null,
      minutes: BREAK_GLASS_MINUTES,
    }),
  },
});

/** End the caller's own break-glass access early. Ending one that already ended is a no-op. */
export const endBreakGlass = defineService({
  action: "break_glass.end",
  input: z.object({ eventId: z.uuid() }),
  permission: { resource: "break_glass", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ patientId: string; alreadyEnded: boolean }>> {
    const me = caller(ctx);
    const event = await tx.breakGlassEvent.findUnique({
      where: { id: input.eventId },
      select: { userId: true, patientId: true, endedAt: true, expiresAt: true },
    });
    if (!event || event.userId !== me.userId) return fail("not_found", "breakGlass.error.notFound");
    const now = new Date();
    if (event.endedAt || event.expiresAt <= now) return ok({ patientId: event.patientId, alreadyEnded: true });
    // The trigger allows exactly this change: ended_at, once, within the window.
    await tx.breakGlassEvent.update({ where: { id: input.eventId }, data: { endedAt: now } });
    return ok({ patientId: event.patientId, alreadyEnded: false });
  },
  audit: {
    resourceType: "break_glass_event",
    resourceId: (input) => input.eventId,
    patientId: (_input, value) => value?.patientId ?? null,
    metadata: (_input, value) => ({ already_ended: value?.alreadyEnded ?? null }),
  },
});

/** Whether the caller has live break-glass access to this patient now (for the patient page). */
export const breakGlassStatus = defineService({
  action: "break_glass.status",
  input: z.object({ patientId: z.uuid() }),
  permission: { resource: "break_glass", action: "read" },
  async run({ tx, input, ctx }): Promise<Outcome<LiveBreakGlass | null>> {
    const liveId = await liveBreakGlassEventId(tx, caller(ctx), input.patientId);
    if (!liveId) return ok(null);
    const live = await tx.breakGlassEvent.findUniqueOrThrow({ where: { id: liveId }, select: { expiresAt: true } });
    return ok({ eventId: liveId, expiresAt: live.expiresAt });
  },
  audit: {
    resourceType: "break_glass_event",
    resourceId: (_input, value) => value?.eventId ?? null,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ live: value === undefined ? null : value !== null }),
  },
});

export interface BreakGlassListItem {
  id: string;
  user: { id: string; displayName: string; staffId: string } | null;
  patient: { id: string; patientNumber: string; surname: string; firstName: string; otherNames: string | null };
  reasonCategory: BreakGlassReason;
  reasonDetails: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  /** Requests made under this access (the audit entries carrying its id). */
  accessCount: number;
  review: {
    outcome: ReviewOutcome;
    comment: string | null;
    reviewedAt: Date;
    reviewer: { id: string; displayName: string } | null;
  } | null;
  /** False when the caller broke this glass themselves: another admin must review it. */
  canReview: boolean;
}

const LIST_LIMIT = 100;

/**
 * Break-glass events for review, newest first. Reviewers need the reason and who the patient
 * is to judge it; this read is audited with the event and patient counts.
 */
export const listBreakGlass = defineService({
  action: "break_glass.list",
  input: z.object({ status: z.enum(["awaiting", "reviewed"]) }),
  permission: { resource: "break_glass", action: "read" },
  async run({ tx, input, ctx }): Promise<
    Outcome<{ items: BreakGlassListItem[]; awaitingCount: number; truncated: boolean }>
  > {
    const me = caller(ctx);
    const where = input.status === "awaiting" ? { review: { is: null } } : { review: { isNot: null } };
    const [rows, awaitingCount] = await Promise.all([
      tx.breakGlassEvent.findMany({
        where,
        orderBy: { startedAt: input.status === "awaiting" ? "asc" : "desc" },
        take: LIST_LIMIT + 1,
        select: {
          id: true,
          userId: true,
          reasonCategory: true,
          reasonDetails: true,
          startedAt: true,
          expiresAt: true,
          endedAt: true,
          patient: { select: { id: true, patientNumber: true, surname: true, firstName: true, otherNames: true } },
          review: { select: { outcome: true, comment: true, reviewedAt: true, reviewerId: true } },
          _count: { select: { auditEntries: { where: { outcome: "success" } } } },
        },
      }),
      tx.breakGlassEvent.count({ where: { review: { is: null } } }),
    ]);
    const page = rows.slice(0, LIST_LIMIT);
    const userIds = [...new Set(page.flatMap((row) => [row.userId, row.review?.reviewerId ?? row.userId]))];
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true, staffId: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));

    const items = page.map((row): BreakGlassListItem => ({
      id: row.id,
      user: byId.get(row.userId) ?? null,
      patient: row.patient,
      reasonCategory: row.reasonCategory,
      reasonDetails: row.reasonDetails,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      endedAt: row.endedAt,
      accessCount: row._count.auditEntries,
      review: row.review
        ? {
            outcome: row.review.outcome,
            comment: row.review.comment,
            reviewedAt: row.review.reviewedAt,
            reviewer: byId.get(row.review.reviewerId) ?? null,
          }
        : null,
      canReview: !row.review && row.userId !== me.userId,
    }));
    return ok({ items, awaitingCount, truncated: rows.length > LIST_LIMIT });
  },
  audit: {
    resourceType: "break_glass_event",
    metadata: (input, value) => ({
      status: input.status,
      count: value?.items.length ?? null,
      patients: value ? new Set(value.items.map((item) => item.patient.id)).size : null,
    }),
  },
});

export const reviewBreakGlassInput = z
  .object({
    /** Client-generated (rule 11). */
    id: z.uuid(),
    eventId: z.uuid(),
    outcome: z.enum(REVIEW_OUTCOMES),
    comment: trimmed(1, 1000).nullable(),
  })
  .refine((value) => value.outcome === "appropriate" || value.comment !== null, {
    path: ["comment"],
    message: "A comment is required unless the access was appropriate",
  });

/** Record the review of one event. Only another admin may review it (also enforced in SQL). */
export const reviewBreakGlass = defineService({
  action: "break_glass.review",
  input: reviewBreakGlassInput,
  permission: { resource: "break_glass", action: "review" },
  async run({ tx, input, ctx }): Promise<Outcome<{ patientId: string; alreadyReviewed: boolean }>> {
    const me = caller(ctx);
    const event = await tx.breakGlassEvent.findUnique({
      where: { id: input.eventId },
      select: { userId: true, patientId: true, review: { select: { id: true } } },
    });
    if (!event) return fail("not_found", "breakGlass.error.notFound");
    if (event.userId === me.userId) return fail("self_review", "breakGlass.error.selfReview");
    if (event.review) {
      // The same review sent twice is fine; a second, different review is not.
      if (event.review.id === input.id) return ok({ patientId: event.patientId, alreadyReviewed: true });
      return fail("already_reviewed", "breakGlass.error.alreadyReviewed");
    }
    await tx.breakGlassReview.create({
      data: {
        id: input.id,
        eventId: input.eventId,
        reviewerId: me.userId,
        outcome: input.outcome,
        comment: input.comment,
      },
    });
    return ok({ patientId: event.patientId, alreadyReviewed: false });
  },
  audit: {
    resourceType: "break_glass_event",
    resourceId: (input) => input.eventId,
    patientId: (_input, value) => value?.patientId ?? null,
    metadata: (input, value) => ({ outcome: input.outcome, already_reviewed: value?.alreadyReviewed ?? null }),
  },
});
