-- ─────────────────────────────────────────────────────────────────────────────
-- Dayline — initial D1 (SQLite) schema.
--
-- This is the single consolidated migration that replaces the nine Postgres
-- migrations the app shipped with. `wrangler d1 migrations apply` runs it once
-- per database and records it in `d1_migrations`.
--
-- Conventions:
--   • ids are TEXT (client-generated UUIDs, or crypto.randomUUID on the server)
--   • timestamps are ISO-8601 TEXT in UTC ("2026-11-02T09:15:00.000Z"), which
--     sorts lexicographically in the same order as the instants it encodes
--   • dates are TEXT "YYYY-MM-DD"
--   • booleans would be INTEGER 0/1 — this schema has none
-- ─────────────────────────────────────────────────────────────────────────────

PRAGMA foreign_keys = ON;

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL
);

-- ── sessions ─────────────────────────────────────────────────────────────────
-- The JWT carries the session id in `jti`; this row is what makes a session
-- revocable. Without it a stolen cookie stays valid until it expires.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- ── categories (reference data, seeded below) ────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  slug       TEXT PRIMARY KEY NOT NULL,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL,
  icon       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ── activities ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id               TEXT PRIMARY KEY NOT NULL,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category         TEXT NOT NULL,
  title            TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  activity_date    TEXT NOT NULL,
  start_time       TEXT,
  notes            TEXT,
  intensity        TEXT,
  location         TEXT,
  tags             TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);

CREATE INDEX IF NOT EXISTS activities_owner_idx         ON activities (owner_id);
CREATE INDEX IF NOT EXISTS activities_owner_date_idx    ON activities (owner_id, activity_date);
CREATE INDEX IF NOT EXISTS activities_owner_updated_idx ON activities (owner_id, updated_at);

-- ── goals ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id             TEXT PRIMARY KEY NOT NULL,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category       TEXT NOT NULL,
  period         TEXT NOT NULL DEFAULT 'daily',
  target_minutes INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

-- One goal per (owner, category). This is what makes the sync upsert safe:
-- two devices that both create a goal for "exercise" converge on one row.
CREATE UNIQUE INDEX IF NOT EXISTS goals_owner_category_idx ON goals (owner_id, category);
CREATE INDEX IF NOT EXISTS goals_owner_idx ON goals (owner_id);

-- ── seeded categories ────────────────────────────────────────────────────────
-- The fourteen categories, with the muted warm palette the UI uses. Seeded here
-- rather than in a script so a brand-new database is usable immediately.
INSERT INTO categories (slug, label, color, icon, sort_order) VALUES
  ('exercise', 'Exercise',   '#C2410C', 'Dumbbell',      1),
  ('work',     'Work',       '#4A5D7E', 'Briefcase',     2),
  ('reading',  'Reading',    '#7C6A9C', 'BookOpen',      3),
  ('sleep',    'Sleep',      '#5B7C6F', 'Moon',          4),
  ('learning', 'Learning',   '#B08968', 'GraduationCap', 5),
  ('social',   'Social',     '#A65D57', 'Users',         6),
  ('chores',   'Chores',     '#8A8A7E', 'House',         7),
  ('health',   'Health',     '#8C6A5D', 'HeartPulse',    8),
  ('cooking',  'Cooking',    '#A97C50', 'ChefHat',       9),
  ('commute',  'Commute',    '#6E7F8D', 'TrainFront',   10),
  ('creative', 'Creative',   '#9A6A8E', 'Palette',      11),
  ('screen',   'Screen time','#7A7A8C', 'Monitor',      12),
  ('outdoors', 'Outdoors',   '#6F8A5E', 'Trees',        13),
  ('other',    'Other',      '#9C9188', 'Circle',       14)
ON CONFLICT (slug) DO UPDATE SET
  label      = excluded.label,
  color      = excluded.color,
  icon       = excluded.icon,
  sort_order = excluded.sort_order;
