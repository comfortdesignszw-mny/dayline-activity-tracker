// Goals panel: per-category progress rings plus inline create/edit/delete, all
// through the offline store (so it works with the network off and syncs later).

import { useState } from "react";
import { Pencil, Plus, Target, Trash2, X } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORIES, categoryDef, type CategorySlug, type GoalPeriod } from "@shared/activities";
import { formatDuration, goalProgress, localToday } from "@shared/analytics";
import { useOfflineStore } from "@/hooks/useOfflineStore";
import type { SyncActivity } from "@shared/sync";

function Ring({ ratio, color, size = 52 }: { ratio: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90 shrink-0"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeWidth={5}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - ratio * c}
      />
    </svg>
  );
}

interface EditorState {
  id?: string;
  category: CategorySlug;
  period: GoalPeriod;
  targetMinutes: string;
}

export function GoalRings({ rows }: { rows: SyncActivity[] }) {
  const today = localToday();
  const { goals, saveGoal, removeGoal } = useOfflineStore();
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);

  const progress = goalProgress(goals, rows, today);
  const hasGoals = goals.length > 0;

  const openAdd = () =>
    setEditing({ category: "exercise", period: "daily", targetMinutes: "30" });

  const openEdit = (g: (typeof goals)[number]) =>
    setEditing({
      id: g.id,
      category: g.category,
      period: g.period as GoalPeriod,
      targetMinutes: String(g.targetMinutes),
    });

  async function submit() {
    if (!editing) return;
    const target = Number(editing.targetMinutes);
    if (!Number.isFinite(target) || target < 5) return;
    setBusy(true);
    await saveGoal(
      {
        category: editing.category,
        period: editing.period,
        targetMinutes: Math.round(target),
      },
      editing.id,
    );
    setBusy(false);
    setEditing(null);
  }

  return (
    <section className="card-soft p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Goals</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {hasGoals
              ? "Daily and weekly targets by category."
              : "Set a target and watch the ring fill as you log."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" /> Add goal
        </Button>
      </div>

      {editing && (
        <div className="mb-5 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Category
              </span>
              <select
                value={editing.category}
                onChange={(e) => setEditing({ ...editing, category: e.target.value as CategorySlug })}
                className="flex h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Period
              </span>
              <select
                value={editing.period}
                onChange={(e) => setEditing({ ...editing, period: e.target.value as GoalPeriod })}
                className="flex h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Target (min)
              </span>
              <Input
                type="number"
                min={5}
                value={editing.targetMinutes}
                onChange={(e) => setEditing({ ...editing, targetMinutes: e.target.value })}
                className="tnum h-8 w-24 text-xs"
              />
            </div>
            <Button size="sm" disabled={busy} onClick={submit}>
              {editing.id ? "Save" : "Add"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {!hasGoals ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Target className="mb-3 h-6 w-6 text-muted-foreground/50" strokeWidth={1.6} />
          <p className="text-sm text-muted-foreground">
            No goals yet. Add one — e.g. “30 min of exercise a day”.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {progress.map((p) => {
            const def = categoryDef(p.category);
            return (
              <li
                key={p.category}
                className="group flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="relative">
                  <Ring ratio={p.ratio} color={def.color} />
                  <span
                    className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tnum"
                    style={{ color: def.color }}
                  >
                    {Math.round(p.ratio * 100)}%
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <CategoryIcon icon={def.icon} className="h-3.5 w-3.5" />
                    <p className="truncate text-sm font-medium">{def.label}</p>
                  </div>
                  <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
                    {formatDuration(p.actualMinutes)} / {formatDuration(p.targetMinutes)} ·{" "}
                    {p.period}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {p.met ? "Met ✓" : `${formatDuration(p.remainingMinutes)} to go`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={`Edit ${def.label} goal`}
                    onClick={() => {
                      const g = goals.find((x) => x.category === p.category)!;
                      openEdit(g);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${def.label} goal`}
                    onClick={() => {
                      const g = goals.find((x) => x.category === p.category);
                      if (g) void removeGoal(g.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
