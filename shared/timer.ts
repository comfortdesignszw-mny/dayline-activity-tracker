// Pure stopwatch helpers. The running timer's start instant lives in the
// database; everything here is arithmetic on that instant, so the same elapsed
// value is produced after a reload, a navigation, or on another device.

export interface TimerLike {
  id: string;
  category: string;
  title: string;
  startedAt: string | Date;
  notes?: string | null;
}

/** Elapsed whole seconds between `startedAt` and `now` (never negative). */
export function elapsedSeconds(startedAt: string | Date, now: Date): number {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const ms = now.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 1000);
}

/** "01:23:45" — hours always shown, so the width never jumps. */
export function formatStopwatch(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Minutes to save for a stopped timer. Rounds to the nearest minute but never
 * returns 0 — a 20-second timer is still a real entry, and the schema rejects
 * a zero duration.
 */
export function timerMinutes(totalSeconds: number): number {
  return Math.max(1, Math.round(totalSeconds / 60));
}

/** "HH:MM" local wall-clock for a Date — the entry's start time. */
export function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Local "YYYY-MM-DD" for a Date. */
export function dayKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A timer left running overnight would otherwise save a 14-hour entry. Cap the
 * saved duration at 24h (the schema's limit) and report that it was capped, so
 * the UI can say so instead of silently writing a wrong number.
 */
export function cappedTimerMinutes(totalSeconds: number): { minutes: number; capped: boolean } {
  const raw = timerMinutes(totalSeconds);
  if (raw > 1440) return { minutes: 1440, capped: true };
  return { minutes: raw, capped: false };
}
