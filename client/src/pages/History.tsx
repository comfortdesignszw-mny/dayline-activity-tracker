import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Funnel, Pencil, Plus, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CATEGORIES,
  INTENSITIES,
  INTENSITY_LABELS,
  LOCATIONS,
  LOCATION_LABELS,
  categoryDef,
  tagsFromText,
} from "@shared/activities";
import {
  addDays,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatLongDay,
  localToday,
  type DayKey,
} from "@shared/analytics";
import { cn } from "@/lib/utils";
import { useOfflineStore } from "@/hooks/useOfflineStore";

type RangeKey = "7" | "30" | "90" | "all";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
];

export default function History() {
  const today = localToday();
  const { activities, removeActivity, loading } = useOfflineStore();

  const [range, setRange] = useState<RangeKey>("30");
  const [category, setCategory] = useState<string>("all");
  const [intensity, setIntensity] = useState<string>("all");
  const [location, setLocation] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [search, setSearch] = useState("");

  const from = range === "all" ? undefined : addDays(today, -(Number(range) - 1));

  const allRows = useMemo(() => {
    if (from === undefined) return activities;
    return activities.filter((r) => r.activityDate >= from && r.activityDate <= today);
  }, [activities, from, today]);

  /** Tags present in the current range, so the filter only offers real ones. */
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) for (const t of tagsFromText(r.tags)) set.add(t);
    return [...set].sort();
  }, [allRows]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (intensity !== "all" && r.intensity !== intensity) return false;
      if (location !== "all" && r.location !== location) return false;
      if (tag !== "all" && !tagsFromText(r.tags).includes(tag)) return false;
      if (!term) return true;
      return (
        r.title.toLowerCase().includes(term) ||
        (r.notes ?? "").toLowerCase().includes(term) ||
        (r.tags ?? "").toLowerCase().includes(term) ||
        r.category.includes(term)
      );
    });
  }, [allRows, search, intensity, location, tag]);

  const grouped = useMemo(() => {
    const map = new Map<DayKey, typeof rows>();
    for (const r of rows) {
      const list = map.get(r.activityDate) ?? [];
      list.push(r);
      map.set(r.activityDate, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const totalMinutes = rows.reduce((s, r) => s + r.durationMinutes, 0);
  const hasFilters =
    category !== "all" ||
    intensity !== "all" ||
    location !== "all" ||
    tag !== "all" ||
    search.trim() !== "" ||
    range !== "30";

  const clearAll = () => {
    setRange("30");
    setCategory("all");
    setIntensity("all");
    setLocation("all");
    setTag("all");
    setSearch("");
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Full log
            </p>
            <h1 className="mt-1.5 text-[26px] font-semibold leading-tight sm:text-[30px]">
              History
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="tnum">{rows.length}</span>{" "}
              {rows.length === 1 ? "entry" : "entries"} ·{" "}
              <span className="tnum">{formatDuration(totalMinutes)}</span> tracked
            </p>
          </div>
          <Button asChild>
            <Link to="/log">
              <Plus className="h-4 w-4" /> Log activity
            </Link>
          </Button>
        </header>

        {/* ── Filters ─────────────────────────────────────────────── */}
        <div className="card-soft space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <Funnel className="h-3 w-3" /> Range
            </span>
            <div className="flex flex-wrap gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    range === r.key
                      ? "border-primary/40 bg-primary/10 font-medium text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="ml-auto w-full sm:w-56">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search titles, notes, tags…"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <button
              onClick={() => setCategory("all")}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                category === "all"
                  ? "border-foreground/25 bg-secondary font-medium text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              All categories
            </button>
            {CATEGORIES.map((c) => {
              const active = category === c.slug;
              return (
                <button
                  key={c.slug}
                  onClick={() => setCategory(active ? "all" : c.slug)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "border-transparent font-medium"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                  style={active ? { background: `${c.color}14`, color: c.color } : undefined}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                  {c.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Intensity
            </span>
            <select
              value={intensity}
              onChange={(e) => setIntensity(e.target.value)}
              className="h-7 rounded-md border border-input bg-transparent px-1.5 text-[11px]"
              aria-label="Filter by intensity"
            >
              <option value="all">Any</option>
              {INTENSITIES.map((i) => (
                <option key={i} value={i}>
                  {INTENSITY_LABELS[i]}
                </option>
              ))}
            </select>

            <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Location
            </span>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="h-7 rounded-md border border-input bg-transparent px-1.5 text-[11px]"
              aria-label="Filter by location"
            >
              <option value="all">Any</option>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {LOCATION_LABELS[l]}
                </option>
              ))}
            </select>

            <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Tag
            </span>
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="h-7 max-w-[140px] rounded-md border border-input bg-transparent px-1.5 text-[11px]"
              aria-label="Filter by tag"
            >
              <option value="all">Any</option>
              {availableTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            {hasFilters && (
              <button
                onClick={clearAll}
                className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* ── Grouped list ─────────────────────────────────────────── */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-[var(--radius)] bg-muted" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="card-soft flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Funnel className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <h2 className="text-lg font-semibold">
              {hasFilters ? "No entries match these filters" : "Nothing logged yet"}
            </h2>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? "Try a wider date range, a different category, or clear the search."
                : "Your entries will appear here, grouped by day."}
            </p>
            {hasFilters ? (
              <Button variant="outline" className="mt-5" onClick={clearAll}>
                Clear filters
              </Button>
            ) : (
              <Button asChild className="mt-5">
                <Link to="/log">
                  <Plus className="h-4 w-4" /> Log an activity
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(([day, dayRows]) => {
              const dayTotal = dayRows.reduce((s, r) => s + r.durationMinutes, 0);
              return (
                <section key={day} className="card-soft overflow-hidden">
                  <div className="flex items-baseline justify-between gap-3 border-b border-border bg-muted/40 px-5 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-sm font-semibold">{formatDayLabel(day, today)}</h2>
                      <span className="hidden text-[11px] text-muted-foreground sm:inline">
                        {formatLongDay(day)}
                      </span>
                    </div>
                    <span className="tnum text-xs text-muted-foreground">
                      {formatDuration(dayTotal)} · {dayRows.length}{" "}
                      {dayRows.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {dayRows.map((r) => {
                      const def = categoryDef(r.category);
                      const clock = formatClock(r.startTime);
                      const rowTags = tagsFromText(r.tags);
                      return (
                        <li
                          key={r.id}
                          className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/30"
                        >
                          <span
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                            style={{ background: `${def.color}14`, color: def.color }}
                          >
                            <CategoryIcon icon={def.icon} className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <p className="text-sm font-medium">{r.title}</p>
                              <span
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                style={{ background: `${def.color}12`, color: def.color }}
                              >
                                {def.label}
                              </span>
                              {r.intensity && (
                                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                                  {INTENSITY_LABELS[r.intensity as keyof typeof INTENSITY_LABELS] ??
                                    r.intensity}
                                </span>
                              )}
                              {r.location && (
                                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                                  {LOCATION_LABELS[r.location as keyof typeof LOCATION_LABELS] ??
                                    r.location}
                                </span>
                              )}
                              {clock && (
                                <span className="tnum text-[10px] text-muted-foreground">
                                  {clock}
                                </span>
                              )}
                            </div>
                            {r.notes && (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                {r.notes}
                              </p>
                            )}
                            {rowTags.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {rowTags.map((t) => (
                                  <button
                                    key={t}
                                    onClick={() => setTag(t)}
                                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                                  >
                                    #{t}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="tnum mt-0.5 shrink-0 text-sm text-muted-foreground">
                            {formatDuration(r.durationMinutes)}
                          </span>
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                              <Link to={`/log?id=${r.id}`} aria-label={`Edit ${r.title}`}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              aria-label={`Delete ${r.title}`}
                              onClick={() => {
                                if (confirm(`Delete "${r.title}"?`)) void removeActivity(r.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
