// Pure date + analytics helpers shared by client and server. No DB, no React —
// so the same numbers are computed in tests and in the UI.

export type DayKey = string; // "YYYY-MM-DD"

export interface ActivityLike {
  id: string;
  category: string;
  title: string;
  durationMinutes: number;
  activityDate: DayKey;
  startTime?: string | null;
  notes?: string | null;
  intensity?: string | null;
  location?: string | null;
  tags?: string | null;
}

/** Parse a "YYYY-MM-DD" key as a UTC midnight Date (no local-time drift). */
export function parseDay(key: DayKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function formatDay(date: Date): DayKey {
  return date.toISOString().slice(0, 10);
}

export function addDays(key: DayKey, delta: number): DayKey {
  const d = parseDay(key);
  d.setUTCDate(d.getUTCDate() + delta);
  return formatDay(d);
}

/** Today's date key in the *viewer's* local timezone. */
export function localToday(now: Date = new Date()): DayKey {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dayRange(endKey: DayKey, days: number): DayKey[] {
  const out: DayKey[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDays(endKey, -i));
  return out;
}

/** Monday-based start of the week containing `key`. */
export function startOfWeek(key: DayKey): DayKey {
  const dow = parseDay(key).getUTCDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(key, -back);
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayShort(key: DayKey): string {
  return WEEKDAY[parseDay(key).getUTCDay()];
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  if (rest === 0) return `${h}h`;
  return `${h}h ${rest}m`;
}

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

export function formatDayLabel(key: DayKey, today: DayKey): string {
  if (key === today) return "Today";
  if (key === addDays(today, -1)) return "Yesterday";
  const d = parseDay(key);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatLongDay(key: DayKey): string {
  return parseDay(key).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "07:30" → "7:30 am". Returns null for anything unparseable. */
export function formatClock(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

/** Minutes since midnight for an "HH:MM" string, or null. */
export function minutesOfDay(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

export interface CategoryTotal {
  category: string;
  minutes: number;
  count: number;
  share: number; // 0..1 of the range total
}

export function totalsByCategory(rows: ActivityLike[]): CategoryTotal[] {
  const map = new Map<string, { minutes: number; count: number }>();
  for (const r of rows) {
    const cur = map.get(r.category) ?? { minutes: 0, count: 0 };
    cur.minutes += r.durationMinutes;
    cur.count += 1;
    map.set(r.category, cur);
  }
  const total = [...map.values()].reduce((s, v) => s + v.minutes, 0);
  return [...map.entries()]
    .map(([category, v]) => ({
      category,
      minutes: v.minutes,
      count: v.count,
      share: total > 0 ? v.minutes / total : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

export interface DaySummary {
  date: DayKey;
  totalMinutes: number;
  count: number;
  topCategory: string | null;
  byCategory: Record<string, number>;
}

export function summarizeDay(rows: ActivityLike[], date: DayKey): DaySummary {
  const dayRows = rows.filter((r) => r.activityDate === date);
  const byCategory: Record<string, number> = {};
  for (const r of dayRows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.durationMinutes;
  }
  const top = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  return {
    date,
    totalMinutes: dayRows.reduce((s, r) => s + r.durationMinutes, 0),
    count: dayRows.length,
    topCategory: top ? top[0] : null,
    byCategory,
  };
}

export interface WeekPoint {
  date: DayKey;
  label: string;
  totalMinutes: number;
  byCategory: Record<string, number>;
}

export function weeklySeries(rows: ActivityLike[], endKey: DayKey, days = 7): WeekPoint[] {
  return dayRange(endKey, days).map((date) => {
    const s = summarizeDay(rows, date);
    return {
      date,
      label: weekdayShort(date),
      totalMinutes: s.totalMinutes,
      byCategory: s.byCategory,
    };
  });
}

/** Minutes per category for the current Monday–Sunday week, up to today. */
export function weekToDateTotals(rows: ActivityLike[], today: DayKey): Record<string, number> {
  const start = startOfWeek(today);
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.activityDate < start || r.activityDate > today) continue;
    out[r.category] = (out[r.category] ?? 0) + r.durationMinutes;
  }
  return out;
}

// ── Streaks ──────────────────────────────────────────────────────────────────

export interface StreakInfo {
  current: number;
  longest: number;
  /** true when today has no entry yet but the streak is still alive from yesterday */
  pendingToday: boolean;
  lastLogged: DayKey | null;
}

/**
 * Consecutive-day streak over a set of day keys. Today counts if present;
 * if today is still empty the streak is measured from yesterday, so a streak
 * does not read as broken before the day has been logged.
 */
export function computeStreak(days: Set<DayKey>, today: DayKey): StreakInfo {
  let cursor = today;
  let pendingToday = false;
  if (!days.has(cursor)) {
    pendingToday = true;
    cursor = addDays(today, -1);
  }
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev: DayKey | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }

  const lastLogged = sorted.length ? sorted[sorted.length - 1] : null;
  return { current, longest, pendingToday, lastLogged };
}

export interface CategoryStreak extends StreakInfo {
  category: string;
  daysLogged: number;
}

export function categoryStreaks(rows: ActivityLike[], today: DayKey): CategoryStreak[] {
  const byCat = new Map<string, Set<DayKey>>();
  for (const r of rows) {
    const set = byCat.get(r.category) ?? new Set<DayKey>();
    set.add(r.activityDate);
    byCat.set(r.category, set);
  }
  return [...byCat.entries()]
    .map(([category, days]) => ({
      category,
      daysLogged: days.size,
      ...computeStreak(days, today),
    }))
    .sort((a, b) => b.current - a.current || b.daysLogged - a.daysLogged);
}

export function overallStreak(rows: ActivityLike[], today: DayKey): StreakInfo {
  return computeStreak(new Set(rows.map((r) => r.activityDate)), today);
}

/** Consecutive days (ending today/yesterday) with at least one entry. */
export function activeDays(rows: ActivityLike[], endKey: DayKey, days = 7): number {
  const set = new Set(rows.map((r) => r.activityDate));
  return dayRange(endKey, days).filter((d) => set.has(d)).length;
}

// ── Goals ────────────────────────────────────────────────────────────────────

export interface GoalLike {
  category: string;
  period: string; // 'daily' | 'weekly'
  targetMinutes: number;
}

export interface GoalProgress {
  category: string;
  period: string;
  targetMinutes: number;
  actualMinutes: number;
  /** 0..1, clamped — a ring cannot draw past a full circle. */
  ratio: number;
  /** true once the target is met. */
  met: boolean;
  /** minutes still owed today/this week (0 when met). */
  remainingMinutes: number;
}

/**
 * Progress for each goal. Daily goals measure today; weekly goals measure the
 * current Monday–Sunday week up to today.
 */
export function goalProgress(
  goals: GoalLike[],
  rows: ActivityLike[],
  today: DayKey,
): GoalProgress[] {
  const todayTotals = summarizeDay(rows, today).byCategory;
  const weekTotals = weekToDateTotals(rows, today);

  return goals
    .map((g) => {
      const actual =
        g.period === "weekly" ? (weekTotals[g.category] ?? 0) : (todayTotals[g.category] ?? 0);
      const target = Math.max(1, g.targetMinutes);
      return {
        category: g.category,
        period: g.period,
        targetMinutes: g.targetMinutes,
        actualMinutes: actual,
        ratio: Math.min(1, actual / target),
        met: actual >= g.targetMinutes,
        remainingMinutes: Math.max(0, g.targetMinutes - actual),
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

// ── Time-of-day heatmap ──────────────────────────────────────────────────────

export const HEATMAP_BUCKETS = [
  { label: "12a", start: 0 },
  { label: "3a", start: 3 },
  { label: "6a", start: 6 },
  { label: "9a", start: 9 },
  { label: "12p", start: 12 },
  { label: "3p", start: 15 },
  { label: "6p", start: 18 },
  { label: "9p", start: 21 },
] as const;

export interface HeatmapCell {
  day: DayKey;
  dayLabel: string;
  bucket: number; // index into HEATMAP_BUCKETS
  minutes: number;
}

export interface Heatmap {
  days: DayKey[];
  dayLabels: string[];
  buckets: string[];
  cells: HeatmapCell[][]; // [dayIndex][bucketIndex]
  maxMinutes: number;
  /** entries with no start time, so the grid's coverage is honest */
  untimedCount: number;
}

/**
 * Minutes per (day × 3-hour bucket), from each entry's start time. An entry
 * that starts at 22:40 and runs 90 minutes is split across 9p and 12a, so the
 * grid reflects time actually spent rather than where it began.
 */
export function timeOfDayHeatmap(rows: ActivityLike[], endKey: DayKey, days = 7): Heatmap {
  const dayKeys = dayRange(endKey, days);
  const index = new Map(dayKeys.map((d, i) => [d, i]));
  const cells: HeatmapCell[][] = dayKeys.map((day) =>
    HEATMAP_BUCKETS.map((_, bucket) => ({
      day,
      dayLabel: weekdayShort(day),
      bucket,
      minutes: 0,
    })),
  );

  let untimedCount = 0;
  for (const r of rows) {
    const dayIdx = index.get(r.activityDate);
    if (dayIdx === undefined) continue;
    const start = minutesOfDay(r.startTime);
    if (start === null) {
      untimedCount += 1;
      continue;
    }
    let remaining = r.durationMinutes;
    let cursor = start;
    // Walk the entry across bucket boundaries; cap at 48 slices (24h of 30m).
    let guard = 0;
    while (remaining > 0 && guard < 48) {
      const posInDay = cursor % 1440;
      const bucket = Math.min(HEATMAP_BUCKETS.length - 1, Math.floor(posInDay / 180));
      const bucketEnd = (bucket + 1) * 180;
      const slice = Math.min(remaining, Math.max(1, bucketEnd - posInDay));
      cells[dayIdx][bucket].minutes += slice;
      remaining -= slice;
      cursor += slice;
      guard += 1;
    }
  }

  const maxMinutes = Math.max(1, ...cells.flat().map((c) => c.minutes));
  return {
    days: dayKeys,
    dayLabels: dayKeys.map(weekdayShort),
    buckets: HEATMAP_BUCKETS.map((b) => b.label),
    cells,
    maxMinutes,
    untimedCount,
  };
}

// ── Tags / intensity / location ──────────────────────────────────────────────

export interface TagCount {
  tag: string;
  minutes: number;
  count: number;
}

export function tagTotals(rows: ActivityLike[]): TagCount[] {
  const map = new Map<string, { minutes: number; count: number }>();
  for (const r of rows) {
    if (!r.tags) continue;
    for (const tag of r.tags.split(",").map((t) => t.trim()).filter(Boolean)) {
      const cur = map.get(tag) ?? { minutes: 0, count: 0 };
      cur.minutes += r.durationMinutes;
      cur.count += 1;
      map.set(tag, cur);
    }
  }
  return [...map.entries()]
    .map(([tag, v]) => ({ tag, ...v }))
    .sort((a, b) => b.minutes - a.minutes);
}

export interface Breakdown {
  key: string;
  minutes: number;
  count: number;
  share: number;
}

/** Generic breakdown by a nullable string field (intensity, location). */
export function breakdownBy(rows: ActivityLike[], field: "intensity" | "location"): Breakdown[] {
  const map = new Map<string, { minutes: number; count: number }>();
  for (const r of rows) {
    const key = r[field];
    if (!key) continue;
    const cur = map.get(key) ?? { minutes: 0, count: 0 };
    cur.minutes += r.durationMinutes;
    cur.count += 1;
    map.set(key, cur);
  }
  const total = [...map.values()].reduce((s, v) => s + v.minutes, 0);
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      minutes: v.minutes,
      count: v.count,
      share: total > 0 ? v.minutes / total : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** Average minutes per day over the window (0 when nothing logged). */
export function dailyAverage(rows: ActivityLike[], endKey: DayKey, days = 7): number {
  const window = new Set(dayRange(endKey, days));
  const total = rows
    .filter((r) => window.has(r.activityDate))
    .reduce((s, r) => s + r.durationMinutes, 0);
  return Math.round(total / days);
}
