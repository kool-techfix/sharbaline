import { z } from "zod";
import { normalizeNigerianPhone } from "@/lib/domain/phone";

/*
 * Patient input schemas, shared by the registration/edit forms and the services (validated
 * again on the server; the form's copy is only for early feedback). No server imports.
 */

const name = z.string().trim().min(1).max(100);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** A Nigerian phone number in any common form, stored as E.164; empty means none. */
export const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const e164 = normalizeNigerianPhone(value);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: "phone" });
      return z.NEVER;
    }
    return e164;
  });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Exact date of birth, or an age in years when the date isn't known (stored as estimated). */
export const birthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), date: isoDate }),
  z.object({ kind: z.literal("estimated"), ageYears: z.number().int().min(0).max(130) }),
]);

export const nextOfKinSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().min(1).max(60),
  phone: phoneSchema,
});

export const patientDetailsSchema = z.object({
  surname: name,
  firstName: name,
  otherNames: optionalText(100),
  sex: z.enum(["female", "male"]),
  birth: birthSchema,
  phone: phoneSchema,
  address: optionalText(300),
  legacyCardNumber: optionalText(40),
  nextOfKin: nextOfKinSchema.nullish().transform((value) => value ?? null),
  priorityFolder: z.boolean().default(false),
});

export const registerPatientSchema = patientDetailsSchema.extend({
  /** Client-generated (rule 11): a retried registration returns the same patient. */
  id: z.uuid(),
  /** The patient (or guardian) agreed to the hospital's data notice, version CONSENT_VERSION. */
  consentConfirmed: z.literal(true),
  /** Possible duplicates the user has seen and confirmed are different people. */
  acknowledgedDuplicateIds: z.array(z.uuid()).max(25).default([]),
});

export const updatePatientSchema = patientDetailsSchema.extend({
  patientId: z.uuid(),
  /** updatedAt as last read: a change made meanwhile by someone else is refused, not overwritten. */
  expectedUpdatedAt: z.iso.datetime(),
  paperFolderStatus: z.enum(["not_digitized", "partial", "digitized"]),
});

export type PatientDetailsInput = z.input<typeof patientDetailsSchema>;
export type RegisterPatientInput = z.input<typeof registerPatientSchema>;
export type UpdatePatientInput = z.input<typeof updatePatientSchema>;
