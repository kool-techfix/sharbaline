import "server-only";
import { z } from "zod";
import { defineService } from "@/server/kernel/define-service";
import { fail, ok, type Outcome } from "@/server/kernel/outcome";
import { actorId } from "../patients/shared";
import { loadVisit, optionalText } from "./shared";

/*
 * Consultation notes (scope §5 M3): every save is a new, numbered version; nothing is edited in
 * place. A save names the version it started from. If that is no longer the newest, the save is
 * still kept, flagged as a conflict, and the screen shows both, so nobody's work is silently
 * overwritten. Autosaves go to a per-user draft (D-011), deleted once a version is saved.
 */

export const NOTE_FIELDS = ["presentingComplaint", "history", "examination", "diagnosisText", "plan"] as const;
export type NoteField = (typeof NOTE_FIELDS)[number];

const MAX = 10_000;

export const noteFieldsSchema = z.object({
  presentingComplaint: optionalText(MAX),
  history: optionalText(MAX),
  examination: optionalText(MAX),
  diagnosisText: optionalText(MAX),
  plan: optionalText(MAX),
});
export type NoteFields = z.output<typeof noteFieldsSchema>;

const filledFields = (fields: NoteFields) => NOTE_FIELDS.filter((key) => fields[key] !== null);

/** Save the note as a new version. Safe to call twice (client-generated id). */
export const saveNote = defineService({
  action: "notes.save",
  input: z
    .object({
      id: z.uuid(),
      visitId: z.uuid(),
      patientId: z.uuid(),
      /** The version the author started from; null for the first note. */
      parentVersionId: z.uuid().nullable(),
      fields: noteFieldsSchema,
    })
    .refine((v) => filledFields(v.fields).length > 0, { path: ["fields"], message: "Write something in the note" }),
  permission: { resource: "consultation_notes", action: "create" },
  async run({ tx, input, ctx }): Promise<Outcome<{ versionId: string; versionNo: number; isConflict: boolean; alreadySaved: boolean }>> {
    const userId = actorId(ctx);
    // Locking the visit serialises saves, so version numbers are gap-free and the "newest"
    // check below can't race another save.
    const visit = await loadVisit(tx, input.visitId, input.patientId, true);
    if (!visit) return fail("not_found", "clinical.error.visitNotFound");

    const existing = await tx.visitNoteVersion.findUnique({
      where: { id: input.id },
      select: { visitId: true, versionNo: true, isConflict: true },
    });
    if (existing) {
      if (existing.visitId !== input.visitId) return fail("id_conflict", "clinical.error.idConflict");
      return ok({ versionId: input.id, versionNo: existing.versionNo, isConflict: existing.isConflict, alreadySaved: true });
    }

    const head = await tx.visitNoteVersion.findFirst({
      where: { visitId: input.visitId },
      orderBy: { versionNo: "desc" },
      select: { id: true, versionNo: true },
    });
    if (input.parentVersionId) {
      const parent = await tx.visitNoteVersion.findUnique({ where: { id: input.parentVersionId }, select: { visitId: true } });
      if (!parent || parent.visitId !== input.visitId) return fail("not_found", "clinical.error.noteVersionNotFound");
    }
    const isConflict = (head?.id ?? null) !== input.parentVersionId;
    const versionNo = (head?.versionNo ?? 0) + 1;
    await tx.visitNoteVersion.create({
      data: {
        id: input.id,
        visitId: input.visitId,
        versionNo,
        parentVersionId: input.parentVersionId,
        ...input.fields,
        isConflict,
        authorId: userId,
      },
    });
    await tx.noteDraft.deleteMany({ where: { visitId: input.visitId, userId } });
    return ok({ versionId: input.id, versionNo, isConflict, alreadySaved: false });
  },
  audit: {
    resourceType: "visit_note_version",
    resourceId: (input) => input.id,
    patientId: (input) => input.patientId,
    metadata: (input, value) => ({
      visit_id: input.visitId,
      version_no: value?.versionNo ?? null,
      is_conflict: value?.isConflict ?? null,
      fields: filledFields(input.fields).join(","),
    }),
  },
});

/** Autosave the caller's unsaved note for this visit (D-011). Not part of the clinical record. */
export const saveNoteDraft = defineService({
  action: "notes.draft_save",
  input: z.object({
    visitId: z.uuid(),
    patientId: z.uuid(),
    baseVersionId: z.uuid().nullable(),
    fields: noteFieldsSchema,
  }),
  permission: { resource: "consultation_notes", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<{ savedAt: Date }>> {
    const userId = actorId(ctx);
    const visit = await loadVisit(tx, input.visitId, input.patientId);
    if (!visit) return fail("not_found", "clinical.error.visitNotFound");
    const savedAt = new Date();
    const data = { content: input.fields, baseVersionId: input.baseVersionId, updatedAt: savedAt };
    await tx.noteDraft.upsert({
      where: { visitId_userId: { visitId: input.visitId, userId } },
      create: { visitId: input.visitId, userId, ...data },
      update: data,
    });
    return ok({ savedAt });
  },
  audit: {
    resourceType: "note_draft",
    resourceId: (input) => input.visitId,
    patientId: (input) => input.patientId,
    metadata: (input) => ({ fields: filledFields(input.fields).join(",") }),
  },
});

/** Throw away the caller's draft for this visit. Nothing in the clinical record changes. */
export const discardNoteDraft = defineService({
  action: "notes.draft_discard",
  input: z.object({ visitId: z.uuid(), patientId: z.uuid() }),
  permission: { resource: "consultation_notes", action: "update" },
  async run({ tx, input, ctx }): Promise<Outcome<{ discarded: boolean }>> {
    const visit = await loadVisit(tx, input.visitId, input.patientId);
    if (!visit) return fail("not_found", "clinical.error.visitNotFound");
    const { count } = await tx.noteDraft.deleteMany({ where: { visitId: input.visitId, userId: actorId(ctx) } });
    return ok({ discarded: count > 0 });
  },
  audit: {
    resourceType: "note_draft",
    resourceId: (input) => input.visitId,
    patientId: (input) => input.patientId,
    metadata: (_input, value) => ({ discarded: value?.discarded ?? null }),
  },
});
