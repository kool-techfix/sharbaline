import "server-only";
import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import { nameSearchKey } from "@/lib/domain/names";
import { birthSchema, phoneSchema, registerPatientSchema } from "@/lib/validation/patient";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import {
  CONSENT_VERSION,
  actorId,
  auditIds,
  findDuplicateCandidates,
  nextPatientNumber,
  resolveBirth,
  type DuplicateCandidate,
} from "./shared";

/*
 * Registration (scope §5 M2). Front desk only (demographics C). Duplicates: the form asks
 * findPossibleDuplicates first and shows any matches; registerPatient checks again on the
 * server and refuses unless every current match was explicitly confirmed as a different person.
 * Each confirmation is kept in duplicate_override (append-only) and audited.
 */

/** Possible existing records for the details being registered. Audited (it reads patients). */
export const findPossibleDuplicates = defineService({
  action: "patients.duplicate_check",
  input: z.object({
    surname: z.string().trim().min(1).max(100),
    firstName: z.string().trim().min(1).max(100),
    otherNames: z.string().trim().max(100).nullish().transform((v) => v || null),
    birth: birthSchema,
    phone: phoneSchema,
  }),
  permission: { resource: "patient_demographics", action: "create" },
  async run({ tx, input }): Promise<Outcome<{ candidates: DuplicateCandidate[] }>> {
    const birth = resolveBirth(input.birth);
    if (!birth) return fail("invalid_birth_date", "patients.error.invalidBirthDate");
    const candidates = await findDuplicateCandidates(tx, { ...input, ...birth, phoneE164: input.phone });
    return ok({ candidates });
  },
  audit: {
    resourceType: "patient",
    metadata: (_input, value) => ({
      results: value?.candidates.length ?? null,
      patient_ids: value ? auditIds(value.candidates.map((c) => c.patient.id)) : null,
    }),
  },
});

export interface Registered {
  patientId: string;
  patientNumber: string;
  duplicatesOverridden: number;
  /** True when this request was a retry of one that had already registered the patient. */
  alreadyRegistered: boolean;
}

export const registerPatient = defineService({
  action: "patients.register",
  input: registerPatientSchema,
  permission: { resource: "patient_demographics", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<Registered>> {
    const now = new Date();
    const userId = actorId(ctx);

    // Rule 11: a retry of the same registration returns the same patient, never a second one.
    const existing = await tx.patient.findUnique({
      where: { id: input.id },
      select: { patientNumber: true, createdById: true },
    });
    if (existing) {
      if (existing.createdById !== userId) return fail("id_conflict", "patients.error.idConflict");
      return ok({ patientId: input.id, patientNumber: existing.patientNumber, duplicatesOverridden: 0, alreadyRegistered: true });
    }

    const birth = resolveBirth(input.birth, now);
    if (!birth) return fail("invalid_birth_date", "patients.error.invalidBirthDate");

    const candidates = await findDuplicateCandidates(tx, { ...input, ...birth, phoneE164: input.phone });
    const unconfirmed = candidates.filter((c) => !input.acknowledgedDuplicateIds.includes(c.patient.id));
    if (unconfirmed.length > 0) {
      return fail("possible_duplicate", "patients.error.possibleDuplicate", {
        metadata: { candidates: candidates.length, patient_ids: auditIds(unconfirmed.map((c) => c.patient.id)) },
      });
    }

    const { patientNumber, patientSeq } = await nextPatientNumber(tx);
    await tx.patient.create({
      data: {
        id: input.id,
        patientNumber,
        patientSeq,
        legacyCardNumber: input.legacyCardNumber,
        surname: input.surname,
        firstName: input.firstName,
        otherNames: input.otherNames,
        sex: input.sex,
        dateOfBirth: new Date(`${birth.dateOfBirth}T00:00:00Z`),
        dobIsEstimated: birth.dobIsEstimated,
        phoneE164: input.phone,
        address: input.address,
        nameSearch: nameSearchKey(input),
        priorityFolder: input.priorityFolder,
        consentVersion: CONSENT_VERSION,
        consentRecordedAt: now,
        consentRecordedById: userId,
        possibleDuplicateOfId: candidates[0]?.patient.id ?? null,
        createdAt: now,
        createdById: userId,
        updatedAt: now,
        updatedById: userId,
      },
    });
    if (input.nextOfKin) {
      await tx.nextOfKin.create({
        data: {
          id: uuidv7(),
          patientId: input.id,
          name: input.nextOfKin.name,
          relationship: input.nextOfKin.relationship,
          phoneE164: input.nextOfKin.phone,
          createdAt: now,
        },
      });
    }
    if (candidates.length > 0) {
      await tx.duplicateOverride.createMany({
        data: candidates.map((candidate) => ({
          id: uuidv7(),
          newPatientId: input.id,
          suspectedPatientId: candidate.patient.id,
          score: Math.round(candidate.score * 100),
          confirmedById: userId,
          confirmedAt: now,
        })),
      });
    }
    return ok({ patientId: input.id, patientNumber, duplicatesOverridden: candidates.length, alreadyRegistered: false });
  },
  audit: {
    resourceType: "patient",
    resourceId: (input) => input.id,
    patientId: (input) => input.id,
    metadata: (_input, value) => ({
      duplicates_overridden: value?.duplicatesOverridden ?? null,
      retry: value?.alreadyRegistered ?? null,
    }),
  },
});
