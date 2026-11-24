/** `pnpm db:migrate:down` — roll back the latest applied migration on the dev database. */
import "dotenv/config";
import { rollbackLatest } from "./migrations";

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) throw new Error("MIGRATE_DATABASE_URL is not set.");
if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to roll back in production. Follow docs/runbooks instead.");
}

const name = await rollbackLatest(url);
console.log(name ? `Rolled back ${name}` : "No applied migrations to roll back.");
