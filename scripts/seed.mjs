#!/usr/bin/env node
// Verify (and if needed apply) the D1 schema + seeded categories.
//
// `wrangler d1 migrations apply` already seeds the fourteen categories — they
// live in migrations/0001_init.sql, not in a separate seed script, so a fresh
// database is usable the moment it is migrated. This script exists to CHECK
// that, which is what you actually want in CI or after a manual `d1 create`:
// it fails loudly if the categories are missing rather than letting the app
// boot with an empty category list.
//
//   node scripts/seed.mjs            # local D1
//   node scripts/seed.mjs --remote   # the real database
import { execFileSync } from "node:child_process";

const remote = process.argv.includes("--remote");
const target = remote ? "--remote" : "--local";
const db = process.env.D1_DATABASE_NAME || "dayline";

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

console.log(`→ Applying migrations to ${db} (${remote ? "remote" : "local"})…`);
try {
  console.log(wrangler(["d1", "migrations", "apply", db, target]));
} catch (e) {
  console.error("Migration failed:\n" + (e.stdout || "") + (e.stderr || ""));
  process.exit(1);
}

console.log("→ Checking seeded categories…");
let rows;
try {
  const out = wrangler(["d1", "execute", db, target, "--json", "--command", "select count(*) as n from categories"]);
  // wrangler prints a JSON array of result sets; take the first row's count.
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  rows = parsed[0]?.results?.[0]?.n ?? 0;
} catch (e) {
  console.error("Could not read categories:\n" + (e.stdout || "") + (e.stderr || ""));
  process.exit(1);
}

if (rows < 14) {
  console.error(`✗ Expected 14 seeded categories, found ${rows}.`);
  process.exit(1);
}
console.log(`✓ ${rows} categories present. Database is ready.`);
