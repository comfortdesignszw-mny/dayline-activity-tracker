// ── AGENT-OWNED: business data-access ────────────────────────────────────────
// Every query is owner-scoped: the WHERE clause always carries ownerId, so one
// user can never read or touch another's rows.
//
// D1 notes:
//   • `db` is passed in (one handle per request) rather than imported — see
//     _core/db.ts for why a module-level handle breaks on Workers.
//   • Timestamps are ISO-8601 TEXT, so `new Date()` becomes `.toISOString()`.
//   • `onConflictDoUpdate` works the same; SQLite's `excluded.<col>` is what
//     Drizzle emits for the `set` clause.
//   • There is no `count(*)::int` cast — SQLite returns an integer already.
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { AppDB } from "./_core/db";
import { activities, categories, goals } from "../drizzle/schema";
import { buildSampleActivities, buildSampleGoals } from "../shared/sample-data";
import { localToday } from "../shared/analytics";
import { tagsToText } from "../shared/activities";
import type { SyncActivity, SyncGoal } from "../shared/sync";

export interface ActivityInput {
  category: string;
  title: string;
  durationMinutes: number;
  activityDate: string;
  startTime?: string | null;
  notes?: string | null;
  intensity?: string | null;
  location?: string | null;
  tags?: string | null;
}

export interface GoalInput {
  category: string;
  period: string;
  targetMinutes: number;
}

export async function listCategories(db: AppDB) {
  return db.select().from(categories).orderBy(asc(categories.sortOrder));
}

export async function listActivities(
  db: AppDB,
  ownerId: string,
  opts: { from?: string; to?: string; category?: string; limit?: number } = {},
) {
  const where = [eq(activities.ownerId, ownerId)];
  if (opts.from) where.push(gte(activities.activityDate, opts.from));
  if (opts.to) where.push(lte(activities.activityDate, opts.to));
  if (opts.category) where.push(eq(activities.category, opts.category));

  const q = db
    .select()
    .from(activities)
    .where(and(...where))
    .orderBy(desc(activities.activityDate), desc(activities.createdAt));

  return opts.limit ? q.limit(opts.limit) : q;
}

export async function getActivity(db: AppDB, id: string, ownerId: string) {
  const [row] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, id), eq(activities.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

function clean(input: ActivityInput) {
  return {
    category: input.category,
    title: input.title,
    durationMinutes: input.durationMinutes,
    activityDate: input.activityDate,
    startTime: input.startTime?.trim() ? input.startTime.trim() : null,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    intensity: input.intensity?.trim() ? input.intensity.trim() : null,
    location: input.location?.trim() ? input.location.trim() : null,
    tags: tagsToText(input.tags),
  };
}

export async function createActivity(db: AppDB, ownerId: string, input: ActivityInput) {
  const [row] = await db
    .insert(activities)
    .values({ id: crypto.randomUUID(), ownerId, ...clean(input) })
    .returning();
  return row;
}

export async function updateActivity(
  db: AppDB,
  id: string,
  ownerId: string,
  input: ActivityInput,
) {
  const [row] = await db
    .update(activities)
    .set({ ...clean(input), updatedAt: new Date().toISOString() })
    .where(and(eq(activities.id, id), eq(activities.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deleteActivity(db: AppDB, id: string, ownerId: string) {
  const rows = await db
    .delete(activities)
    .where(and(eq(activities.id, id), eq(activities.ownerId, ownerId)))
    .returning({ id: activities.id });
  return { ok: rows.length > 0 };
}

export async function countActivities(db: AppDB, ownerId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(activities)
    .where(eq(activities.ownerId, ownerId));
  return row?.n ?? 0;
}

// ── Goals ────────────────────────────────────────────────────────────────────

export async function listGoals(db: AppDB, ownerId: string) {
  return db
    .select()
    .from(goals)
    .where(eq(goals.ownerId, ownerId))
    .orderBy(asc(goals.category));
}

/**
 * Upsert one goal per (owner, category). A single statement, so two concurrent
 * saves cannot produce duplicate rows — the unique index is the arbiter.
 */
export async function upsertGoal(db: AppDB, ownerId: string, input: GoalInput) {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(goals)
    .values({
      id: crypto.randomUUID(),
      ownerId,
      category: input.category,
      period: input.period,
      targetMinutes: input.targetMinutes,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [goals.ownerId, goals.category],
      set: {
        period: input.period,
        targetMinutes: input.targetMinutes,
        updatedAt: now,
        // Re-creating a goal that was soft-deleted must clear the tombstone,
        // otherwise the row stays invisible to every client forever.
        deletedAt: null,
      },
    })
    .returning();
  return row;
}

export async function deleteGoal(db: AppDB, ownerId: string, category: string) {
  const rows = await db
    .delete(goals)
    .where(and(eq(goals.ownerId, ownerId), eq(goals.category, category)))
    .returning({ id: goals.id });
  return { ok: rows.length > 0 };
}

// ── Offline-first sync ───────────────────────────────────────────────────────
// Reads and writes the full store across devices. Last-write-wins on
// `updated_at`, with soft deletes so a tombstone made offline still beats a
// stale live copy from another device. The merge rules live in shared/sync.ts.

export function serializeActivity(a: typeof activities.$inferSelect): SyncActivity {
  return {
    id: a.id,
    category: a.category as SyncActivity["category"],
    title: a.title,
    durationMinutes: a.durationMinutes,
    activityDate: a.activityDate,
    startTime: a.startTime,
    notes: a.notes,
    intensity: a.intensity,
    location: a.location,
    tags: a.tags,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    deletedAt: a.deletedAt,
  };
}

export function serializeGoal(g: typeof goals.$inferSelect): SyncGoal {
  return {
    id: g.id,
    category: g.category as SyncGoal["category"],
    period: g.period as SyncGoal["period"],
    targetMinutes: g.targetMinutes,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    deletedAt: g.deletedAt,
  };
}

/** Everything the user owns, as ISO-string rows for the offline store. */
export async function syncPull(db: AppDB, ownerId: string) {
  // Seed on first pull so a fresh account opens populated, then read everything.
  await seedSampleDataIfEmpty(db, ownerId);
  const [activityRows, goalRows] = await Promise.all([
    db.select().from(activities).where(eq(activities.ownerId, ownerId)),
    db.select().from(goals).where(eq(goals.ownerId, ownerId)),
  ]);
  return {
    activities: activityRows.map(serializeActivity),
    goals: goalRows.map(serializeGoal),
  };
}

/**
 * Upsert incoming activities, applying LWW on updated_at. Echoes the result.
 *
 * The `setWhere` guard is what makes this last-write-wins rather than
 * last-arrival-wins: a row whose stored `updated_at` is NEWER than the incoming
 * one is left untouched, so a slow device pushing a stale edit cannot roll back
 * a newer one. D1 has no interactive transactions, so the guard has to live in
 * the statement itself.
 */
export async function syncPushActivities(db: AppDB, ownerId: string, rows: SyncActivity[]) {
  if (rows.length === 0) return [] as SyncActivity[];

  await db.batch(
    rows.map((r) =>
      db
        .insert(activities)
        .values({
          id: r.id,
          ownerId,
          category: r.category,
          title: r.title,
          durationMinutes: r.durationMinutes,
          activityDate: r.activityDate,
          startTime: r.startTime,
          notes: r.notes,
          intensity: r.intensity,
          location: r.location,
          tags: r.tags,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          deletedAt: r.deletedAt,
        })
        .onConflictDoUpdate({
          target: [activities.id],
          set: {
            category: r.category,
            title: r.title,
            durationMinutes: r.durationMinutes,
            activityDate: r.activityDate,
            startTime: r.startTime,
            notes: r.notes,
            intensity: r.intensity,
            location: r.location,
            tags: r.tags,
            updatedAt: r.updatedAt,
            deletedAt: r.deletedAt,
          },
          setWhere: sql`${activities.updatedAt} < ${r.updatedAt}`,
        }),
    ) as never,
  );

  const ids = rows.map((r) => r.id);
  const out = await db
    .select()
    .from(activities)
    .where(and(eq(activities.ownerId, ownerId), inArray(activities.id, ids)));
  return out.map(serializeActivity);
}

/** Upsert incoming goals keyed by (owner, category), LWW on updated_at. */
export async function syncPushGoals(db: AppDB, ownerId: string, rows: SyncGoal[]) {
  if (rows.length === 0) return [] as SyncGoal[];

  await db.batch(
    rows.map((r) =>
      db
        .insert(goals)
        .values({
          id: r.id,
          ownerId,
          category: r.category,
          period: r.period,
          targetMinutes: r.targetMinutes,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          deletedAt: r.deletedAt,
        })
        .onConflictDoUpdate({
          target: [goals.ownerId, goals.category],
          set: {
            period: r.period,
            targetMinutes: r.targetMinutes,
            updatedAt: r.updatedAt,
            deletedAt: r.deletedAt,
          },
          setWhere: sql`${goals.updatedAt} < ${r.updatedAt}`,
        }),
    ) as never,
  );

  const out = await db.select().from(goals).where(eq(goals.ownerId, ownerId));
  return out.map(serializeGoal);
}

// ── Seeding ──────────────────────────────────────────────────────────────────

/**
 * Fills a brand-new account with ~5 weeks of sample entries and a starter set
 * of goals so the dashboard is populated on first visit. Idempotent: does
 * nothing once the account has rows, so it is safe to call on every load.
 */
export async function seedSampleDataIfEmpty(db: AppDB, ownerId: string) {
  const existing = await countActivities(db, ownerId);
  if (existing > 0) return { seeded: false, inserted: 0 };

  const rows = buildSampleActivities(localToday());
  if (rows.length === 0) return { seeded: false, inserted: 0 };

  const now = new Date().toISOString();
  await db.insert(activities).values(
    rows.map((r) => ({
      id: crypto.randomUUID(),
      ownerId,
      ...r,
      createdAt: now,
      updatedAt: now,
    })),
  );

  // Starter goals, only when the account has none of its own.
  const existingGoals = await listGoals(db, ownerId);
  if (existingGoals.length === 0) {
    await db
      .insert(goals)
      .values(
        buildSampleGoals().map((g) => ({
          id: crypto.randomUUID(),
          ownerId,
          ...g,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  return { seeded: true, inserted: rows.length };
}
