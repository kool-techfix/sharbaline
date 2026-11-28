"use server";

import { actAsCaller, type ActionResult } from "@/server/http/action-result";
import { changeAllergy, recordAllergy } from "@/server/services/clinical/allergies";
import { openVisit, sendToDoctor } from "@/server/services/clinical/visits";
import { correctVitals, recordVitals, type Measurements } from "@/server/services/clinical/vitals";
import { searchPatients, type SearchResult } from "@/server/services/patients/records";

/*
 * Nurse actions (M3, D-037). Every export here is a public endpoint: each acts as the signed-in
 * caller, and the service checks the role, validates, audits and runs in a transaction.
 * Ids are generated in the browser, so a retry after a dropped connection is the same request.
 */

export async function search(input: { query: string }): Promise<ActionResult<SearchResult>> {
  return actAsCaller((ctx) => searchPatients(ctx, input), (value) => value);
}

export async function startVisit(input: {
  id: string;
  patientId: string;
  visitType: "outpatient" | "follow_up" | "emergency";
}): Promise<ActionResult<{ visitId: string; alreadyOpen: boolean }>> {
  return actAsCaller((ctx) => openVisit(ctx, input), (value) => value);
}

export async function sendPatientToDoctor(input: {
  visitId: string;
  patientId: string;
}): Promise<ActionResult<{ queueStatus: string | null }>> {
  return actAsCaller((ctx) => sendToDoctor(ctx, input), (value) => value);
}

export async function saveVitals(input: {
  id: string;
  visitId: string;
  patientId: string;
  measurements: Measurements;
}): Promise<ActionResult<{ vitalsId: string }>> {
  return actAsCaller((ctx) => recordVitals(ctx, input), (value) => ({ vitalsId: value.vitalsId }));
}

export async function fixVitals(input: {
  id: string;
  patientId: string;
  supersedesId: string;
  reason: string;
  measurements: Measurements | null;
}): Promise<ActionResult<{ struckOut: boolean }>> {
  return actAsCaller((ctx) => correctVitals(ctx, input), (value) => ({ struckOut: value.struckOut }));
}

export async function addAllergy(
  input:
    | {
        id: string;
        patientId: string;
        kind: "allergy";
        allergen: string;
        reaction: string | null;
        severity: "mild" | "moderate" | "severe" | "unknown";
      }
    | { id: string; patientId: string; kind: "no_known_allergies" },
): Promise<ActionResult<{ allergyId: string }>> {
  return actAsCaller((ctx) => recordAllergy(ctx, input), (value) => ({ allergyId: value.allergyId }));
}

export async function updateAllergy(input: {
  id: string;
  patientId: string;
  supersedesId: string;
  status: "active" | "resolved" | "entered_in_error";
  reason: string | null;
}): Promise<ActionResult<{ allergyId: string }>> {
  return actAsCaller((ctx) => changeAllergy(ctx, input), (value) => ({ allergyId: value.allergyId }));
}
