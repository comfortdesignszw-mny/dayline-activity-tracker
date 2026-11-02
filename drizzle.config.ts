import { defineConfig } from "drizzle-kit";

// Drizzle Kit is used ONLY to generate SQL from the schema during development.
// Migrations are applied by `wrangler d1 migrations apply` (see package.json),
// not by drizzle-kit — D1 owns the migration ledger (`d1_migrations`), and two
// tools tracking the same history is how a database ends up half-migrated.
//
// `drizzle-kit generate` writes plain SQL into ./migrations, which is exactly
// the format wrangler reads. The `d1-http` driver is only needed for
// `drizzle-kit push`/`studio` against a REMOTE database; local development
// never touches it.
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./drizzle/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
