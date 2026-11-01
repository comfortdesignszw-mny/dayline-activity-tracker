// IndexedDB store — the offline source of truth. Every read the UI makes goes
// through here; the server is only ever reached by the sync engine. Rows are
// stored as the shared SyncActivity / SyncGoal shapes (ISO-string timestamps),
// so the same merge helpers run on both sides of the wire.

import type { OutboxEntry, SyncActivity, SyncGoal } from "@shared/sync";

const DB_NAME = "dayline";
const DB_VERSION = 1;

const STORE_ACTIVITIES = "activities";
const STORE_GOALS = "goals";
const STORE_OUTBOX = "outbox";
const STORE_META = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ACTIVITIES)) {
        db.createObjectStore(STORE_ACTIVITIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_GOALS)) {
        db.createObjectStore(STORE_GOALS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

function getAll<T>(store: string): Promise<T[]> {
  return tx(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}

function put<T>(store: string, value: T): Promise<void> {
  return tx(store, "readwrite", (s) => s.put(value)).then(() => undefined);
}

function del(store: string, key: string): Promise<void> {
  return tx(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
}

function get<T>(store: string, key: string): Promise<T | undefined> {
  return tx(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}

// ── Activities ──────────────────────────────────────────────────────────

export function idbListActivities(): Promise<SyncActivity[]> {
  return getAll<SyncActivity>(STORE_ACTIVITIES);
}

export function idbGetActivity(id: string): Promise<SyncActivity | undefined> {
  return get<SyncActivity>(STORE_ACTIVITIES, id);
}

export function idbPutActivity(row: SyncActivity): Promise<void> {
  return put(STORE_ACTIVITIES, row);
}

export function idbPutActivities(rows: SyncActivity[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE_ACTIVITIES, "readwrite");
        for (const r of rows) t.objectStore(STORE_ACTIVITIES).put(r);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

export function idbDeleteActivity(id: string): Promise<void> {
  return del(STORE_ACTIVITIES, id);
}

// ── Goals ───────────────────────────────────────────────────────────────

export function idbListGoals(): Promise<SyncGoal[]> {
  return getAll<SyncGoal>(STORE_GOALS);
}

export function idbPutGoal(row: SyncGoal): Promise<void> {
  return put(STORE_GOALS, row);
}

export function idbPutGoals(rows: SyncGoal[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE_GOALS, "readwrite");
        for (const r of rows) t.objectStore(STORE_GOALS).put(r);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

export function idbDeleteGoal(id: string): Promise<void> {
  return del(STORE_GOALS, id);
}

// ── Outbox ──────────────────────────────────────────────────────────────

export function idbListOutbox(): Promise<OutboxEntry[]> {
  return getAll<OutboxEntry>(STORE_OUTBOX);
}

export function idbPutOutbox(entry: OutboxEntry): Promise<void> {
  return put(STORE_OUTBOX, entry);
}

export function idbDeleteOutbox(id: string): Promise<void> {
  return del(STORE_OUTBOX, id);
}

// ── Meta ────────────────────────────────────────────────────────────────

export function idbGetMeta(key: string): Promise<string | undefined> {
  return get<{ key: string; value: string }>(STORE_META, key).then((r) => r?.value);
}

export function idbSetMeta(key: string, value: string): Promise<void> {
  return put(STORE_META, { key, value });
}
