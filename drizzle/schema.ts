import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  bigint,
  integer,
  date,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM TABLE — managed by the scaffold. The Agent MUST NOT redefine or drop
// the auth columns here; it only ADDS business tables below (DESIGN §5.1).
// ─────────────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"), // null for SSO-linked users (future)
  name: text("name"),
  role: text("role").notNull().default("user"), // 'user' | 'admin'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// SYSTEM TABLE — managed by the scaffold, written by server/_core/storage.ts.
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    contentType: text("content_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_owner_idx").on(t.ownerId), index("files_created_idx").on(t.createdAt)],
);

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS TABLES
// ─────────────────────────────────────────────────────────────────────────────

// Reference data: the fourteen activity categories. Seeded through a migration
// so a freshly published app has them too (see apply_migrations data_sql).
export const categories = pgTable("categories", {
  slug: text("slug").primaryKey(),
  label: text("label").notNull(),
  color: text("color").notNull(),
  icon: text("icon").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// One row = one logged activity.
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    activityDate: date("activity_date", { mode: "string" }).notNull(),
    // "HH:MM" local wall-clock start, optional — drives the time-of-day heatmap.
    startTime: text("start_time"),
    notes: text("notes"),
    // light | moderate | hard — optional, meaningful for exercise/chores.
    intensity: text("intensity"),
    // home | office | gym | outdoors | other — optional.
    location: text("location"),
    // Free-form tags, stored as a comma-separated list ("morning,with-sam").
    tags: text("tags"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete tombstone for offline-first sync: a deletion travels as this
    // timestamp instead of a hard DELETE, so a device that was offline cannot
    // resurrect a row another device removed (last-write-wins on updated_at).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("activities_owner_idx").on(t.ownerId),
    index("activities_owner_date_idx").on(t.ownerId, t.activityDate),
  ],
);

// Per-category targets. One row per (owner, category): either a daily or a
// weekly target in minutes — never both, which the check constraint enforces.
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    // 'daily' | 'weekly'
    period: text("period").notNull().default("daily"),
    targetMinutes: integer("target_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-delete tombstone for offline-first sync (mirrors activities.deletedAt).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("goals_owner_category_idx").on(t.ownerId, t.category),
    index("goals_owner_idx").on(t.ownerId),
  ],
);

// ── Reminders ────────────────────────────────────────────────────────────────
// A reminder is a wall-clock nudge: "at 07:00 on Mon/Wed/Fri, go and exercise".
// `category` null means it is a general nudge; `title` is the per-activity label
// shown in the notification. `daysOfWeek` is a comma-separated list of 0–6
// (0 = Sunday), matching JS `getDay()` so the client needs no translation.
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category"),
    title: text("title").notNull(),
    message: text("message"),
    // "HH:MM" local wall-clock time.
    timeOfDay: text("time_of_day").notNull(),
    daysOfWeek: text("days_of_week").notNull().default("0,1,2,3,4,5,6"),
    enabled: boolean("enabled").notNull().default(true),
    // Set when the client actually shows it, so a reload does not re-fire the
    // same reminder twice in one day.
    lastFiredOn: date("last_fired_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reminders_owner_idx").on(t.ownerId)],
);

// ── Live stopwatch ───────────────────────────────────────────────────────────
// At most ONE running timer per user, enforced by the unique index on ownerId.
// The start instant lives in the database, not in localStorage, so the timer
// survives a reload, a navigation, and a different device.
export const timers = pgTable(
  "timers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    title: text("title").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("timers_owner_unique_idx").on(t.ownerId)],
);

// ── Teams ────────────────────────────────────────────────────────────────────
// A team is a shared space: members see each other's weekly summaries. The
// invite code is the join link's capability — anyone holding it can join, which
// is the point of an invite link, so it is long and random.
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inviteCode: text("invite_code").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("teams_owner_idx").on(t.ownerId)],
);

// role: 'owner' | 'member' | 'viewer'. A viewer sees the team dashboard but
// their own log is not shared into it.
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_members_unique_idx").on(t.teamId, t.userId),
    index("team_members_user_idx").on(t.userId),
  ],
);

// ── Read-only share links ────────────────────────────────────────────────────
// scope: 'dashboard' (summary + charts) | 'log' (every entry). The token is the
// capability; revoking sets revokedAt rather than deleting, so the owner keeps
// a record of what was shared.
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    scope: text("scope").notNull().default("dashboard"),
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("share_links_owner_idx").on(t.ownerId)],
);

// Scaffold example table — retained so the migration history stays linear
// (removing it makes drizzle-kit prompt for a rename). Unused by the app.
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    coverUrl: text("cover_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("items_owner_idx").on(t.ownerId)],
);

export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
export type Timer = typeof timers.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
