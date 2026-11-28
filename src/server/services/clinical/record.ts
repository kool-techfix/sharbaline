import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db/tx";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { actorId, summarySelect, toSummary, type PatientSummary } from "../patients/shared";
import { currentAllergies, type AllergyList } from "./allergies";
import type { NoteFields } from "./notes";

/*
 * Clinical reads (scope §5 M3). Nurses and doctors by role; admins only through break-glass
 * (D-035), which the kernel checks and tags in the audit entry. Pharmacists and lab never reach
 * these (D-004, D-008).
 */

const VISIT_LIMIT = 50;

export interface VitalsView {
  id: string;
  temperatureC: number | null;
  pulseBpm: number | null;
  respRate: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  spo2Pct: number | null;
  weightKg: number | null;
  heightCm: number | null;
  note: string | null;
  recordedAt: Date;
  recordedBy: string | null;
  /** Set on a correction: the row it replaces and why that one was wrong. */
  correction: { supersedesId: string; reason: string } | null;
  /** Set when a later row replaced this one: it is shown as entered in error. */
  supersededById: string | null;
}

export interface NoteVersionView extends NoteFields {
  id: string;
  versionNo: number;
  parentVersionId: string | null;
  isConflict: boolean;
  author: string | null;
  createdAt: Date;
}

export interface VisitSummary {
  id: string;
  visitType: "outpatient" | "follow_up" | "emergency";
  status: "open" | "closed";
  openedAt: Date;
  closedAt: Date | null;
  attendingDoctor: string | null;
  /** The newest note version's complaint and diagnosis, for the timeline. */
  latestNote: { presentingComplaint: string | null; diagnosisText: string | null; versionNo: number; isConflict: boolean } | null;
  /** Current (not superseded) vitals, newest first. */
  vitals: VitalsView[];
}

export interface ClinicalSummary {
  patient: PatientSummary;
  allergies: AllergyList;
  /** Newest first. */
  visits: VisitSummary[];
  truncated: boolean;
}

const vitalsSelect = {
  id: true,
  temperatureC: true,
  pulseBpm: true,
  respRate: true,
  bpSystolic: true,
  bpDiastolic: true,
  spo2Pct: true,
  weightKg: true,
  heightCm: true,
  note: true,
  recordedAt: true,
  recordedById: true,
  supersedesId: true,
  errorReason: true,
  supersededBy: { select: { id: true } },
} satisfies Prisma.VitalsSelect;

type VitalsRow = Prisma.VitalsGetPayload<{ select: typeof vitalsSelect }>;

const num = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

function toVitals(row: VitalsRow, names: Map<string, string>): VitalsView {
  return {
    id: row.id,
    temperatureC: num(row.temperatureC),
    pulseBpm: row.pulseBpm,
    respRate: row.respRate,
    bpSystolic: row.bpSystolic,
    bpDiastolic: row.bpDiastolic,
    spo2Pct: row.spo2Pct,
    weightKg: num(row.weightKg),
    heightCm: num(row.heightCm),
    note: row.note,
    recordedAt: row.recordedAt,
    recordedBy: names.get(row.recordedById) ?? null,
    correction: row.supersedesId ? { supersedesId: row.supersedesId, reason: row.errorReason ?? "" } : null,
    supersededById: row.supersededBy?.id ?? null,
  };
}

/** A strike-out correction carries no measurements: it only marks the original as wrong. */
const isStrikeOut = (v: VitalsView) =>
  v.correction !== null &&
  [v.temperatureC, v.pulseBpm, v.respRate, v.bpSystolic, v.spo2Pct, v.weightKg, v.heightCm].every((x) => x === null);

async function staffNames(tx: Tx, ids: Iterable<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
  return new Map(users.map((user) => [user.id, user.displayName]));
}

/** Header, allergies and the visit timeline for one patient. */
export const getClinicalSummary = defineService({
  action: "clinical.summary",
  input: z.object({ patientId: z.uuid() }),
  permission: { resource: "visits", action: "read" },
  breakGlass: { patientId: (input) => input.patientId },
  async run({ tx, input }): Promise<Outcome<ClinicalSummary>> {
    const patientRow = await tx.patient.findUnique({ where: { id: input.patientId }, select: summarySelect });
    if (!patientRow) return fail("not_found", "patients.error.notFound");
    // Only nurses, doctors and admins (break-glass) get here, and all have the full demographic view.
    const patient = toSummary(patientRow, "full");

    const rows = await tx.visit.findMany({
      where: { patientId: input.patientId },
      orderBy: { openedAt: "desc" },
      take: VISIT_LIMIT + 1,
      select: {
        id: true,
        visitType: true,
        status: true,
        openedAt: true,
        closedAt: true,
        attendingDoctorId: true,
        vitals: { where: { supersededBy: { is: null } }, orderBy: { recordedAt: "desc" }, select: vitalsSelect },
        noteVersions: {
          orderBy: { versionNo: "desc" },
          take: 1,
          select: { presentingComplaint: true, diagnosisText: true, versionNo: true, isConflict: true },
        },
      },
    });
    const page = rows.slice(0, VISIT_LIMIT);
    const names = await staffNames(
      tx,
      page.flatMap((visit) => [visit.attendingDoctorId, ...visit.vitals.map((v) => v.recordedById)]),
    );
    const visits = page.map((visit) => ({
      id: visit.id,
      visitType: visit.visitType,
      status: visit.status,
      openedAt: visit.openedAt,
      closedAt: visit.closedAt,
      attendingDoctor: visit.attendingDoctorId ? (names.get(visit.attendingDoctorId) ?? null) : null,
      latestNote: visit.noteVersions[0] ?? null,
      vitals: visit.vitals.map((row) => toVitals(row, names)).filter((v) => !isStrikeOut(v)),
    }));
    return ok({ patient, allergies: await currentAllergies(tx, input.patientId), visits, truncated: rows.length > VISIT_LIMIT });
  },
  audit: {
    resourceType: "patient",
    resourceId: (input) => input.patientId,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ visits: value?.visits.length ?? null }),
  },
});

export interface VisitDetail extends Omit<VisitSummary, "latestNote" | "vitals"> {
  /** Every vitals row, corrections included, newest first. */
  vitals: VitalsView[];
  /** Every note version, newest first. */
  noteVersions: NoteVersionView[];
  /** The caller's own unsaved draft, if any (doctors). */
  myDraft: { fields: NoteFields; baseVersionId: string | null; updatedAt: Date } | null;
}

/** One visit in full: all vitals with their corrections, every note version, the caller's draft. */
export const getVisit = defineService({
  action: "clinical.visit",
  input: z.object({ patientId: z.uuid(), visitId: z.uuid() }),
  permission: { resource: "visits", action: "read" },
  breakGlass: { patientId: (input) => input.patientId },
  async run({ tx, input, ctx }): Promise<Outcome<VisitDetail>> {
    const userId = actorId(ctx);
    const visit = await tx.visit.findUnique({
      where: { id: input.visitId },
      select: {
        id: true,
        patientId: true,
        visitType: true,
        status: true,
        openedAt: true,
        closedAt: true,
        attendingDoctorId: true,
        vitals: { orderBy: { recordedAt: "desc" }, select: vitalsSelect },
        noteVersions: {
          orderBy: { versionNo: "desc" },
          select: {
            id: true,
            versionNo: true,
            parentVersionId: true,
            isConflict: true,
            authorId: true,
            createdAt: true,
            presentingComplaint: true,
            history: true,
            examination: true,
            diagnosisText: true,
            plan: true,
          },
        },
        noteDrafts: { where: { userId }, select: { content: true, baseVersionId: true, updatedAt: true } },
      },
    });
    if (!visit || visit.patientId !== input.patientId) return fail("not_found", "clinical.error.visitNotFound");

    const names = await staffNames(tx, [
      visit.attendingDoctorId,
      ...visit.vitals.map((v) => v.recordedById),
      ...visit.noteVersions.map((n) => n.authorId),
    ]);
    const draft = visit.noteDrafts[0];
    return ok({
      id: visit.id,
      visitType: visit.visitType,
      status: visit.status,
      openedAt: visit.openedAt,
      closedAt: visit.closedAt,
      attendingDoctor: visit.attendingDoctorId ? (names.get(visit.attendingDoctorId) ?? null) : null,
      vitals: visit.vitals.map((row) => toVitals(row, names)),
      noteVersions: visit.noteVersions.map(({ authorId, ...version }) => ({ ...version, author: names.get(authorId) ?? null })),
      myDraft: draft
        ? { fields: draft.content as unknown as NoteFields, baseVersionId: draft.baseVersionId, updatedAt: draft.updatedAt }
        : null,
    });
  },
  audit: {
    resourceType: "visit",
    resourceId: (input) => input.visitId,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({
      vitals: value?.vitals.length ?? null,
      note_versions: value?.noteVersions.length ?? null,
    }),
  },
});
