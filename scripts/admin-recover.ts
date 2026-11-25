/**
 * `pnpm admin:recover --staff-id <id>`
 *
 * Last resort when the ONLY active administrator has lost their authenticator or password.
 * Server console only, with the hospital's written approval: see
 * docs/runbooks/lost-mfa-device.md. Replaces both factors and prints a temporary password once.
 * Refuses while any other active administrator exists (they reset it in the app instead).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { uuidv7 } from "@/lib/ids";
import { createDb } from "@/server/db/client";
import { ValidationError } from "@/server/kernel/errors";
import { recoverSoleAdmin } from "@/server/services/users/bootstrap";

// pnpm forwards a literal "--" if the caller types one; accept both forms.
const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
const { values } = parseArgs({ args, options: { "staff-id": { type: "string" } } });
if (!values["staff-id"]) {
  console.error("Usage: pnpm admin:recover --staff-id <id>");
  process.exit(2);
}

const REFUSALS: Record<string, string> = {
  not_an_active_admin: "No active administrator has that staff ID. Check the ID; this command is only for administrators.",
  other_admin_exists:
    "Another active administrator exists. They must reset this authenticator in the app (Users → the person → Reset authenticator).",
};

const db = createDb(process.env.DATABASE_URL ?? "");
try {
  const outcome = await recoverSoleAdmin(
    { actor: { kind: "anonymous" }, requestId: `cli-recover-${uuidv7()}`, ip: null, deviceId: null },
    { staffId: values["staff-id"] },
    db,
  );
  if (!outcome.ok) {
    console.error(REFUSALS[outcome.reasonCode] ?? `Recovery refused: ${outcome.reasonCode}`);
    process.exitCode = 1;
  } else {
    console.log("Administrator access recovered. Their authenticator, recovery codes and sessions are revoked.");
    console.log(`  Staff ID:           ${values["staff-id"]}`);
    console.log(`  Temporary password: ${outcome.value.temporaryPassword}`);
    console.log("Hand this over in person after checking their identity. At sign-in they choose a new password,");
    console.log("then set up a new authenticator. Then create a second administrator straight away.");
  }
} catch (error) {
  if (!(error instanceof ValidationError)) throw error;
  console.error("Invalid staff ID: use 3-64 letters, digits, dots, hyphens or underscores.");
  process.exitCode = 2;
} finally {
  await db.$disconnect();
}
