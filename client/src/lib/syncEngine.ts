// The sync engine: reconciles the local IndexedDB store with the server.
//
//   push  — send queued outbox mutations (and any locally-dirty rows) up
//   pull  — download the server's full store and merge it in (LWW)
//
// Both directions use the shared merge helpers, so the same row edited on two
// devices converges to the newest `updatedAt`. Deletions are soft (a tombstone
// `deletedAt`), so an offline delete still wins over a stale live copy.

import { makeTrpcClient } from "@/_core/trpc";
import type { CategorySlug, GoalPeriod } from "@shared/activities";
import {
  idbDeleteOutbox,
  idbListActivities,
  idbListGoals,
  idbListOutbox,
  idbPutActivities,
  idbPutGoals,
  idbPutOutbox,
} from "./idb";
import {
  mergeById,
  mergeGoalsByCategory,
  type OutboxEntry,
  type SyncActivity,
  type SyncGoal,
} from "@shared/sync";

export type SyncStatus = "idle" | "syncing" | "offline" | "error";

export interface SyncState {
  status: SyncStatus;
  pending: number;
  lastSyncAt: number | null;
}

type Listener = (state: SyncState) => void;

const CHANNEL = "dayline-sync";

let state: SyncState = { status: "idle", pending: 0, lastSyncAt: null };
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let running = false;

// A vanilla tRPC client for non-React use. The React provider uses its own
// client; this one exists only so the sync engine can call the API directly.
let client: ReturnType<typeof makeTrpcClient> | null = null;
function api() {
  if (!client) client = makeTrpcClient();
  return client;
}

function emit() {
  for (const l of listeners) l(state);
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  emit();
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** A client-generated id, stable across devices. */
export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Build a fresh activity row (used by the log form before it is persisted). */
export function makeActivity(input: {
  category: CategorySlug;
  title: string;
  durationMinutes: number;
  activityDate: string;
  startTime?: string | null;
  notes?: string | null;
  intensity?: string | null;
  location?: string | null;
  tags?: string | null;
}): SyncActivity {
  const ts = nowIso();
  return {
    id: newId(),
    category: input.category,
    title: input.title,
    durationMinutes: input.durationMinutes,
    activityDate: input.activityDate,
    startTime: input.startTime ?? null,
    notes: input.notes ?? null,
    intensity: input.intensity ?? null,
    location: input.location ?? null,
    tags: input.tags ?? null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
}

/** Build a fresh goal row. */
export function makeGoal(input: {
  category: CategorySlug;
  period: GoalPeriod;
  targetMinutes: number;
}): SyncGoal {
  const ts = nowIso();
  return {
    id: newId(),
    category: input.category,
    period: input.period,
    targetMinutes: input.targetMinutes,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
}

/** Queue a mutation locally and kick a sync. */
export async function enqueue(entry: OutboxEntry): Promise<void> {
  await idbPutOutbox(entry);
  await refreshPending();
  void syncNow();
}

async function refreshPending(): Promise<void> {
  const outbox = await idbListOutbox();
  setState({ pending: outbox.length });
}

/** Push queued mutations, then pull. Returns true when fully reconciled. */
export async function syncNow(): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    if (!isOnline()) {
      setState({ status: "offline" });
      return false;
    }
    setState({ status: "syncing" });

    const outbox = await idbListOutbox();
    const localActivities = await idbListActivities();
    const localGoals = await idbListGoals();

    // Push: send exactly the queued mutations — their full rows, tombstones
    // included for deletes. The outbox is cleared only after the server
    // accepts them.
    if (outbox.length > 0) {
      const activities = outbox
        .filter((e) => e.entity === "activity")
        .map((e) => e.data as SyncActivity);
      const goals = outbox.filter((e) => e.entity === "goal").map((e) => e.data as SyncGoal);
      await api().sync.push.mutate({ activities, goals });
      for (const e of outbox) await idbDeleteOutbox(e.id);
    }

    // Pull: download and merge the server's store.
    const remote = await api().sync.pull.query();
    const mergedActivities = mergeById(localActivities, remote.activities);
    const mergedGoals = mergeGoalsByCategory(localGoals, remote.goals);

    await idbPutActivities(mergedActivities);
    await idbPutGoals(mergedGoals);

    await refreshPending();
    setState({ status: "idle", lastSyncAt: Date.now() });
    return true;
  } catch (e) {
    setState({ status: isOnline() ? "error" : "offline" });
    return false;
  } finally {
    running = false;
  }
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getSyncState(): SyncState {
  return state;
}

/** Notify other tabs (same browser) that the local store changed. */
export function broadcastLocalChange(): void {
  if (typeof BroadcastChannel === "undefined") return;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  channel.postMessage({ type: "local-change" });
}

/** Wire up online/offline + cross-tab listeners. Call once at app start. */
export function initSync(): () => void {
  if (typeof window === "undefined") return () => {};

  const onOnline = () => void syncNow();
  const onOffline = () => setState({ status: "offline" });
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (ev) => {
      if (ev.data?.type === "local-change") void syncNow();
    };
  }

  // Periodic reconciliation, and a first sync once the app is up.
  const interval = window.setInterval(() => void syncNow(), 60_000);
  void refreshPending();
  void syncNow();

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.clearInterval(interval);
    channel?.close();
  };
}
