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
await db.$disconnect();
console.log(`Seed complete: ${created} demo user(s) created (${DEMO_USERS.length - created} already present).`);
