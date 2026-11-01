// Category reference data, shared by client and server. The database copy
// (seeded via migration) is the source of truth for colours/labels at runtime;
// this list is the fallback + the validation allowlist.

export const CATEGORY_SLUGS = [
  "exercise",
  "work",
  "reading",
  "sleep",
  "learning",
  "social",
  "chores",
  "health",
  "cooking",
  "commute",
  "creative",
  "screen",
  "outdoors",
  "other",
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export interface CategoryDef {
  slug: CategorySlug;
  label: string;
  color: string;
  icon: string;
  sortOrder: number;
}

// Muted, warm-leaning palette: distinguishable at 8px in a stacked bar, and
// never louder than the terracotta accent.
export const CATEGORIES: CategoryDef[] = [
  { slug: "exercise", label: "Exercise", color: "#C2410C", icon: "Dumbbell", sortOrder: 1 },
  { slug: "work", label: "Work", color: "#4A5D7E", icon: "Briefcase", sortOrder: 2 },
  { slug: "reading", label: "Reading", color: "#7C6A9C", icon: "BookOpen", sortOrder: 3 },
  { slug: "sleep", label: "Sleep", color: "#5B7C6F", icon: "Moon", sortOrder: 4 },
  { slug: "learning", label: "Learning", color: "#B08968", icon: "GraduationCap", sortOrder: 5 },
  { slug: "social", label: "Social", color: "#A65D57", icon: "Users", sortOrder: 6 },
  { slug: "chores", label: "Chores", color: "#8A8A7E", icon: "House", sortOrder: 7 },
  { slug: "health", label: "Health", color: "#8C6A5D", icon: "HeartPulse", sortOrder: 8 },
  { slug: "cooking", label: "Cooking", color: "#A97C50", icon: "ChefHat", sortOrder: 9 },
  { slug: "commute", label: "Commute", color: "#6E7F8D", icon: "TrainFront", sortOrder: 10 },
  { slug: "creative", label: "Creative", color: "#9A6A8E", icon: "Palette", sortOrder: 11 },
  { slug: "screen", label: "Screen time", color: "#7A7A8C", icon: "Monitor", sortOrder: 12 },
  { slug: "outdoors", label: "Outdoors", color: "#6F8A5E", icon: "Trees", sortOrder: 13 },
  { slug: "other", label: "Other", color: "#9C9188", icon: "Circle", sortOrder: 14 },
];

export const CATEGORY_MAP: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
);

export function categoryDef(slug: string): CategoryDef {
  return CATEGORY_MAP[slug] ?? CATEGORY_MAP.other;
}

export function isCategorySlug(value: string): value is CategorySlug {
  return (CATEGORY_SLUGS as readonly string[]).includes(value);
}

/** Max minutes a single entry may hold (24h). */
export const MAX_DURATION_MINUTES = 1440;

// ── Intensity ────────────────────────────────────────────────────────────────

export const INTENSITIES = ["light", "moderate", "hard"] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const INTENSITY_LABELS: Record<Intensity, string> = {
  light: "Light",
  moderate: "Moderate",
  hard: "Hard",
};

export function isIntensity(value: string): value is Intensity {
  return (INTENSITIES as readonly string[]).includes(value);
}

// ── Location ─────────────────────────────────────────────────────────────────

export const LOCATIONS = ["home", "office", "gym", "outdoors", "other"] as const;
export type Location = (typeof LOCATIONS)[number];

export const LOCATION_LABELS: Record<Location, string> = {
  home: "Home",
  office: "Office",
  gym: "Gym",
  outdoors: "Outdoors",
  other: "Other",
};

export function isLocation(value: string): value is Location {
  return (LOCATIONS as readonly string[]).includes(value);
}

// ── Tags ─────────────────────────────────────────────────────────────────────

/** Normalise a free-form tag list: trim, lowercase, dedupe, cap at 8 tags. */
export function normalizeTags(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : input.split(",");
  const seen = new Set<string>();
  for (const t of raw) {
    const clean = t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 24);
    if (clean) seen.add(clean);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

export function tagsToText(tags: string | string[] | null | undefined): string | null {
  const list = normalizeTags(tags);
  return list.length ? list.join(",") : null;
}

export function tagsFromText(text: string | null | undefined): string[] {
  return normalizeTags(text);
}

// ── Goals ────────────────────────────────────────────────────────────────────

export const GOAL_PERIODS = ["daily", "weekly"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export function isGoalPeriod(value: string): value is GoalPeriod {
  return (GOAL_PERIODS as readonly string[]).includes(value);
}

/** Sensible starting targets, used to pre-fill the goals page. */
export const DEFAULT_GOALS: { category: CategorySlug; period: GoalPeriod; targetMinutes: number }[] = [
  { category: "exercise", period: "daily", targetMinutes: 45 },
  { category: "reading", period: "daily", targetMinutes: 30 },
  { category: "sleep", period: "daily", targetMinutes: 450 },
  { category: "learning", period: "weekly", targetMinutes: 300 },
  { category: "outdoors", period: "weekly", targetMinutes: 180 },
];
