// One-off: apply the generated migration SQL directly, then record it in
// drizzle's journal table so `drizzle-kit migrate` stays consistent.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const files = ["0000_light_peter_parker.sql", "0001_activity_categories.sql"];

for (const f of files) {
  const sql = readFileSync(`drizzle/migrations/${f}`, "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    try {
      await client.query(stmt);
      console.log("OK  ", f, stmt.slice(0, 55).replace(/\s+/g, " "));
    } catch (e) {
      console.log("FAIL", f, e.message, "|", stmt.slice(0, 60).replace(/\s+/g, " "));
    }
  }
}

const tables = await client.query(
  "select table_name from information_schema.tables where table_schema='public' order by 1",
);
console.log("TABLES:", tables.rows.map((r) => r.table_name).join(", "));

const cat = await client.query("select count(*)::int n from categories");
console.log("CATEGORIES:", cat.rows[0].n);

await client.end();
