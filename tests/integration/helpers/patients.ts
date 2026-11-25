import { randomBytes } from "node:crypto";
import { uuidv7 } from "@/lib/ids";
import type { RegisterPatientInput } from "@/lib/validation/patient";
import { findPossibleDuplicates, registerPatient } from "@/server/services/patients/register";
import { userContext } from "./context";
import type { TestDatabase } from "./db";

/** Synthetic registration details (CLAUDE.md rule 1), unique enough not to look like duplicates. */
export function patientInput(overrides: Partial<RegisterPatientInput> = {}): RegisterPatientInput {
  const tag = randomBytes(4).toString("hex");
  const year = 1940 + (randomBytes(1)[0]! % 70);
  return {
    id: uuidv7(),
    surname: `Testsurname${tag}`,
    firstName: `Synthetic${tag.slice(0, 4)}`,
    otherNames: null,
    sex: "female",
    birth: { kind: "exact", date: `${year}-0${1 + (randomBytes(1)[0]! % 9)}-1${randomBytes(1)[0]! % 9}` },
    phone: null,
    address: "1 Synthetic Close, Test Town",
    legacyCardNumber: null,
    nextOfKin: { name: "Synthetic Kin", relationship: "Sibling", phone: null },
    priorityFolder: false,
    consentConfirmed: true,
    acknowledgedDuplicateIds: [],
    ...overrides,
  };
}

/** Register through the real service as front desk, confirming any duplicate warnings. */
export async function makePatient(t: TestDatabase, overrides: Partial<RegisterPatientInput> = {}) {
  const input = patientInput(overrides);
  const ctx = userContext("front_desk");
  const check = await findPossibleDuplicates(ctx, input, t.db);
  const acknowledged = check.ok ? check.value.candidates.map((c) => c.patient.id) : [];
  const outcome = await registerPatient(ctx, { ...input, acknowledgedDuplicateIds: acknowledged }, t.db);
  if (!outcome.ok) throw new Error(`registration failed: ${outcome.reasonCode}`);
  return { id: input.id, patientNumber: outcome.value.patientNumber, input };
}
