// Pure reminder scheduling logic, shared by the client scheduler and the tests.
// No DOM, no DB: given a reminder and a clock, decide whether it is due.

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface ReminderLike {
  id: string;
  category: string | null;
  title: string;
  message?: string | null;
  timeOfDay: string; // "HH:MM"
  daysOfWeek: string; // "0,1,2,3,4,5,6"
  enabled: boolean;
  lastFiredOn?: string | null;
}

/** Parse "0,1,4" → [0,1,4], dropping anything outside 0–6 and deduping. */
export function parseDays(daysOfWeek: string | null | undefined): number[] {
  if (!daysOfWeek) return [];
  const seen = new Set<number>();
  for (const part of daysOfWeek.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 0 && n <= 6) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

export function daysToText(days: number[]): string {
  const clean = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
  return clean.length ? clean.join(",") : "0,1,2,3,4,5,6";
}

/** "Every day" / "Weekdays" / "Mon, Wed, Fri" — for the settings list. */
export function describeDays(daysOfWeek: string): string {
  const days = parseDays(daysOfWeek);
  if (days.length === 7) return "Every day";
  if (days.length === 0) return "No days";
  if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) return "Weekdays";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "Weekends";
  return days.map((d) => WEEKDAY_LABELS[d]).join(", ");
}

/** "07:30" → "7:30 am". Null when unparseable. */
export function formatReminderTime(hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

/** Minutes since midnight for "HH:MM", or null. */
export function reminderMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Local "YYYY-MM-DD" for a Date — the same key the activity log uses. */
export function localDayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Is this reminder due right now?
 *
 * Due means: enabled, today is one of its days, the clock has passed its time,
 * and it has not already fired today. The window is deliberately open-ended
 * (no "within 5 minutes") so a reminder that came due while the tab was closed
 * still shows up when the app is opened later that day — which is the behaviour
 * a person expects from a nudge they missed.
 */
export function isReminderDue(reminder: ReminderLike, now: Date): boolean {
  if (!reminder.enabled) return false;
  const days = parseDays(reminder.daysOfWeek);
  if (!days.includes(now.getDay())) return false;
  const target = reminderMinutes(reminder.timeOfDay);
  if (target === null) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < target) return false;
  return reminder.lastFiredOn !== localDayKey(now);
}

/** All reminders due at `now`, earliest time-of-day first. */
export function dueReminders<T extends ReminderLike>(reminders: T[], now: Date): T[] {
  return reminders
    .filter((r) => isReminderDue(r, now))
    .sort((a, b) => (reminderMinutes(a.timeOfDay) ?? 0) - (reminderMinutes(b.timeOfDay) ?? 0));
}

/** The next occurrence of a reminder after `now`, for the "next up" line. */
export function nextOccurrence(reminder: ReminderLike, now: Date): Date | null {
  const target = reminderMinutes(reminder.timeOfDay);
  if (target === null) return null;
  const days = parseDays(reminder.daysOfWeek);
  if (days.length === 0) return null;

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(Math.floor(target / 60), target % 60, 0, 0);
    if (!days.includes(candidate.getDay())) continue;
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
}

/** "in 2h 15m" / "in 8m" / "now" — for the next-up line. */
export function describeCountdown(target: Date, now: Date): string {
  const diff = Math.round((target.getTime() - now.getTime()) / 60000);
  if (diff <= 0) return "now";
  if (diff < 60) return `in ${diff}m`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h < 24) return m ? `in ${h}h ${m}m` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d ${h % 24}h`;
}

/** Notification body: the reminder's own message, else a category-aware nudge. */
export function reminderBody(reminder: ReminderLike, categoryLabel: string | null): string {
  if (reminder.message?.trim()) return reminder.message.trim();
  if (categoryLabel) return `Time for ${categoryLabel.toLowerCase()} — log it when you're done.`;
  return "A good moment to log what you've been doing.";
}
