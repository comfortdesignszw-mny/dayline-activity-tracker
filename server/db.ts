// ── AGENT-OWNED: business data-access ─────────────────────────────────────────
// Every query is owner-scoped: the WHERE clause always carries ownerId, so one
// user can never read or touch another's rows.
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "./_core/db";
import { activities, categories, goals, reminders } from "../drizzle/schema";
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

export async function listCategories() {
  return db.select().from(categories).orderBy(asc(categories.sortOrder));
}

export async function listActivities(
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

export async function getActivity(id: string, ownerId: string) {
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

export async function createActivity(ownerId: string, input: ActivityInput) {
  const [row] = await db
    .insert(activities)
    .values({ ownerId, ...clean(input) })
    .returning();
  return row;
}

export async function updateActivity(id: string, ownerId: string, input: ActivityInput) {
  const [row] = await db
    .update(activities)
    .set({ ...clean(input), updatedAt: new Date() })
    .where(and(eq(activities.id, id), eq(activities.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deleteActivity(id: string, ownerId: string) {
  const rows = await db
    .delete(activities)
    .where(and(eq(activities.id, id), eq(activities.ownerId, ownerId)))
    .returning({ id: activities.id });
  return { ok: rows.length > 0 };
}

export async function countActivities(ownerId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activities)
    .where(eq(activities.ownerId, ownerId));
  return row?.n ?? 0;
}

// ── Goals ────────────────────────────────────────────────────────────────────

export async function listGoals(ownerId: string) {
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
export async function upsertGoal(ownerId: string, input: GoalInput) {
  const [row] = await db
    .insert(goals)
    .values({
      ownerId,
      category: input.category,
      period: input.period,
      targetMinutes: input.targetMinutes,
    })
    .onConflictDoUpdate({
      target: [goals.ownerId, goals.category],
      set: {
        period: input.period,
        targetMinutes: input.targetMinutes,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function deleteGoal(ownerId: string, category: string) {
  const rows = await db
    .delete(goals)
    .where(and(eq(goals.ownerId, ownerId), eq(goals.category, category)))
    .returning({ id: goals.id });
  return { ok: rows.length > 0 };
}

// ── Offline-first sync ──────────────────────────────────────────────────
// Reads and writes the full store across devices. Last-write-wins on
// `updated_at`, with soft deletes so a tombstone made offline still beats a
// stale live copy from another device. The merge rules live in shared/sync.ts.

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

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
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    deletedAt: iso(a.deletedAt),
  };
}

export function serializeGoal(g: typeof goals.$inferSelect): SyncGoal {
  return {
    id: g.id,
    category: g.category as SyncGoal["category"],
    period: g.period as SyncGoal["period"],
    targetMinutes: g.targetMinutes,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
    deletedAt: iso(g.deletedAt),
  };
}

/** Everything the user owns, as ISO-string rows for the offline store. */
export async function syncPull(ownerId: string) {
  // Seed on first pull so a fresh account opens populated, then read everything.
  await seedSampleDataIfEmpty(ownerId);
  const [activityRows, goalRows] = await Promise.all([
    db.select().from(activities).where(eq(activities.ownerId, ownerId)),
    db.select().from(goals).where(eq(goals.ownerId, ownerId)),
  ]);
  return {
    activities: activityRows.map(serializeActivity),
    goals: goalRows.map(serializeGoal),
  };
}

/** Upsert incoming activities, applying LWW on updated_at. Echoes the result. */
export async function syncPushActivities(ownerId: string, rows: SyncActivity[]) {
  if (rows.length === 0) return [] as SyncActivity[];
  await Promise.all(
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
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
          deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
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
            updatedAt: new Date(r.updatedAt),
            deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
          },
          setWhere: sql`${activities.updatedAt} < ${new Date(r.updatedAt)}`,
        }),
    ),
  );
  const ids = rows.map((r) => r.id);
  const out = await db
    .select()
    .from(activities)
    .where(and(eq(activities.ownerId, ownerId), inArray(activities.id, ids)));
  return out.map(serializeActivity);
}

/** Upsert incoming goals keyed by (owner, category), LWW on updated_at. */
export async function syncPushGoals(ownerId: string, rows: SyncGoal[]) {
  if (rows.length === 0) return [] as SyncGoal[];
  await Promise.all(
    rows.map((r) =>
      db
        .insert(goals)
        .values({
          ownerId,
          category: r.category,
          period: r.period,
          targetMinutes: r.targetMinutes,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
          deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
        })
        .onConflictDoUpdate({
          target: [goals.ownerId, goals.category],
          set: {
            period: r.period,
            targetMinutes: r.targetMinutes,
            updatedAt: new Date(r.updatedAt),
            deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
          },
          setWhere: sql`${goals.updatedAt} < ${new Date(r.updatedAt)}`,
        }),
    ),
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
export async function seedSampleDataIfEmpty(ownerId: string) {
  const existing = await countActivities(ownerId);
  if (existing > 0) return { seeded: false, inserted: 0 };

  const rows = buildSampleActivities(localToday());
  if (rows.length === 0) return { seeded: false, inserted: 0 };

  await db.insert(activities).values(rows.map((r) => ({ ownerId, ...r })));

  // Starter goals, only when the account has none of its own.
  const existingGoals = await listGoals(ownerId);
  if (existingGoals.length === 0) {
    await db
      .insert(goals)
      .values(buildSampleGoals().map((g) => ({ ownerId, ...g })))
      .onConflictDoNothing();
  }

  // A couple of starter reminders, so the Reminders page is not an empty shell
  // on first visit. Only when the account has none.
  const existingReminders = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(eq(reminders.ownerId, ownerId))
    .limit(1);
  if (existingReminders.length === 0) {
    await db.insert(reminders).values([
      {
        ownerId,
        category: "exercise",
        title: "Move your body",
        message: "A walk counts. Log it when you're back.",
        timeOfDay: "07:30",
        daysOfWeek: "1,2,3,4,5",
      },
      {
        ownerId,
        category: "reading",
        title: "Evening reading",
        message: "Twenty pages before the day ends.",
        timeOfDay: "20:30",
        daysOfWeek: "0,1,2,3,4,5,6",
      },
      {
        ownerId,
        category: null,
        title: "Log your day",
        message: "Two minutes now saves the whole day's detail.",
        timeOfDay: "21:45",
        daysOfWeek: "0,1,2,3,4,5,6",
      },
    ]);
  }

  return { seeded: true, inserted: rows.length };
}
