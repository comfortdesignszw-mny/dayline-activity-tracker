import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";

// ─────────────────────────────────────────────────────────────────────────────
// D1 database handle.
//
// Drizzle's `d1` driver wraps the binding directly: every query becomes a
// prepared statement against the Worker's D1 session. There is no pool and no
// connection string — the binding IS the connection, and it is scoped to the
// request that received it.
//
// WHY A FACTORY AND NOT A MODULE-LEVEL `db`: a Worker module is instantiated
// once per isolate and reused across requests, but the D1 binding is handed in
// per request. A module-level handle would capture the first request's binding
// and keep using it — which works in dev and then fails in production the
// moment the isolate is reused. `getDb(env)` is called from the tRPC context,
// so each request gets its own handle.
//
// TRANSACTIONS: D1 supports `db.batch([...])` (one round trip, atomic) but NOT
// interactive `db.transaction(async (tx) => …)`. `atomic()` below is the
// sanctioned way to run several writes as one unit; it is the same shape the
// Postgres version exposed, so call sites did not change.
// ─────────────────────────────────────────────────────────────────────────────

export type AppDB = DrizzleD1Database<typeof schema>;

export function getDb(d1: D1Database): AppDB {
  return drizzle(d1, { schema });
}

/**
 * Run several statements as ONE atomic batch.
 *
 *     const [created, logged] = await atomic(db, [
 *       db.insert(activities).values(row),
 *       db.insert(audit).values({ activityId: row.id }),
 *     ]);
 *
 * D1 executes a batch in a single implicit transaction: if any statement
 * fails, none of them are applied. What you CANNOT do is read a result and then
 * decide what to write next — all statements leave together. Read and compute
 * first, then make every statement carry a SQL guard that re-checks what you
 * read, and treat a zero-row result as "somebody got there first".
 */
export async function atomic<T extends readonly unknown[]>(
  db: AppDB,
  statements: T,
): Promise<T> {
  // Drizzle's batch() is typed against a tuple of batch items; the cast keeps
  // the call site readable without weakening the return type.
  await db.batch(statements as never);
  return statements;
}

export { schema };
export type DB = AppDB;
