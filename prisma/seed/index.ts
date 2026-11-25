/**
 * `pnpm db:seed` — loads SYNTHETIC data only (CLAUDE.md rule 1). Never real patients or staff.
 * Refuses to run in production or without ALLOW_SEED=true. Idempotent: existing staff IDs are
 * left alone.
 */
import "dotenv/config";
import { createDb } from "@/server/db/client";
import { withTransaction } from "@/server/db/tx";
import { checkPassword } from "@/server/auth/password-policy";
import { commonPasswords } from "@/server/auth/common-passwords";
import type { Role } from "@/server/permissions/roles";
import { insertUser } from "@/server/services/users/shared";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed: NODE_ENV is production.");
if (process.env.ALLOW_SEED !== "true") {
  throw new Error("Refusing to seed: set ALLOW_SEED=true for a development or test database.");
}
const password = process.env.SEED_DEFAULT_PASSWORD;
if (!password || checkPassword(password, { commonPasswords: commonPasswords() })) {
  throw new Error("Set SEED_DEFAULT_PASSWORD to a password that passes the policy (10+ chars, not common).");
}

/** One synthetic user per role. Doctor, pharmacist and admin enrol in MFA on first sign-in. */
const DEMO_USERS: { staffId: string; displayName: string; role: Role }[] = [
  { staffId: "frontdesk.demo", displayName: "Demo Front Desk", role: "front_desk" },
  { staffId: "nurse.demo", displayName: "Demo Nurse", role: "nurse" },
  { staffId: "doctor.demo", displayName: "Demo Doctor", role: "doctor" },
  { staffId: "lab.demo", displayName: "Demo Lab Scientist", role: "lab" },
  { staffId: "pharmacist.demo", displayName: "Demo Pharmacist", role: "pharmacist" },
  { staffId: "admin.demo", displayName: "Demo Administrator", role: "admin" },
];

const db = createDb(process.env.DATABASE_URL ?? "");
let created = 0;
for (const user of DEMO_USERS) {
  const exists = await db.user.findUnique({ where: { staffId: user.staffId } });
  if (exists) continue;
  await withTransaction(db, (tx) =>
    insertUser(
      tx,
      {
        staffId: user.staffId,
        email: `${user.staffId}@hospital.test`,
        displayName: user.displayName,
        roles: [user.role],
        password,
        mustChangePassword: false,
      },
      new Date(),
    ),
  );
  created++;
}
console.log(`Seed: ${created} demo user(s) created (${DEMO_USERS.length - created} already present).`);

/*
 * Synthetic demo patients (M2), registered through the real service as the demo front desk,
 * so numbers, consent and audit are exactly as in use. Fixed ids make re-running safe: a
 * repeat is recognised as the same registration (rule 11). Names, dates and phones are made
 * up; the phones use a 0700 000 range that isn't assigned to real subscribers.
 */
const DEMO_PATIENTS: { surname: string; firstName: string; sex: "female" | "male"; dob: string; phone: string | null }[] = [
  { surname: "Yusuf", firstName: "Amina", sex: "female", dob: "1991-03-04", phone: "0700 000 0101" },
  { surname: "Okafor", firstName: "Chinedu", sex: "male", dob: "1984-11-20", phone: "0700 000 0102" },
  { surname: "Bello", firstName: "Mariam", sex: "female", dob: "2001-06-15", phone: "0700 000 0103" },
  { surname: "Nwosu", firstName: "Emeka", sex: "male", dob: "1973-01-30", phone: "0700 000 0104" },
  { surname: "Adeyemi", firstName: "Tomi", sex: "female", dob: "1998-09-09", phone: null },
  { surname: "Akinyemi", firstName: "Bola", sex: "female", dob: "1988-12-01", phone: "0700 000 0106" },
  { surname: "Ibrahim", firstName: "Musa", sex: "male", dob: "1965-04-18", phone: "0700 000 0107" },
  { surname: "Eze", firstName: "Ngozi", sex: "female", dob: "1979-07-07", phone: "0700 000 0108" },
  { surname: "Lawal", firstName: "Kemi", sex: "female", dob: "2012-02-25", phone: "0700 000 0109" },
  { surname: "Garba", firstName: "Sadiq", sex: "male", dob: "1993-10-11", phone: "0700 000 0110" },
  { surname: "Obi", firstName: "Ifeoma", sex: "female", dob: "1956-05-05", phone: null },
  { surname: "Balogun", firstName: "Tunde", sex: "male", dob: "1990-08-22", phone: "0700 000 0112" },
];

const { registerPatient } = await import("@/server/services/patients/register");
const desk = await db.user.findUnique({ where: { staffId: "frontdesk.demo" }, select: { id: true } });
if (!desk) throw new Error("frontdesk.demo is missing; it is created above.");
let registered = 0;
for (const [index, patient] of DEMO_PATIENTS.entries()) {
  const outcome = await registerPatient(
    {
      actor: { kind: "user", userId: desk.id, role: "front_desk", sessionId: "00000000-0000-7000-8000-000000000000" },
      requestId: `seed-patient-${index}`,
      ip: null,
      deviceId: null,
    },
    {
      id: `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
      surname: patient.surname,
      firstName: patient.firstName,
      sex: patient.sex,
      birth: { kind: "exact", date: patient.dob },
      phone: patient.phone,
      address: `${index + 1} Demo Street, Sample Town`,
      nextOfKin: { name: "Demo Relative", relationship: "Relative", phone: null },
      consentConfirmed: true,
    },
    db,
  );
  if (!outcome.ok) throw new Error(`Demo patient ${index + 1} not registered: ${outcome.reasonCode}`);
  if (!outcome.value.alreadyRegistered) registered++;
}
await db.$disconnect();
console.log(`Seed complete: ${registered} demo patient(s) registered (${DEMO_PATIENTS.length - registered} already present).`);
