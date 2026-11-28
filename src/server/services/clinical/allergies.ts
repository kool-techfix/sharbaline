import "server-only";
import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import type { Tx } from "@/server/db/tx";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { actorId } from "../patients/shared";
import { optionalText, requiredText } from "./shared";

/*
 * Allergies (D-007): append-only. A change is a new row superseding the current one; the
 * current list is the rows nothing supersedes, excluding entered-in-error ones. "No known
 * allergies" is recorded explicitly and never assumed from an empty list.
 */

export const ALLERGY_SEVERITIES = ["mild", "moderate", "severe", "unknown"] as const;
export const ALLERGY_STATUSES = ["active", "resolved", "entered_in_error"] as const;

export interface CurrentAllergy {
  id: string;
  allergen: string;
  reaction: string | null;
  severity: (typeof ALLERGY_SEVERITIES)[number] | null;
  status: "active" | "resolved";
  recordedAt: Date;
}

export interface AllergyList {
  /** Current rows, active first. Entered-in-error rows are left out. */
  allergies: CurrentAllergy[];
  /** True only when someone recorded "no known allergies" and no active allergy exists since. */
  noKnownAllergies: boolean;
}

/** The patient's current allergy state, from the rows nothing supersedes. */
export async function currentAllergies(tx: Tx, patientId: string): Promise<AllergyList> {
  const rows = await tx.patientAllergy.findMany({
    where: { patientId, supersededBy: { is: null } },
    orderBy: { recordedAt: "asc" },
    select: { id: true, kind: true, allergen: true, reaction: true, severity: true, status: true, recordedAt: true },
  });
  const allergies = rows
    .filter((row) => row.kind === "allergy" && row.status !== "entered_in_error")
    .map((row) => ({
      id: row.id,
      allergen: row.allergen ?? "",
      reaction: row.reaction,
      severity: row.severity,
      status: row.status as "active" | "resolved",
      recordedAt: row.recordedAt,
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1));
  const noKnownAllergies =
    rows.some((row) => row.kind === "no_known_allergies" && row.status === "active") &&
    !allergies.some((allergy) => allergy.status === "active");
  return { allergies, noKnownAllergies };
}

/** Allergy chips for a patient header: every role that may read allergies; admins via break-glass. */
export const getAllergies = defineService({
  action: "allergies.view",
  input: z.object({ patientId: z.uuid() }),
  permission: { resource: "allergies", action: "read" },
  breakGlass: { patientId: (input) => input.patientId },
  async run({ tx, input }): Promise<Outcome<AllergyList>> {
    const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
    if (!patient) return fail("not_found", "patients.error.notFound");
    return ok(await currentAllergies(tx, input.patientId));
  },
  audit: {
    resourceType: "patient_allergy",
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ count: value?.allergies.length ?? null }),
  },
});

export const recordAllergyInput = z.discriminatedUnion("kind", [
  z.object({
    id: z.uuid(),
    patientId: z.uuid(),
    kind: z.literal("allergy"),
    allergen: requiredText(1, 100),
    reaction: optionalText(200),
    severity: z.enum(ALLERGY_SEVERITIES).default("unknown"),
  }),
  z.object({ id: z.uuid(), patientId: z.uuid(), kind: z.literal("no_known_allergies") }),
]);

/**
 * Record an allergy, or that the patient has none known. Recording an allergy retires an earlier
 * "no known allergies"; recording "none known" is refused while an allergy is active.
 */
export const recordAllergy = defineService({
  action: "allergies.record",
  input: recordAllergyInput,
  permission: { resource: "allergies", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ allergyId: string; alreadyRecorded: boolean }>> {
    const userId = actorId(ctx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`allergy:${input.patientId}`}))`;
    const existing = await tx.patientAllergy.findUnique({ where: { id: input.id }, select: { patientId: true } });
    if (existing) {
      if (existing.patientId !== input.patientId) return fail("id_conflict", "clinical.error.idConflict");
      return ok({ allergyId: input.id, alreadyRecorded: true });
    }
    const patient = await tx.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
    if (!patient) return fail("not_found", "patients.error.notFound");

    const current = await tx.patientAllergy.findMany({
      where: { patientId: input.patientId, supersededBy: { is: null }, status: "active" },
      select: { id: true, kind: true },
    });
    const noneKnown = current.filter((row) => row.kind === "no_known_allergies");

    if (input.kind === "no_known_allergies") {
      if (current.some((row) => row.kind === "allergy")) return fail("has_active_allergies", "clinical.error.hasActiveAllergies");
      if (noneKnown.length > 0) return ok({ allergyId: noneKnown[0]!.id, alreadyRecorded: true });
      await tx.patientAllergy.create({
        data: { id: input.id, patientId: input.patientId, kind: "no_known_allergies", status: "active", recordedById: userId },
      });
      return ok({ allergyId: input.id, alreadyRecorded: false });
    }

    for (const row of noneKnown) {
      await tx.patientAllergy.create({
        data: {
          id: uuidv7(),
          patientId: input.patientId,
          kind: "no_known_allergies",
          status: "resolved",
          supersedesId: row.id,
          reason: "Allergy recorded",
          recordedById: userId,
        },
      });
    }
    await tx.patientAllergy.create({
      data: {
        id: input.id,
        patientId: input.patientId,
        kind: "allergy",
        allergen: input.allergen,
        reaction: input.reaction,
        severity: input.severity,
        status: "active",
        recordedById: userId,
      },
    });
    return ok({ allergyId: input.id, alreadyRecorded: false });
  },
  audit: {
    resourceType: "patient_allergy",
    resourceId: (input) => input.id,
    patientId: (input) => input.patientId,
    metadata: (input, value) => ({
      kind: input.kind,
      severity: input.kind === "allergy" ? input.severity : null,
      already_recorded: value?.alreadyRecorded ?? null,
    }),
  },
});

/**
 * Change an allergy's status (active, resolved, entered in error) or its reaction and severity:
 * a new row superseding the current one. Refused when someone else changed it first.
 */
export const changeAllergy = defineService({
  action: "allergies.change",
  input: z
    .object({
      id: z.uuid(),
      patientId: z.uuid(),
      supersedesId: z.uuid(),
      status: z.enum(ALLERGY_STATUSES),
      reaction: optionalText(200),
      severity: z.enum(ALLERGY_SEVERITIES).nullish().transform((v) => v ?? null),
      reason: optionalText(500),
    })
    .refine((v) => v.status !== "entered_in_error" || (v.reason !== null && v.reason.length >= 3), {
      path: ["reason"],
      message: "Say why it was entered in error",
    }),
  permission: { resource: "allergies", action: "correct" },
  async run({ tx, input, ctx }): Promise<Outcome<{ allergyId: string; alreadyRecorded: boolean }>> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`allergy:${input.patientId}`}))`;
    const existing = await tx.patientAllergy.findUnique({ where: { id: input.id }, select: { supersedesId: true } });
    if (existing) {
      if (existing.supersedesId !== input.supersedesId) return fail("id_conflict", "clinical.error.idConflict");
      return ok({ allergyId: input.id, alreadyRecorded: true });
    }
    const target = await tx.patientAllergy.findUnique({
      where: { id: input.supersedesId },
      select: { patientId: true, kind: true, allergen: true, reaction: true, severity: true, supersededBy: { select: { id: true } } },
    });
    if (!target || target.patientId !== input.patientId || target.kind !== "allergy") {
      return fail("not_found", "clinical.error.allergyNotFound");
    }
    if (target.supersededBy) return fail("changed_elsewhere", "clinical.error.allergyChanged");
    await tx.patientAllergy.create({
      data: {
        id: input.id,
        patientId: input.patientId,
        kind: "allergy",
        allergen: target.allergen,
        reaction: input.reaction ?? target.reaction,
        severity: input.severity ?? target.severity,
        status: input.status,
        supersedesId: input.supersedesId,
        reason: input.reason,
        recordedById: actorId(ctx),
      },
    });
    return ok({ allergyId: input.id, alreadyRecorded: false });
  },
  audit: {
    resourceType: "patient_allergy",
    resourceId: (input) => input.id,
    patientId: (input) => input.patientId,
    metadata: (input) => ({ supersedes_id: input.supersedesId, status: input.status }),
  },
});
