import "server-only";
import { ageInYears, estimatedDateOfBirth } from "@/lib/domain/age";
import { DUPLICATE_THRESHOLD, duplicateScore } from "@/lib/domain/duplicates";
import { nameSearchKey } from "@/lib/domain/names";
import { PREFIX_PATTERN, formatPatientNumber } from "@/lib/domain/patient-number";
import { hospitalDateKey } from "@/lib/time";
import type { Tx } from "@/server/db/tx";
import type { RequestContext } from "@/server/kernel/context";
import type { Role } from "@/server/permissions/roles";

/**
 * Consent notice version recorded at registration. "draft-1" is a placeholder until the
 * hospital supplies its NDPA wording (D-032); it must change before go-live.
 */
export const CONSENT_VERSION = "draft-1";

// ─── What each role may see (scope §4.1, D-004, D-008) ───

/**
 * full: front desk, nurse, doctor, admin (demographics R).
 * identity: lab ("basic identity") and pharmacist ("limited": name, age, sex, patient ID;
 * allergies join in M3). Never phone, address, date of birth or next of kin.
 */
export type PatientView = "full" | "identity";

export function viewFor(role: Role): PatientView {
  return role === "lab" || role === "pharmacist" ? "identity" : "full";
}

export function actorRole(ctx: RequestContext): Role {
  if (ctx.actor.kind !== "user") throw new Error("A signed-in user is required");
  return ctx.actor.role;
}

export function actorId(ctx: RequestContext): string {
  if (ctx.actor.kind !== "user") throw new Error("A signed-in user is required");
  return ctx.actor.userId;
}

export interface PatientIdentity {
  view: "identity";
  id: string;
  patientNumber: string;
  surname: string;
  firstName: string;
  otherNames: string | null;
  sex: "female" | "male";
  age: number;
  ageIsEstimated: boolean;
}

export interface PatientSummaryFull extends Omit<PatientIdentity, "view"> {
  view: "full";
  dateOfBirth: string;
  phoneE164: string | null;
  legacyCardNumber: string | null;
}

export type PatientSummary = PatientIdentity | PatientSummaryFull;

/** The columns a summary needs; select only these. */
export const summarySelect = {
  id: true,
  patientNumber: true,
  surname: true,
  firstName: true,
  otherNames: true,
  sex: true,
  dateOfBirth: true,
  dobIsEstimated: true,
  phoneE164: true,
  legacyCardNumber: true,
} as const;

type SummaryRow = {
  id: string;
  patientNumber: string;
  surname: string;
  firstName: string;
  otherNames: string | null;
  sex: "female" | "male";
  dateOfBirth: Date;
  dobIsEstimated: boolean;
  phoneE164: string | null;
  legacyCardNumber: string | null;
};

export const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export function toSummary(row: SummaryRow, view: PatientView, now = new Date()): PatientSummary {
  const identity = {
    id: row.id,
    patientNumber: row.patientNumber,
    surname: row.surname,
    firstName: row.firstName,
    otherNames: row.otherNames,
    sex: row.sex,
    age: ageInYears(dateKey(row.dateOfBirth), hospitalDateKey(now)),
    ageIsEstimated: row.dobIsEstimated,
  };
  if (view === "identity") return { view, ...identity };
  return {
    view,
    ...identity,
    dateOfBirth: dateKey(row.dateOfBirth),
    phoneE164: row.phoneE164,
    legacyCardNumber: row.legacyCardNumber,
  };
}

/** Patient ids for audit metadata: opaque ids only, never names (rule 2). */
export function auditIds(ids: readonly string[]): string {
  return ids.join(",");
}

// ─── Birth date ───

export function resolveBirth(
  birth: { kind: "exact"; date: string } | { kind: "estimated"; ageYears: number },
  now = new Date(),
): { dateOfBirth: string; dobIsEstimated: boolean } | null {
  const today = hospitalDateKey(now);
  if (birth.kind === "estimated") return { dateOfBirth: estimatedDateOfBirth(birth.ageYears, today), dobIsEstimated: true };
  const parsed = new Date(`${birth.date}T00:00:00Z`);
  // A real calendar date, not in the future, and not before the DB's lower bound.
  if (Number.isNaN(parsed.getTime()) || dateKey(parsed) !== birth.date) return null;
  if (birth.date > today || birth.date < "1880-01-01") return null;
  return { dateOfBirth: birth.date, dobIsEstimated: false };
}

// ─── Duplicates ───

export interface DuplicateCandidate {
  patient: PatientSummaryFull;
  score: number;
}

/**
 * Likely duplicates of a new registration: the database narrows by name trigrams, phone, or
 * date of birth plus a weaker name match; lib/domain/duplicates scores them.
 */
export async function findDuplicateCandidates(
  tx: Tx,
  facts: { surname: string; firstName: string; otherNames: string | null; dateOfBirth: string; dobIsEstimated: boolean; phoneE164: string | null },
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const key = nameSearchKey(facts);
  await tx.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', '0.5', true)`;
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM patient
     WHERE (${key} <% name_search
            OR (${facts.phoneE164}::text IS NOT NULL AND phone_e164 = ${facts.phoneE164})
            OR (date_of_birth = ${facts.dateOfBirth}::date AND similarity(name_search, ${key}) > 0.3))
       AND merged_into_id IS NULL
     LIMIT 50`;
  const candidateIds = ids.map((row) => row.id).filter((id) => id !== excludeId);
  if (candidateIds.length === 0) return [];
  const rows = await tx.patient.findMany({ where: { id: { in: candidateIds } }, select: summarySelect });
  const subject = { fullName: key, dateOfBirth: facts.dateOfBirth, dobIsEstimated: facts.dobIsEstimated, phoneE164: facts.phoneE164 };
  return rows
    .map((row) => ({
      patient: toSummary(row, "full") as PatientSummaryFull,
      score: duplicateScore(subject, {
        fullName: nameSearchKey(row),
        dateOfBirth: dateKey(row.dateOfBirth),
        dobIsEstimated: row.dobIsEstimated,
        phoneE164: row.phoneE164,
      }),
    }))
    .filter((candidate) => candidate.score >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// ─── Patient numbers ───

export async function nextPatientNumber(tx: Tx): Promise<{ patientNumber: string; patientSeq: bigint }> {
  const setting = await tx.hospitalSetting.findUnique({ where: { key: "patient_number_prefix" } });
  const prefix = typeof setting?.value === "string" ? setting.value : "";
  if (!PREFIX_PATTERN.test(prefix)) throw new Error("hospital_setting patient_number_prefix is missing or invalid");
  const [row] = await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('patient_number_seq') AS seq`;
  const patientSeq = row!.seq;
  return { patientSeq, patientNumber: formatPatientNumber(prefix, patientSeq) };
}
