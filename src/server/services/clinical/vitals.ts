import "server-only";
import { z } from "zod";
import { VITALS_RANGES, type VitalsField } from "@/lib/domain/vitals";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { actorId } from "../patients/shared";
import { loadVisit, optionalText, requiredText } from "./shared";

/*
 * Vitals (D-007): append-only. Ranges mirror the SQL CHECKs and catch typos; they are pending
 * clinical sign-off (D-037). A correction is a new row pointing at the wrong one, with a reason;
 * with no measurements it strikes the original out.
 */

const measure = (field: VitalsField) => {
  const { min, max, step } = VITALS_RANGES[field];
  return (step === "int" ? z.number().int() : z.number().multipleOf(0.1))
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? null);
};

export const measurementsSchema = z
  .object({
    temperatureC: measure("temperatureC"),
    pulseBpm: measure("pulseBpm"),
    respRate: measure("respRate"),
    bpSystolic: measure("bpSystolic"),
    bpDiastolic: measure("bpDiastolic"),
    spo2Pct: measure("spo2Pct"),
    weightKg: measure("weightKg"),
    heightCm: measure("heightCm"),
    note: optionalText(500),
  })
  .refine((v) => (v.bpSystolic === null) === (v.bpDiastolic === null), {
    path: ["bpDiastolic"],
    message: "Blood pressure needs both numbers",
  })
  .refine((v) => v.bpSystolic === null || v.bpDiastolic === null || v.bpSystolic > v.bpDiastolic, {
    path: ["bpDiastolic"],
    message: "The lower blood pressure number must be below the upper one",
  });

export type Measurements = z.output<typeof measurementsSchema>;

const MEASURED = ["temperatureC", "pulseBpm", "respRate", "bpSystolic", "spo2Pct", "weightKg", "heightCm"] as const;
const measuredFields = (m: Measurements) => MEASURED.filter((key) => m[key] !== null);

/** Record a set of vitals on an open visit. Safe to call twice (client-generated id). */
export const recordVitals = defineService({
  action: "vitals.record",
  input: z.object({ id: z.uuid(), visitId: z.uuid(), patientId: z.uuid(), measurements: measurementsSchema }).refine(
    (v) => measuredFields(v.measurements).length > 0,
    { path: ["measurements"], message: "Record at least one measurement" },
  ),
  permission: { resource: "vitals", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ vitalsId: string; alreadyRecorded: boolean }>> {
    const existing = await tx.vitals.findUnique({ where: { id: input.id }, select: { visitId: true } });
    if (existing) {
      if (existing.visitId !== input.visitId) return fail("id_conflict", "clinical.error.idConflict");
      return ok({ vitalsId: input.id, alreadyRecorded: true });
    }
    const visit = await loadVisit(tx, input.visitId, input.patientId);
    if (!visit) return fail("not_found", "clinical.error.visitNotFound");
    if (visit.status === "closed") return fail("visit_closed", "clinical.error.visitClosed");
    await tx.vitals.create({
      data: { id: input.id, visitId: input.visitId, patientId: input.patientId, ...input.measurements, recordedById: actorId(ctx) },
    });
    return ok({ vitalsId: input.id, alreadyRecorded: false });
  },
  audit: {
    resourceType: "vitals",
    resourceId: (input) => input.id,
    patientId: (input) => input.patientId,
    metadata: (input) => ({ visit_id: input.visitId, fields: measuredFields(input.measurements).join(",") }),
  },
});

/**
 * Correct a wrong entry: a new row that supersedes it, with a reason. Without measurements it
 * strikes the original out. Each row is corrected once; correct the correction to change again.
 * Allowed after the visit closes: a correction never changes what was originally recorded.
 */
export const correctVitals = defineService({
  action: "vitals.correct",
  input: z.object({
    id: z.uuid(),
    patientId: z.uuid(),
    supersedesId: z.uuid(),
    reason: requiredText(3, 500),
    measurements: measurementsSchema.nullish().transform((v) => v ?? null),
  }),
  permission: { resource: "vitals", action: "correct" },
  async run({ tx, input, ctx }): Promise<Outcome<{ vitalsId: string; struckOut: boolean; alreadyRecorded: boolean }>> {
    const struckOut = !input.measurements || measuredFields(input.measurements).length === 0;
    // Two nurses correcting the same row at once: the second sees the first's correction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vitals:${input.supersedesId}`}))`;
    const existing = await tx.vitals.findUnique({ where: { id: input.id }, select: { supersedesId: true } });
    if (existing) {
      if (existing.supersedesId !== input.supersedesId) return fail("id_conflict", "clinical.error.idConflict");
      return ok({ vitalsId: input.id, struckOut, alreadyRecorded: true });
    }
    const original = await tx.vitals.findUnique({
      where: { id: input.supersedesId },
      select: { visitId: true, patientId: true, supersededBy: { select: { id: true } } },
    });
    if (!original || original.patientId !== input.patientId) return fail("not_found", "clinical.error.vitalsNotFound");
    if (original.supersededBy) return fail("already_corrected", "clinical.error.alreadyCorrected");

    const empty = { temperatureC: null, pulseBpm: null, respRate: null, bpSystolic: null, bpDiastolic: null, spo2Pct: null, weightKg: null, heightCm: null, note: null };
    await tx.vitals.create({
      data: {
        id: input.id,
        visitId: original.visitId,
        patientId: input.patientId,
        ...(input.measurements ?? empty),
        supersedesId: input.supersedesId,
        errorReason: input.reason,
        recordedById: actorId(ctx),
      },
    });
    return ok({ vitalsId: input.id, struckOut, alreadyRecorded: false });
  },
  audit: {
    resourceType: "vitals",
    resourceId: (input) => input.id,
    patientId: (input) => input.patientId,
    metadata: (input, value) => ({ supersedes_id: input.supersedesId, struck_out: value?.struckOut ?? null }),
  },
});
