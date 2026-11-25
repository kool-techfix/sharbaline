"use server";

import type { RegisterPatientInput, UpdatePatientInput } from "@/lib/validation/patient";
import { actAsCaller, type ActionResult } from "@/server/http/action-result";
import { findPossibleDuplicates, registerPatient } from "@/server/services/patients/register";
import { searchPatients, updatePatient, type SearchResult } from "@/server/services/patients/records";
import type { DuplicateCandidate } from "@/server/services/patients/shared";
import { addToQueue, markLeftQueue } from "@/server/services/queue/queue";

/*
 * Front desk actions. Every export here is a public endpoint: each acts as the signed-in caller,
 * and the service checks the role, validates, audits and runs in a transaction (rules 4–7).
 * Search runs here, not in a ?q= URL, so patient names never land in URLs or access logs (rule 2).
 */

export async function search(input: { query: string }): Promise<ActionResult<SearchResult>> {
  return actAsCaller((ctx) => searchPatients(ctx, input), (value) => value);
}

export async function checkDuplicates(input: {
  surname: string;
  firstName: string;
  otherNames: string | null;
  birth: RegisterPatientInput["birth"];
  phone: string | null;
}): Promise<ActionResult<{ candidates: DuplicateCandidate[] }>> {
  return actAsCaller((ctx) => findPossibleDuplicates(ctx, input), (value) => value);
}

export async function register(
  input: RegisterPatientInput,
): Promise<ActionResult<{ patientId: string; patientNumber: string }>> {
  return actAsCaller(
    (ctx) => registerPatient(ctx, input),
    (value) => ({ patientId: value.patientId, patientNumber: value.patientNumber }),
  );
}

export async function saveDetails(input: UpdatePatientInput): Promise<ActionResult<{ changed: number }>> {
  return actAsCaller((ctx) => updatePatient(ctx, input), (value) => ({ changed: value.changed.length }));
}

export async function queuePatient(input: {
  id: string;
  patientId: string;
}): Promise<ActionResult<{ position: number; alreadyQueued: boolean }>> {
  return actAsCaller(
    (ctx) => addToQueue(ctx, input),
    (value) => ({ position: value.position, alreadyQueued: value.alreadyQueued }),
  );
}

export async function markLeft(input: { entryId: string }): Promise<ActionResult<null>> {
  return actAsCaller((ctx) => markLeftQueue(ctx, input), () => null);
}
