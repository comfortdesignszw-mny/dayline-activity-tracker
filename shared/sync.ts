// Offline-first sync contract, shared by client and server. Pure helpers here
// (no DB, no React) so the merge rules are testable in isolation.

import type { CategorySlug, GoalPeriod } from "./activities";

export type SyncEntity = "activity" | "goal";

/** A queued local mutation, waiting to be pushed to the server. */
export interface OutboxEntry {
  /** Client-generated id (crypto.randomUUID) — stable across devices. */
  id: string;
  entity: SyncEntity;
  /** "upsert" covers create + update; "delete" is a soft-delete tombstone. */
  op: "upsert" | "delete";
  /** The full row (for deletes, the same row with `deletedAt` set). */
  data: SyncActivity | SyncGoal;
  /** Epoch ms when the mutation was made locally. */
  queuedAt: number;
}

/** A server-side activity row, as synced. */
export interface SyncActivity {
  id: string;
  category: CategorySlug;
  title: string;
  durationMinutes: number;
  activityDate: string;
  startTime: string | null;
  notes: string | null;
  intensity: string | null;
  location: string | null;
  tags: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** A server-side goal row, as synced. */
export interface SyncGoal {
  id: string;
  category: CategorySlug;
  period: GoalPeriod;
  targetMinutes: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SyncPullResult {
  activities: SyncActivity[];
  goals: SyncGoal[];
  /** Server time, so the client can detect clock skew. */
  serverTime: string;
}

export interface SyncPushInput {
  activities: SyncActivity[];
  goals: SyncGoal[];
}

export interface SyncPushResult {
  /** Rows the server accepted (post-merge), echoed back for reconciliation. */
  activities: SyncActivity[];
  goals: SyncGoal[];
}

/** Compare two ISO timestamps; ties broken by id for a total order. */
export function isNewer(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  if (ta !== tb) return ta > tb;
  return a > b;
}

/**
 * Last-write-wins merge of two versions of the same row. The winner is the one
 * with the newer `updatedAt`; a `deletedAt` tombstone always beats a live row
 * of equal-or-older `updatedAt`, so a deletion made offline cannot be undone by
 * a stale live copy from another device.
 */
export function mergeRow<T extends { updatedAt: string; deletedAt: string | null }>(
  local: T,
  remote: T,
): T {
  if (remote.deletedAt && !local.deletedAt) {
    // Remote is a tombstone; it wins unless local is strictly newer.
    return isNewer(local.updatedAt, remote.updatedAt) ? local : remote;
  }
  if (local.deletedAt && !remote.deletedAt) {
    return isNewer(remote.updatedAt, local.updatedAt) ? remote : local;
  }
  return isNewer(local.updatedAt, remote.updatedAt) ? local : remote;
}

/** Merge two maps keyed by id, applying LWW per row. */
export function mergeById<T extends { id: string; updatedAt: string; deletedAt: string | null }>(
  local: T[],
  remote: T[],
): T[] {
  const map = new Map<string, T>();
  for (const r of local) map.set(r.id, r);
  for (const r of remote) {
    const existing = map.get(r.id);
    map.set(r.id, existing ? mergeRow(existing, r) : r);
  }
  return [...map.values()];
}

/**
 * Goals are keyed by (owner, category), not by id — the server enforces a
 * unique index on the pair. Two devices that both create a goal for "exercise"
 * produce different client ids for the same logical row, so they are merged by
 * category here; the survivor's id is whatever wins.
 */
export function mergeGoalsByCategory(local: SyncGoal[], remote: SyncGoal[]): SyncGoal[] {
  const map = new Map<string, SyncGoal>();
  for (const g of local) map.set(g.category, g);
  for (const g of remote) {
    const existing = map.get(g.category);
    map.set(g.category, existing ? mergeRow(existing, g) : g);
  }
  return [...map.values()];
}

/** True when a row is a live (non-deleted) record. */
export function isLive<T extends { deletedAt: string | null }>(row: T): boolean {
  return row.deletedAt == null;
}
