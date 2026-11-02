// React hook over the offline store. Every read the UI makes goes through the
// IndexedDB store; every write persists locally, updates React state
// optimistically, queues an outbox entry, and nudges the sync engine — so the
// UI is fully usable with zero network.
//
// The store is keyed per signed-in user so two accounts on one device never
// bleed into each other.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/useAuth";
import { syncNow } from "@/lib/syncEngine";
import type { CategorySlug, GoalPeriod } from "@shared/activities";
import {
  idbListActivities,
  idbListGoals,
  idbListOutbox,
  idbPutActivity,
  idbPutGoal,
} from "@/lib/idb";
import { enqueue, newId, nowIso } from "@/lib/syncEngine";
import { isLive, type SyncActivity, type SyncGoal } from "@shared/sync";
import { useSync } from "./useSync";

export interface ActivityDraft {
  category: CategorySlug;
  title: string;
  durationMinutes: number;
  activityDate: string;
  startTime?: string | null;
  notes?: string | null;
  intensity?: string | null;
  location?: string | null;
  tags?: string | null;
}

export interface GoalDraft {
  category: CategorySlug;
  period: GoalPeriod;
  targetMinutes: number;
}

function byRecency(a: SyncActivity, b: SyncActivity): number {
  if (a.activityDate !== b.activityDate) return a.activityDate < b.activityDate ? 1 : -1;
  return a.updatedAt < b.updatedAt ? 1 : -1;
}

export function useOfflineStore() {
  const { user } = useAuth();
  const { version, isSyncing } = useSync();

  const [activities, setActivities] = useState<SyncActivity[]>([]);
  const [goals, setGoals] = useState<SyncGoal[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);

  const uid = user?.id ?? null;

  // Pull+seed as soon as a user signs in (not on the 60s interval), so a fresh
  // account opens populated rather than showing an empty log.
  const lastUid = useRef<string | null>(null);
  useEffect(() => {
    if (!uid) {
      lastUid.current = null;
      return;
    }
    if (uid === lastUid.current) return;
    lastUid.current = uid;
    void syncNow();
  }, [uid]);

  // Load the store when the user changes, and re-read after every completed
  // sync (the engine bumps `version`). Local writes already update state, so a
  // re-read here only catches what a sync brought in from other devices.
  //
  // `loading` is raised ONLY on the first read for a given user. A re-read
  // after a sync must not flip it back to true: the dashboard renders a
  // skeleton while loading, which unmounts the whole page tree — and that
  // resets every child's local state (an open goal editor, a half-typed form)
  // on every 60s sync. The data is already on screen; a background refresh
  // should swap it in place, not tear the page down.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    if (loadedFor.current !== uid) setLoading(true);
    Promise.all([idbListActivities(), idbListGoals(), idbListOutbox()])
      .then(([a, g, o]) => {
        if (cancelled) return;
        setActivities(a.filter(isLive).sort(byRecency));
        setGoals(g.filter(isLive));
        setPending(o.length);
        loadedFor.current = uid;
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, version]);

  const getActivity = useCallback(
    (id: string) => activities.find((r) => r.id === id) ?? null,
    [activities],
  );

  const saveActivity = useCallback(
    async (draft: ActivityDraft, id?: string) => {
      const ts = nowIso();
      const existing = id ? getActivity(id) : null;
      const row: SyncActivity = {
        id: id ?? newId(),
        category: draft.category,
        title: draft.title,
        durationMinutes: draft.durationMinutes,
        activityDate: draft.activityDate,
        startTime: draft.startTime ?? null,
        notes: draft.notes ?? null,
        intensity: draft.intensity ?? null,
        location: draft.location ?? null,
        tags: draft.tags ?? null,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        deletedAt: null,
      };
      await idbPutActivity(row);
      // Optimistic update: replace-or-prepend, then resort.
      setActivities((prev) => {
        const rest = prev.filter((r) => r.id !== row.id);
        return [row, ...rest].sort(byRecency);
      });
      await enqueue({
        id: newId(),
        entity: "activity",
        op: "upsert",
        data: row,
        queuedAt: Date.now(),
      });
      return row;
    },
    [getActivity],
  );

  const removeActivity = useCallback(async (id: string) => {
    const all = await idbListActivities();
    const existing = all.find((r) => r.id === id);
    if (!existing) return;
    const row: SyncActivity = { ...existing, updatedAt: nowIso(), deletedAt: nowIso() };
    // Keep the tombstone in IDB (not deleted) so a pull from another device
    // cannot resurrect the row before this delete has been pushed.
    await idbPutActivity(row);
    setActivities((prev) => prev.filter((r) => r.id !== id));
    await enqueue({
      id: newId(),
      entity: "activity",
      op: "delete",
      data: row,
      queuedAt: Date.now(),
    });
  }, []);

  const saveGoal = useCallback(async (draft: GoalDraft, id?: string) => {
    const ts = nowIso();
    const existing = id ? goals.find((r) => r.id === id) : null;
    const row: SyncGoal = {
      id: id ?? newId(),
      category: draft.category,
      period: draft.period,
      targetMinutes: draft.targetMinutes,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
      deletedAt: null,
    };
    await idbPutGoal(row);
    // Goals are one per category; replace any same-category row.
    setGoals((prev) => {
      const rest = prev.filter((r) => r.category !== row.category);
      return [...rest, row].sort((a, b) => a.category.localeCompare(b.category));
    });
    await enqueue({
      id: newId(),
      entity: "goal",
      op: "upsert",
      data: row,
      queuedAt: Date.now(),
    });
    return row;
  }, [goals]);

  const removeGoal = useCallback(async (id: string) => {
    const all = await idbListGoals();
    const existing = all.find((r) => r.id === id);
    if (!existing) return;
    const row: SyncGoal = { ...existing, updatedAt: nowIso(), deletedAt: nowIso() };
    // Tombstone stays in IDB for the same reason as activities.
    await idbPutGoal(row);
    setGoals((prev) => prev.filter((r) => r.id !== id));
    await enqueue({
      id: newId(),
      entity: "goal",
      op: "delete",
      data: row,
      queuedAt: Date.now(),
    });
  }, []);

  const liveGoals = useMemo(() => goals.filter(isLive), [goals]);

  return {
    activities,
    goals: liveGoals,
    pending,
    loading,
    isSyncing,
    getActivity,
    saveActivity,
    removeActivity,
    saveGoal,
    removeGoal,
  };
}
