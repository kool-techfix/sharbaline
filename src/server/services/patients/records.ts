import "server-only";
import { z } from "zod";
import { uuidv7 } from "@/lib/ids";
import { ageInYears } from "@/lib/domain/age";
import { nameSearchKey, normalizeName } from "@/lib/domain/names";
import { parsePatientNumber } from "@/lib/domain/patient-number";
import { normalizeNigerianPhone } from "@/lib/domain/phone";
import { hospitalDateKey } from "@/lib/time";
import { updatePatientSchema } from "@/lib/validation/patient";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { can } from "@/server/permissions/matrix";
import {
  actorId,
  actorRole,
  auditIds,
  dateKey,
  resolveBirth,
  summarySelect,
  toSummary,
  viewFor,
  type PatientSummary,
} from "./shared";

/*
 * Reading and editing patient records (scope §5 M2). Every read is audited with the patient
 * ids it returned (rule 7); search text never is. What each role sees is cut down in
 * shared.ts (D-004, D-008), on the server, before anything leaves the service.
 */

const SEARCH_LIMIT = 20;

export type SearchedBy = "patient_number" | "phone" | "legacy_card" | "name";

export interface SearchResult {
  results: PatientSummary[];
  matchedBy: SearchedBy[];
  /** The input looked like a patient number but its check digit is wrong (D-003). */
  checkDigitInvalid: boolean;
}

/**
 * Find patients by patient number (with or without prefix), phone, legacy card number or
 * name (fuzzy, accents ignored). Lab and pharmacist can't search by phone: they don't see
 * phone numbers, and a match would reveal one.
 */
export const searchPatients = defineService({
  action: "patients.search",
  input: z.object({ query: z.string().trim().min(1).max(100) }),
  permission: { resource: "patient_demographics", action: "read" },
  async run({ tx, input, ctx }): Promise<Outcome<SearchResult>> {
    const view = viewFor(actorRole(ctx));
    const query = input.query;
    const found = new Map<string, SearchedBy>();
    const add = (ids: string[], by: SearchedBy) => ids.forEach((id) => found.has(id) || found.set(id, by));

    const number = parsePatientNumber(query);
    if (number.kind === "valid") {
      const seq = BigInt(number.digits.slice(0, -1));
      const row = await tx.patient.findUnique({ where: { patientSeq: seq }, select: { id: true } });
      if (row) add([row.id], "patient_number");
    }

    const phone = view === "full" ? normalizeNigerianPhone(query) : null;
    if (phone) {
      const rows = await tx.patient.findMany({ where: { phoneE164: phone }, select: { id: true }, take: SEARCH_LIMIT });
      add(rows.map((r) => r.id), "phone");
    }

    if (/\d/.test(query) && query.length <= 40) {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM patient WHERE upper(legacy_card_number) = upper(${query}) LIMIT ${SEARCH_LIMIT}`;
      add(rows.map((r) => r.id), "legacy_card");
    }

    const name = normalizeName(query);
    if (/\p{L}/u.test(name) && name.length >= 2) {
      // Fuzzy: tolerates typos and partial names ("amna" finds "Yusuf Amina").
      await tx.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', '0.4', true)`;
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM patient
         WHERE ${name} <% name_search AND merged_into_id IS NULL
         ORDER BY word_similarity(${name}, name_search) DESC, surname, first_name
         LIMIT ${SEARCH_LIMIT}`;
      add(rows.map((r) => r.id), "name");
    }

    const ids = [...found.keys()].slice(0, SEARCH_LIMIT);
    const rows = ids.length ? await tx.patient.findMany({ where: { id: { in: ids } }, select: summarySelect }) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const now = new Date();
    return ok({
      results: ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toSummary(row, view, now)] : [];
      }),
      matchedBy: [...new Set(found.values())],
      checkDigitInvalid: number.kind === "bad_check_digit" && found.size === 0,
    });
  },
  audit: {
    resourceType: "patient",
    metadata: (_input, value) => ({
      matched_by: value?.matchedBy.join(",") ?? null,
      results: value?.results.length ?? null,
      patient_ids: value ? auditIds(value.results.map((r) => r.id)) : null,
    }),
  },
});

export interface NextOfKinView {
  name: string;
  relationship: string;
  phoneE164: string | null;
}

export type PatientRecord =
  | { view: "identity"; summary: PatientSummary }
  | {
      view: "full";
      summary: PatientSummary;
      address: string | null;
      nextOfKin: NextOfKinView | null;
      paperFolderStatus: "not_digitized" | "partial" | "digitized";
      priorityFolder: boolean;
      possibleDuplicateOf: { id: string; patientNumber: string } | null;
      registeredAt: Date;
      updatedAt: Date;
      /** Today's queue entry, for roles that can see the queue. */
      queueToday: { id: string; position: number; status: string } | null;
    };

/** One patient's record, cut down to what the caller's role may see. */
export const getPatient = defineService({
  action: "patients.view",
  input: z.object({ patientId: z.uuid() }),
  permission: { resource: "patient_demographics", action: "read" },
  async run({ tx, input, ctx }): Promise<Outcome<PatientRecord>> {
    const role = actorRole(ctx);
    const view = viewFor(role);
    const row = await tx.patient.findUnique({
      where: { id: input.patientId },
      select: {
        ...summarySelect,
        address: true,
        paperFolderStatus: true,
        priorityFolder: true,
        createdAt: true,
        updatedAt: true,
        possibleDuplicateOf: { select: { id: true, patientNumber: true } },
        nextOfKin: { orderBy: { createdAt: "asc" }, take: 1, select: { name: true, relationship: true, phoneE164: true } },
      },
    });
    if (!row) return fail("not_found", "patients.error.notFound");
    const summary = toSummary(row, view);
    if (view === "identity") return ok({ view, summary });

    const queueToday = can(role, { resource: "queue", action: "read" })
      ? await tx.queueEntry.findUnique({
          where: { queueDate_patientId: { queueDate: new Date(`${hospitalDateKey(new Date())}T00:00:00Z`), patientId: row.id } },
          select: { id: true, position: true, status: true },
        })
      : null;
    return ok({
      view,
      summary,
      address: row.address,
      nextOfKin: row.nextOfKin[0] ?? null,
      paperFolderStatus: row.paperFolderStatus,
      priorityFolder: row.priorityFolder,
      possibleDuplicateOf: row.possibleDuplicateOf,
      registeredAt: row.createdAt,
      updatedAt: row.updatedAt,
      queueToday,
    });
  },
  audit: { resourceType: "patient", resourceId: (input) => input.patientId, patientId: (input) => input.patientId },
});

const EDITABLE = [
  "surname",
  "firstName",
  "otherNames",
  "sex",
  "dateOfBirth",
  "dobIsEstimated",
  "phoneE164",
  "address",
  "legacyCardNumber",
  "paperFolderStatus",
  "priorityFolder",
] as const;

/**
 * Edit demographics (front desk, doctor). The patient number never changes (trigger). Refuses
 * when the record changed since the caller read it, so nobody silently overwrites someone
 * else's correction. The audit lists which fields changed, never their values.
 */
export const updatePatient = defineService({
  action: "patients.update",
  input: updatePatientSchema,
  permission: { resource: "patient_demographics", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<{ changed: string[]; updatedAt: Date }>> {
    const now = new Date();
    const rows = await tx.$queryRaw<{ updated_at: Date }[]>`
      SELECT updated_at FROM patient WHERE id = ${input.patientId}::uuid FOR UPDATE`;
    const current = await tx.patient.findUnique({
      where: { id: input.patientId },
      include: { nextOfKin: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    if (!rows[0] || !current) return fail("not_found", "patients.error.notFound");
    if (rows[0].updated_at.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
      return fail("changed_elsewhere", "patients.error.changedElsewhere");
    }
    const birth = resolveBirth(input.birth, now);
    if (!birth) return fail("invalid_birth_date", "patients.error.invalidBirthDate");
    // An estimated date whose age hasn't changed keeps its stored date: re-estimating on every
    // edit would drift it.
    const keepsEstimate =
      input.birth.kind === "estimated" &&
      current.dobIsEstimated &&
      ageInYears(dateKey(current.dateOfBirth), hospitalDateKey(now)) === input.birth.ageYears;

    const next = {
      surname: input.surname,
      firstName: input.firstName,
      otherNames: input.otherNames,
      sex: input.sex,
      dateOfBirth: keepsEstimate ? dateKey(current.dateOfBirth) : birth.dateOfBirth,
      dobIsEstimated: birth.dobIsEstimated,
      phoneE164: input.phone,
      address: input.address,
      legacyCardNumber: input.legacyCardNumber,
      paperFolderStatus: input.paperFolderStatus,
      priorityFolder: input.priorityFolder,
    };
    const before = { ...current, dateOfBirth: dateKey(current.dateOfBirth) };
    const changed: string[] = EDITABLE.filter((field) => before[field] !== next[field]);

    const kin = current.nextOfKin[0];
    if (input.nextOfKin) {
      const kinChanged =
        !kin ||
        kin.name !== input.nextOfKin.name ||
        kin.relationship !== input.nextOfKin.relationship ||
        kin.phoneE164 !== input.nextOfKin.phone;
      if (kinChanged) {
        changed.push("nextOfKin");
        if (kin) {
          await tx.nextOfKin.update({
            where: { id: kin.id },
            data: { name: input.nextOfKin.name, relationship: input.nextOfKin.relationship, phoneE164: input.nextOfKin.phone },
          });
        } else {
          await tx.nextOfKin.create({
            data: {
              id: uuidv7(),
              patientId: current.id,
              name: input.nextOfKin.name,
              relationship: input.nextOfKin.relationship,
              phoneE164: input.nextOfKin.phone,
              createdAt: now,
            },
          });
        }
      }
    }
    if (changed.length === 0) return ok({ changed, updatedAt: current.updatedAt });

    await tx.patient.update({
      where: { id: current.id },
      data: {
        ...next,
        dateOfBirth: new Date(`${next.dateOfBirth}T00:00:00Z`),
        nameSearch: nameSearchKey(next),
        updatedAt: now,
        updatedById: actorId(ctx),
      },
    });
    return ok({ changed, updatedAt: now });
  },
  audit: {
    resourceType: "patient",
    resourceId: (input) => input.patientId,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ fields: value?.changed.join(",") ?? null }),
  },
});
