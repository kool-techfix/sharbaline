/**
 * `pnpm db:seed` — loads SYNTHETIC data only (CLAUDE.md rule 1). Never real patients or staff.
 * Refuses to run in production or without ALLOW_SEED=true. Seed modules are added per slice
 * (the login slice adds one synthetic user per role).
 */
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed: NODE_ENV is production.");
}
if (process.env.ALLOW_SEED !== "true") {
  throw new Error("Refusing to seed: set ALLOW_SEED=true for a development or test database.");
}

console.log("Nothing to seed yet.");
