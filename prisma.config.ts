import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma CLI (migrate, studio) connects as hms_owner, the role that owns the schema.
// The running app connects as hms_app via DATABASE_URL (see src/server/db/client.ts),
// which has no DDL rights and no UPDATE/DELETE on append-only tables.
// process.env (not env()) so `prisma generate` works without a database configured.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed/index.ts",
  },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL,
  },
});
