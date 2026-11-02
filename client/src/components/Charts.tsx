import { useMemo, useState } from "react";
import { categoryDef } from "@shared/activities";
import { formatDuration, type Heatmap, type WeekPoint } from "@shared/analytics";
import { cn } from "@/lib/utils";

// ── Stacked weekly bar chart ─────────────────────────────────────────────────
// Hand-rolled SVG: no chart dependency, full control over the muted palette and
// the tabular-numeral axis labels.

const CHART_H = 208;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

function niceMax(minutes: number): number {
  if (minutes <= 0) return 60;
  const hours = minutes / 60;
  const steps = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24];
  for (const s of steps) if (hours <= s) return s * 60;
  return Math.ceil(hours / 6) * 6 * 60;
}

export function WeeklyBarChart({
  data,
  categories,
}: {
  data: WeekPoint[];
  categories: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => niceMax(Math.max(...data.map((d) => d.totalMinutes), 0)), [data]);
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  return (
    <div className="w-full">
      <div className="relative">
        <svg
          viewBox={`0 0 700 ${CHART_H}`}
          className="h-[208px] w-full overflow-visible"
          role="img"
          aria-label="Minutes tracked per day over the last seven days"
        >
          {ticks.map((t) => {
            const y = PAD_TOP + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line
                  x1={44}
                  x2={700}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={1}
                  strokeDasharray={t === 0 ? undefined : "3 4"}
                />
                <text
                  x={34}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-muted-foreground tnum"
                  fontSize={10.5}
                >
                  {t === 0 ? "0" : `${Math.round(t / 60)}h`}
                </text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const slot = (700 - 44) / data.length;
            const barW = Math.min(46, slot * 0.52);
            const x = 44 + slot * i + (slot - barW) / 2;
            let cursor = PAD_TOP + plotH;
            const isHover = hover === i;

            return (
              <g
                key={d.date}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={44 + slot * i}
                  y={PAD_TOP}
                  width={slot}
                  height={plotH}
                  fill="currentColor"
                  className={cn(
                    "text-foreground transition-opacity",
                    isHover ? "opacity-[0.035]" : "opacity-0",
                  )}
                  rx={6}
                />
                {categories.map((cat) => {
                  const mins = d.byCategory[cat] ?? 0;
                  if (mins <= 0) return null;
                  const h = (mins / max) * plotH;
                  cursor -= h;
                  return (
                    <rect
                      key={cat}
                      x={x}
                      y={cursor}
                      width={barW}
                      height={Math.max(h, 1.5)}
                      fill={categoryDef(cat).color}
                      opacity={isHover ? 1 : 0.92}
                      rx={2}
                    />
                  );
                })}
                <text
                  x={x + barW / 2}
                  y={CHART_H - 8}
                  textAnchor="middle"
                  fontSize={11}
                  className={cn(
                    "tnum",
                    isHover ? "fill-foreground font-medium" : "fill-muted-foreground",
                  )}
                >
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>

        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-lg border border-border bg-popover p-2.5 text-xs shadow-md"
            style={{
              left: `calc(${((44 + ((700 - 44) / data.length) * (hover + 0.5)) / 700) * 100}% - 75px)`,
            }}
          >
            <p className="mb-1.5 font-medium">{data[hover].label}</p>
            <p className="tnum mb-1.5 text-muted-foreground">
              {formatDuration(data[hover].totalMinutes)} total
            </p>
            {categories
              .filter((c) => (data[hover].byCategory[c] ?? 0) > 0)
              .sort((a, b) => (data[hover].byCategory[b] ?? 0) - (data[hover].byCategory[a] ?? 0))
              .map((c) => (
                <div key={c} className="flex items-center justify-between gap-3 py-0.5">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: categoryDef(c).color }}
                    />
                    {categoryDef(c).label}
                  </span>
                  <span className="tnum text-muted-foreground">
                    {formatDuration(data[hover].byCategory[c] ?? 0)}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Category donut ───────────────────────────────────────────────────────────

export interface DonutSlice {
  category: string;
  minutes: number;
  share: number;
}

export function CategoryDonut({
  slices,
  centerLabel,
}: {
  slices: DonutSlice[];
  totalMinutes?: number;
  centerLabel: string;
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const GAP = slices.length > 1 ? 2.5 : 0;

  let offset = 0;
  const arcs = slices.map((s) => {
    const len = Math.max(s.share * C - GAP, 0.5);
    const arc = { ...s, len, offset };
    offset += s.share * C;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0">
        <svg viewBox="0 0 140 140" className="h-[140px] w-[140px] -rotate-90">
          <circle
            cx={70}
            cy={70}
            r={R}
            fill="none"
            stroke="currentColor"
            className="text-muted"
            strokeWidth={15}
          />
          {arcs.map((a) => (
            <circle
              key={a.category}
              cx={70}
              cy={70}
              r={R}
              fill="none"
              stroke={categoryDef(a.category).color}
              strokeWidth={15}
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={-a.offset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="display-num text-[22px] leading-none">{centerLabel}</span>
          <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            total
          </span>
        </div>
      </div>

      <ul className="w-full space-y-2">
        {slices.map((s) => (
          <li key={s.category} className="flex items-center gap-2.5 text-sm">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: categoryDef(s.category).color }}
            />
            <span className="flex-1 truncate">{categoryDef(s.category).label}</span>
            <span className="tnum text-xs text-muted-foreground">
              {formatDuration(s.minutes)}
            </span>
            <span className="tnum w-9 text-right text-xs font-medium">
              {Math.round(s.share * 100)}%
            </span>
          </li>
        ))}
        {slices.length === 0 && (
          <li className="text-sm text-muted-foreground">Nothing logged in this range yet.</li>
        )}
      </ul>
    </div>
  );
}

// ── Goal progress ring ───────────────────────────────────────────────────────

export function GoalRing({
  ratio,
  color,
  size = 56,
  stroke = 6,
  children,
}: {
  ratio: number;
  color: string;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, ratio)) * c;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-muted"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

// ── Time-of-day heatmap ──────────────────────────────────────────────────────

export function TimeHeatmap({ heatmap }: { heatmap: Heatmap }) {
  const { cells, buckets, maxMinutes, untimedCount } = heatmap;

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          {/* hour axis */}
          <div className="mb-1.5 flex gap-1 pl-9">
            {buckets.map((b) => (
              <div
                key={b}
                className="tnum flex-1 text-center text-[10px] text-muted-foreground"
              >
                {b}
              </div>
            ))}
          </div>

          <div className="space-y-1">
            {cells.map((row, dayIdx) => (
              <div key={heatmap.days[dayIdx]} className="flex items-center gap-1">
                <div className="w-8 shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {heatmap.dayLabels[dayIdx]}
                </div>
                {row.map((cell) => {
                  const intensity = cell.minutes / maxMinutes;
                  return (
                    <div
                      key={cell.bucket}
                      title={
                        cell.minutes > 0
                          ? `${heatmap.dayLabels[dayIdx]} ${buckets[cell.bucket]} — ${formatDuration(cell.minutes)}`
                          : `${heatmap.dayLabels[dayIdx]} ${buckets[cell.bucket]} — nothing logged`
                      }
                      className="group relative h-7 flex-1 rounded-[3px] border border-border/60 transition-transform hover:scale-[1.06]"
                      style={{
                        background:
                          cell.minutes > 0
                            ? `color-mix(in oklab, var(--primary) ${Math.round(
                                12 + intensity * 78,
                              )}%, transparent)`
                            : "var(--muted)",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>Less</span>
          {[0.12, 0.3, 0.5, 0.7, 0.9].map((f) => (
            <span
              key={f}
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{
                background: `color-mix(in oklab, var(--primary) ${Math.round(
                  12 + f * 78,
                )}%, transparent)`,
              }}
            />
          ))}
          <span>More</span>
        </div>
        {untimedCount > 0 && (
          <span>
            {untimedCount} {untimedCount === 1 ? "entry has" : "entries have"} no start time
          </span>
        )}
      </div>
    </div>
  );
}
