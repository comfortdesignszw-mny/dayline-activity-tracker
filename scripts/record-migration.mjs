// One-off repair: the dev DB already has the 0000 tables (applied by hand while
// drizzle-kit was failing), but drizzle's journal is empty, so `migrate` retries
// 0000 and collides. Record 0000 as applied so the remaining migrations run.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const file = "drizzle/migrations/0000_light_peter_parker.sql";
const sql = readFileSync(file, "utf8");
const hash = createHash("sha256").update(sql).digest("hex");

const existing = await client.query("select count(*)::int n from drizzle.__drizzle_migrations");
if (existing.rows[0].n === 0) {
  await client.query(
    "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
    [hash, Date.now()],
  );
  console.log("recorded 0000 as applied");
} else {
  console.log("journal already has", existing.rows[0].n, "entries");
}

await client.end();
