// Pure export helpers: CSV serialisation and the weekly/monthly report model.
// Kept out of the React layer so the same numbers can be tested and reused by
// the PDF renderer.

import { categoryDef, tagsFromText } from "./activities";
import {
  addDays,
  dailyAverage,
  formatDuration,
  formatLongDay,
  goalProgress,
  overallStreak,
  startOfWeek,
  summarizeDay,
  totalsByCategory,
  weeklySeries,
  type ActivityLike,
  type DayKey,
  type GoalLike,
} from "./analytics";

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180 field: quote when it contains a comma, quote, CR or LF. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_COLUMNS = [
  "date",
  "start_time",
  "category",
  "category_label",
  "title",
  "duration_minutes",
  "duration_hours",
  "intensity",
  "location",
  "tags",
  "notes",
] as const;

/**
 * One row per activity, every field the model holds. `\r\n` line endings and a
 * UTF-8 BOM are what make Excel open it correctly rather than mangling accents.
 */
export function activitiesToCsv(rows: ActivityLike[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((r) =>
    [
      r.activityDate,
      r.startTime ?? "",
      r.category,
      categoryDef(r.category).label,
      r.title,
      r.durationMinutes,
      (r.durationMinutes / 60).toFixed(2),
      r.intensity ?? "",
      r.location ?? "",
      tagsFromText(r.tags).join(" "),
      r.notes ?? "",
    ]
      .map(csvField)
      .join(","),
  );
  return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
}

/** `dayline-activities-2026-10-01-to-2026-10-31.csv` */
export function csvFilename(from: DayKey, to: DayKey): string {
  return `dayline-activities-${from}-to-${to}.csv`;
}

// ── Report model ─────────────────────────────────────────────────────────────

export type ReportPeriod = "week" | "month";

export interface ReportCategoryLine {
  category: string;
  label: string;
  color: string;
  minutes: number;
  share: number;
  count: number;
}

export interface ReportDayLine {
  date: DayKey;
  label: string;
  totalMinutes: number;
  count: number;
}

export interface ReportModel {
  period: ReportPeriod;
  title: string;
  from: DayKey;
  to: DayKey;
  generatedOn: DayKey;
  totalMinutes: number;
  entryCount: number;
  activeDays: number;
  dayCount: number;
  dailyAverageMinutes: number;
  topCategory: string | null;
  streak: { current: number; longest: number };
  categories: ReportCategoryLine[];
  days: ReportDayLine[];
  goals: { category: string; label: string; color: string; actual: number; target: number; met: boolean }[];
  entries: ActivityLike[];
}

/**
 * Builds the report for a period ending on `endKey`. A week is the 7 days
 * ending today; a month is the calendar month containing `endKey`, clipped to
 * today so a mid-month report does not claim days that have not happened.
 */
export function buildReport(
  rows: ActivityLike[],
  goals: GoalLike[],
  endKey: DayKey,
  period: ReportPeriod,
): ReportModel {
  let from: DayKey;
  let to: DayKey = endKey;
  let title: string;

  if (period === "week") {
    from = startOfWeek(endKey);
    title = "Weekly report";
  } else {
    from = `${endKey.slice(0, 7)}-01`;
    title = "Monthly report";
  }

  const inRange = rows
    .filter((r) => r.activityDate >= from && r.activityDate <= to)
    .sort((a, b) =>
      a.activityDate === b.activityDate
        ? (a.startTime ?? "").localeCompare(b.startTime ?? "")
        : a.activityDate.localeCompare(b.activityDate),
    );

  const dayCount = Math.max(1, daysBetween(from, to) + 1);
  const totals = totalsByCategory(inRange);
  const totalMinutes = totals.reduce((s, t) => s + t.minutes, 0);
  const activeDaySet = new Set(inRange.map((r) => r.activityDate));

  const days: ReportDayLine[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = summarizeDay(inRange, d);
    days.push({
      date: d,
      label: formatLongDay(d).replace(/,.*$/, ""),
      totalMinutes: s.totalMinutes,
      count: s.count,
    });
  }

  const streak = overallStreak(rows, endKey);
  const progress = goalProgress(goals, rows, endKey);

  return {
    period,
    title,
    from,
    to,
    generatedOn: endKey,
    totalMinutes,
    entryCount: inRange.length,
    activeDays: activeDaySet.size,
    dayCount,
    dailyAverageMinutes: Math.round(totalMinutes / dayCount),
    topCategory: totals[0]?.category ?? null,
    streak: { current: streak.current, longest: streak.longest },
    categories: totals.map((t) => ({
      category: t.category,
      label: categoryDef(t.category).label,
      color: categoryDef(t.category).color,
      minutes: t.minutes,
      share: t.share,
      count: t.count,
    })),
    days,
    goals: progress.map((p) => ({
      category: p.category,
      label: categoryDef(p.category).label,
      color: categoryDef(p.category).color,
      actual: p.actualMinutes,
      target: p.targetMinutes,
      met: p.met,
    })),
    entries: inRange,
  };
}

/** Inclusive day count between two keys. */
export function daysBetween(from: DayKey, to: DayKey): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** `dayline-weekly-report-2026-10-31.pdf` */
export function reportFilename(model: ReportModel): string {
  return `dayline-${model.period}ly-report-${model.to}.pdf`;
}

/** A one-line summary used in the report header and the export page preview. */
export function reportHeadline(model: ReportModel): string {
  if (model.entryCount === 0) return "No entries in this period.";
  const top = model.topCategory ? categoryDef(model.topCategory).label : "—";
  return `${formatDuration(model.totalMinutes)} across ${model.entryCount} entries · top: ${top}`;
}

/** Re-exported so the export page can render the same 7-day series. */
export { weeklySeries, dailyAverage };
