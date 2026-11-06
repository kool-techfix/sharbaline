/**
 * `pnpm admin:bootstrap --staff-id <id> --name "<display name>" [--email <email>]`
 *
 * Creates the FIRST administrator on a new installation, on the server console only. Prints a
 * temporary password once; the admin must change it and enrol an authenticator at first sign-in.
 * Refuses if any active admin exists. See docs/runbooks/admin-bootstrap.md.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { uuidv7 } from "@/lib/ids";
import { createDb } from "@/server/db/client";
import { bootstrapAdmin } from "@/server/services/users/bootstrap";

// pnpm forwards a literal "--" if the caller types one; accept both forms.
const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
const { values } = parseArgs({
  args,
  options: {
    "staff-id": { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
  },
});
if (!values["staff-id"] || !values.name) {
  console.error('Usage: pnpm admin:bootstrap --staff-id <id> --name "<display name>" [--email <email>]');
  process.exit(2);
}

const db = createDb(process.env.DATABASE_URL ?? "");
try {
  const outcome = await bootstrapAdmin(
    { actor: { kind: "anonymous" }, requestId: `cli-bootstrap-${uuidv7()}`, ip: null, deviceId: null },
    { staffId: values["staff-id"], email: values.email ?? null, displayName: values.name },
    db,
  );
  if (!outcome.ok) {
    console.error(
      outcome.reasonCode === "admin_exists"
        ? "An active administrator already exists. Create further accounts from the admin screens."
        : `Bootstrap refused: ${outcome.reasonCode}`,
    );
    process.exitCode = 1;
  } else {
    console.log("First administrator created.");
    console.log(`  Staff ID:           ${values["staff-id"]}`);
    console.log(`  Temporary password: ${outcome.value.temporaryPassword}`);
    console.log("Hand this over in person. It must be changed at first sign-in, then an authenticator is set up.");
  }
} finally {
  await db.$disconnect();
}
