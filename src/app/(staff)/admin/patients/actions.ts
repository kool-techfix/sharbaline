"use server";

import { actAsCaller, type ActionResult } from "@/server/http/action-result";
import { endBreakGlass, startBreakGlass, type BreakGlassReason } from "@/server/services/break-glass/break-glass";
import { searchPatients, type SearchResult } from "@/server/services/patients/records";

/*
 * Admin patient actions. Every export here is a public endpoint: each acts as the signed-in
 * caller, and the service checks the role, validates, audits and runs in a transaction.
 * Search runs here, not in a ?q= URL, so patient names never land in URLs (rule 2).
 */

export async function search(input: { query: string }): Promise<ActionResult<SearchResult>> {
  return actAsCaller((ctx) => searchPatients(ctx, input), (value) => value);
}

export async function openClinicalRecord(input: {
  id: string;
  patientId: string;
  reasonCategory: BreakGlassReason;
  reasonDetails: string;
}): Promise<ActionResult<{ expiresAt: string }>> {
  return actAsCaller((ctx) => startBreakGlass(ctx, input), (value) => ({ expiresAt: value.expiresAt.toISOString() }));
}

export async function endAccess(input: { eventId: string }): Promise<ActionResult<null>> {
  return actAsCaller((ctx) => endBreakGlass(ctx, input), () => null);
}
