import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, Check, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CATEGORIES,
  INTENSITIES,
  INTENSITY_LABELS,
  LOCATIONS,
  LOCATION_LABELS,
  MAX_DURATION_MINUTES,
  normalizeTags,
  tagsFromText,
  type CategorySlug,
  type Intensity,
  type Location,
} from "@shared/activities";
import { formatDuration, localToday } from "@shared/analytics";
import { cn } from "@/lib/utils";
import { useOfflineStore } from "@/hooks/useOfflineStore";

const QUICK = [15, 30, 45, 60, 90, 120];

export default function LogActivity() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const editId = params.get("id");
  const presetDate = params.get("date");
  const presetCategory = params.get("category");
  const [, navigate] = useLocation();

  const { getActivity, saveActivity, removeActivity } = useOfflineStore();
  const today = localToday();

  const existing = editId ? getActivity(editId) : null;

  const [category, setCategory] = useState<CategorySlug>(() =>
    presetCategory && CATEGORIES.some((c) => c.slug === presetCategory)
      ? (presetCategory as CategorySlug)
      : "exercise",
  );
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("30");
  const [date, setDate] = useState(presetDate ?? today);
  const [startTime, setStartTime] = useState("");
  const [notes, setNotes] = useState("");
  const [intensity, setIntensity] = useState<Intensity | "">("");
  const [location, setLocation] = useState<Location | "">("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Hydrate the form once the row arrives (edit mode).
  useEffect(() => {
    if (!existing) return;
    setCategory(existing.category as CategorySlug);
    setTitle(existing.title);
    setDuration(String(existing.durationMinutes));
    setDate(existing.activityDate);
    setStartTime(existing.startTime ?? "");
    setNotes(existing.notes ?? "");
    setIntensity((existing.intensity as Intensity) ?? "");
    setLocation((existing.location as Location) ?? "");
    setTags(tagsFromText(existing.tags));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  const minutes = Number(duration);
  const durationValid = Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_DURATION_MINUTES;

  const preview = useMemo(
    () => (durationValid ? formatDuration(minutes) : "—"),
    [durationValid, minutes],
  );

  function addTag(raw: string) {
    const next = normalizeTags([...tags, raw]);
    setTags(next);
    setTagInput("");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Give the activity a name.");
    if (!durationValid) return setError("Duration must be between 1 and 1440 minutes.");

    const payload = {
      category,
      title: title.trim(),
      durationMinutes: Math.round(minutes),
      activityDate: date,
      startTime: startTime || null,
      notes: notes.trim() || null,
      intensity: intensity || null,
      location: location || null,
      tags: tags.length ? tags.join(",") : null,
    };

    setBusy(true);
    try {
      await saveActivity(payload, editId ?? undefined);
      setSaved(true);
      setTimeout(() => navigate(editId ? "/history" : "/"), 300);
    } catch {
      setError("Could not save. Please try again.");
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!editId) return;
    setBusy(true);
    try {
      await removeActivity(editId);
      navigate("/history");
    } catch {
      setError("Could not delete. Please try again.");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[720px] space-y-6">
        <header>
          <Link
            to={editId ? "/history" : "/"}
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
          <h1 className="text-[26px] font-semibold leading-tight sm:text-[30px]">
            {editId ? "Edit activity" : "Log an activity"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {editId
              ? "Change anything and save — the dashboard updates immediately."
              : "What did you do, for how long, and when?"}
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Category picker */}
          <fieldset className="card-soft p-5">
            <legend className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Category
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CATEGORIES.map((c) => {
                const active = category === c.slug;
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => setCategory(c.slug)}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all",
                      active
                        ? "border-transparent font-medium shadow-sm"
                        : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                    )}
                    style={
                      active
                        ? {
                            background: `${c.color}12`,
                            color: c.color,
                            boxShadow: `inset 0 0 0 1px ${c.color}55`,
                          }
                        : undefined
                    }
                  >
                    <CategoryIcon icon={c.icon} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="card-soft space-y-5 p-5">
            <div className="space-y-2">
              <Label htmlFor="title">Activity</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Morning run"
                maxLength={120}
                autoFocus
                required
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (minutes)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="duration"
                    type="number"
                    min={1}
                    max={MAX_DURATION_MINUTES}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="tnum"
                    required
                  />
                  <span className="tnum shrink-0 text-sm text-muted-foreground">{preview}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setDuration(String(q))}
                      className={cn(
                        "tnum rounded-md border px-2 py-1 text-[11px] transition-colors",
                        Number(duration) === q
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {q}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  max={today}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
                <div className="flex gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setDate(today)}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 1);
                      setDate(
                        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
                          d.getDate(),
                        ).padStart(2, "0")}`,
                      );
                    }}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    Yesterday
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startTime">
                  Start time{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="tnum"
                />
                <p className="text-[11px] text-muted-foreground">
                  Places the entry on the time-of-day heatmap.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">
                  Location <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <select
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value as Location | "")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Not specified</option>
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {LOCATION_LABELS[l]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Intensity <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setIntensity("")}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    intensity === ""
                      ? "border-foreground/25 bg-secondary font-medium text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  Not set
                </button>
                {INTENSITIES.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIntensity(i)}
                    aria-pressed={intensity === i}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      intensity === i
                        ? "border-primary/40 bg-primary/10 font-medium text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {INTENSITY_LABELS[i]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">
                Tags <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-[11px] font-medium text-secondary-foreground"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      aria-label={`Remove tag ${t}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <Input
                  id="tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      if (tagInput.trim()) addTag(tagInput);
                    }
                    if (e.key === "Backspace" && !tagInput && tags.length) {
                      setTags(tags.slice(0, -1));
                    }
                  }}
                  onBlur={() => {
                    if (tagInput.trim()) addTag(tagInput);
                  }}
                  placeholder={tags.length ? "Add another…" : "morning, with-sam"}
                  maxLength={24}
                  className="h-8 w-40 text-xs"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Press Enter or comma to add. Up to 8 tags.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="How did it go? Anything worth remembering?"
                className="flex w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy} className="min-w-[130px]">
              {saved ? (
                <>
                  <Check className="h-4 w-4" /> Saved
                </>
              ) : busy ? (
                "Saving…"
              ) : editId ? (
                "Save changes"
              ) : (
                "Log activity"
              )}
            </Button>
            <Button type="button" variant="ghost" asChild>
              <Link to={editId ? "/history" : "/"}>Cancel</Link>
            </Button>
            {editId && (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
                onClick={() => {
                  if (confirm("Delete this activity? This cannot be undone.")) void onDelete();
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        </form>
      </div>
    </AppShell>
  );
}
