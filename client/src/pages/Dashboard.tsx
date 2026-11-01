import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowRight, Flame, Plus, TrendingUp, Clock, Layers } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CategoryIcon } from "@/components/CategoryIcon";
import { WeeklyBarChart, CategoryDonut, TimeHeatmap } from "@/components/Charts";
import { GoalRings } from "@/components/GoalRings";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/hooks/useActivityLog";
import { CATEGORIES, categoryDef } from "@shared/activities";
import {
  activeDays,
  categoryStreaks,
  formatDayLabel,
  formatDuration,
  formatLongDay,
  overallStreak,
  summarizeDay,
  totalsByCategory,
  weeklySeries,
  timeOfDayHeatmap,
} from "@shared/analytics";
import { cn } from "@/lib/utils";

function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  accent?: boolean;
}) {
  return (
    <div className="card-soft flex flex-col justify-between p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        <Icon
          className={cn("h-4 w-4", accent ? "text-primary" : "text-muted-foreground/60")}
          strokeWidth={1.8}
        />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="display-num text-[28px] leading-none sm:text-[32px]">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {hint && <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card-soft flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Layers className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <h2 className="text-lg font-semibold">Your log is empty</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Log your first activity and this dashboard fills in — today's summary, the weekly
        trend, your category split and streaks.
      </p>
      <Button asChild className="mt-5">
        <Link to="/log">
          <Plus className="h-4 w-4" /> Log an activity
        </Link>
      </Button>
    </div>
  );
}

export default function Dashboard() {
  const { today, rows, isLoading, isSeeding } = useActivityLog(90);

  const todaySummary = useMemo(() => summarizeDay(rows, today), [rows, today]);
  const week = useMemo(() => weeklySeries(rows, today, 7), [rows, today]);
  const weekRows = useMemo(
    () => rows.filter((r) => r.activityDate >= week[0].date),
    [rows, week],
  );
  const weekTotals = useMemo(() => totalsByCategory(weekRows), [weekRows]);
  const weekTotalMinutes = weekTotals.reduce((s, t) => s + t.minutes, 0);
  const streak = useMemo(() => overallStreak(rows, today), [rows, today]);
  const catStreaks = useMemo(() => categoryStreaks(rows, today), [rows, today]);
  const active = useMemo(() => activeDays(rows, today, 7), [rows, today]);
  const recent = useMemo(() => rows.slice(0, 6), [rows]);
  const heatmap = useMemo(() => timeOfDayHeatmap(rows, today, 7), [rows, today]);

  const topCat = todaySummary.topCategory ? categoryDef(todaySummary.topCategory) : null;
  const weekAvg = Math.round(weekTotalMinutes / 7);

  if (isLoading || isSeeding) {
    return (
      <AppShell>
        <div className="space-y-6">
          <div className="h-9 w-64 animate-pulse rounded-lg bg-muted" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[116px] animate-pulse rounded-[var(--radius)] bg-muted" />
            ))}
          </div>
          <div className="h-[300px] animate-pulse rounded-[var(--radius)] bg-muted" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {formatLongDay(today)}
            </p>
            <h1 className="mt-1.5 text-[26px] font-semibold leading-tight sm:text-[30px]">
              Today at a glance
            </h1>
          </div>
          <Button asChild>
            <Link to="/log">
              <Plus className="h-4 w-4" /> Log activity
            </Link>
          </Button>
        </header>

        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Tracked today"
                value={formatDuration(todaySummary.totalMinutes)}
                hint={
                  todaySummary.totalMinutes === 0
                    ? "Nothing logged yet today"
                    : `vs ${formatDuration(weekAvg)} daily average`
                }
                icon={Clock}
                accent
              />
              <StatCard
                label="Activities"
                value={String(todaySummary.count)}
                unit={todaySummary.count === 1 ? "entry" : "entries"}
                hint={`${active} of 7 days active this week`}
                icon={Layers}
              />
              <StatCard
                label="Top category"
                value={topCat ? topCat.label : "—"}
                hint={
                  topCat
                    ? `${formatDuration(todaySummary.byCategory[topCat.slug] ?? 0)} today`
                    : "Log something to see this"
                }
                icon={TrendingUp}
              />
              <StatCard
                label="Current streak"
                value={String(streak.current)}
                unit={streak.current === 1 ? "day" : "days"}
                hint={
                  streak.pendingToday
                    ? "Log today to keep it alive"
                    : `Longest: ${streak.longest} days`
                }
                icon={Flame}
                accent={streak.current > 0}
              />
            </section>

            <section className="card-soft p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold">Last 7 days</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDuration(weekTotalMinutes)} tracked · {formatDuration(weekAvg)} daily
                    average
                  </p>
                </div>
                <ul className="flex flex-wrap gap-x-3.5 gap-y-1.5">
                  {CATEGORIES.filter((c) => weekTotals.some((t) => t.category === c.slug)).map(
                    (c) => (
                      <li
                        key={c.slug}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <span className="h-2 w-2 rounded-[2px]" style={{ background: c.color }} />
                        {c.label}
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <WeeklyBarChart data={week} categories={CATEGORIES.map((c) => c.slug)} />
            </section>

            <GoalRings rows={rows} />

            <section className="card-soft p-5 sm:p-6">
              <div className="mb-5 flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold">When you're active</h2>
                <span className="text-xs text-muted-foreground">
                  Time of day, last 7 days
                </span>
              </div>
              <TimeHeatmap heatmap={heatmap} />
            </section>

            <div className="grid gap-4 lg:grid-cols-5">
              <section className="card-soft p-5 sm:p-6 lg:col-span-2">
                <h2 className="text-[15px] font-semibold">Where the week went</h2>
                <p className="mb-5 mt-0.5 text-xs text-muted-foreground">
                  Share of tracked time, last 7 days
                </p>
                <CategoryDonut
                  slices={weekTotals}
                  centerLabel={formatDuration(weekTotalMinutes)}
                />
              </section>

              <section className="card-soft p-5 sm:p-6 lg:col-span-3">
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="text-[15px] font-semibold">Streaks by category</h2>
                  <span className="text-xs text-muted-foreground">
                    {streak.current > 0
                      ? `${streak.current}-day overall streak`
                      : "Start a streak today"}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {catStreaks.slice(0, 6).map((s) => {
                    const def = categoryDef(s.category);
                    return (
                      <li key={s.category} className="flex items-center gap-3 py-2.5 first:pt-0">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: `${def.color}14`, color: def.color }}
                        >
                          <CategoryIcon icon={def.icon} className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{def.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {s.daysLogged} {s.daysLogged === 1 ? "day" : "days"} logged · best{" "}
                            {s.longest}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Flame
                            className={cn(
                              "h-3.5 w-3.5",
                              s.current > 0 ? "text-primary" : "text-muted-foreground/40",
                            )}
                            strokeWidth={2}
                          />
                          <span className="tnum w-6 text-right text-sm font-semibold">
                            {s.current}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                  {catStreaks.length === 0 && (
                    <li className="py-6 text-center text-sm text-muted-foreground">
                      No categories logged yet.
                    </li>
                  )}
                </ul>
              </section>
            </div>

            <section className="card-soft overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                <h2 className="text-[15px] font-semibold">Recent entries</h2>
                <Link
                  to="/history"
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <ul className="divide-y divide-border">
                {recent.map((r) => {
                  const def = categoryDef(r.category);
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: `${def.color}14`, color: def.color }}
                      >
                        <CategoryIcon icon={def.icon} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.title}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {def.label} · {formatDayLabel(r.activityDate, today)}
                          {r.notes ? ` · ${r.notes}` : ""}
                        </p>
                      </div>
                      <span className="tnum shrink-0 text-sm text-muted-foreground">
                        {formatDuration(r.durationMinutes)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
