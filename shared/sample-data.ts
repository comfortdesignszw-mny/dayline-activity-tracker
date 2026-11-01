// Deterministic sample data so a brand-new account opens onto a populated
// dashboard. Pure: same seed → same rows, which keeps tests stable.
import { addDays, type DayKey } from "./analytics";

export interface SampleActivity {
  category: string;
  title: string;
  durationMinutes: number;
  activityDate: DayKey;
  startTime: string | null;
  notes: string | null;
  intensity: string | null;
  location: string | null;
  tags: string | null;
}

/** mulberry32 — small, fast, deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)];

/** "HH:MM" from minutes since midnight, clamped into the day. */
function clock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

interface Template {
  category: string;
  titles: [string, string][]; // [title, note]
  /** typical start, minutes since midnight */
  start: number;
  /** start jitter, minutes */
  jitter: number;
  min: number;
  max: number;
  intensity?: string[];
  location?: string[];
  tags?: string[];
}

const TEMPLATES: Template[] = [
  {
    category: "sleep",
    titles: [
      ["Night sleep", "Woke up once around 3am"],
      ["Night sleep", "Fell asleep quickly"],
      ["Night sleep", "Late night, slow start"],
    ],
    start: 23 * 60 + 10,
    jitter: 50,
    min: 380,
    max: 490,
    location: ["home"],
    tags: ["night"],
  },
  {
    category: "exercise",
    titles: [
      ["Morning run", "5k along the river, felt strong"],
      ["Strength training", "Upper body — bench, rows, pull-ups"],
      ["Yoga", "30 min flow before breakfast"],
      ["Evening walk", "Loop around the park"],
      ["Cycling", "Commute plus a detour"],
    ],
    start: 7 * 60,
    jitter: 40,
    min: 25,
    max: 75,
    intensity: ["moderate", "hard", "light"],
    location: ["gym", "outdoors", "home"],
    tags: ["morning", "movement"],
  },
  {
    category: "work",
    titles: [
      ["Deep work block", "No meetings, heads-down on the roadmap"],
      ["Team standup + planning", "Sprint grooming ran long"],
      ["Client calls", "Three back-to-back reviews"],
      ["Writing & review", "Drafted the spec, reviewed two PRs"],
      ["Admin & email", "Cleared the inbox, filed expenses"],
    ],
    start: 9 * 60 + 20,
    jitter: 45,
    min: 90,
    max: 210,
    intensity: ["light", "moderate", "hard"],
    location: ["office", "home"],
    tags: ["focus", "meetings"],
  },
  {
    category: "reading",
    titles: [
      ["Novel before bed", "Two chapters of a slow-burn mystery"],
      ["Long-form articles", "Saved pieces from the week"],
      ["Non-fiction", "Chapter on habit formation"],
      ["Poetry", "A few pages, slowly"],
    ],
    start: 21 * 60 + 20,
    jitter: 50,
    min: 20,
    max: 65,
    intensity: ["light"],
    location: ["home"],
    tags: ["evening", "quiet"],
  },
  {
    category: "learning",
    titles: [
      ["Online course", "Module on data modelling"],
      ["Language practice", "20 min of vocabulary drills"],
      ["Side project", "Rebuilt the parser, learned a lot"],
      ["Podcast + notes", "Episode on systems design"],
    ],
    start: 19 * 60 + 30,
    jitter: 60,
    min: 30,
    max: 90,
    intensity: ["moderate"],
    location: ["home"],
    tags: ["study"],
  },
  {
    category: "social",
    titles: [
      ["Dinner with friends", "Long table, longer conversation"],
      ["Call with family", "Weekly catch-up"],
      ["Coffee with a colleague", "Talked through a tricky project"],
      ["Board games night", "Won one, lost two"],
    ],
    start: 18 * 60 + 40,
    jitter: 70,
    min: 60,
    max: 180,
    intensity: ["light"],
    location: ["home", "other"],
    tags: ["people"],
  },
  {
    category: "chores",
    titles: [
      ["Groceries & errands", "Weekly shop plus the pharmacy"],
      ["Cleaning", "Kitchen deep clean"],
      ["Laundry & tidying", "The usual Sunday reset"],
      ["Meal prep", "Portioned the week's lunches"],
    ],
    start: 10 * 60 + 30,
    jitter: 90,
    min: 30,
    max: 105,
    intensity: ["light", "moderate"],
    location: ["home"],
    tags: ["home"],
  },
  {
    category: "health",
    titles: [
      ["Dentist check-up", "All clear, next visit in six months"],
      ["Physio session", "Shoulder mobility work"],
      ["Meditation", "Ten quiet minutes before work"],
      ["Stretch & mobility", "Hips and hamstrings"],
    ],
    start: 8 * 60 + 10,
    jitter: 60,
    min: 10,
    max: 60,
    intensity: ["light"],
    location: ["home", "other"],
    tags: ["care"],
  },
  {
    category: "cooking",
    titles: [
      ["Dinner from scratch", "Roasted vegetables and lentils"],
      ["Baking", "Sourdough, second attempt"],
      ["Quick lunch", "Whatever was in the fridge"],
    ],
    start: 18 * 60 + 10,
    jitter: 40,
    min: 25,
    max: 80,
    intensity: ["light", "moderate"],
    location: ["home"],
    tags: ["kitchen"],
  },
  {
    category: "commute",
    titles: [
      ["Train to the office", "Standing room, read on the way"],
      ["Cycle in", "Faster than the bus"],
      ["Drive home", "Traffic on the ring road"],
    ],
    start: 8 * 60 + 20,
    jitter: 25,
    min: 20,
    max: 55,
    intensity: ["light"],
    location: ["outdoors", "other"],
    tags: ["travel"],
  },
  {
    category: "creative",
    titles: [
      ["Sketching", "Filled two pages in the notebook"],
      ["Guitar practice", "Worked on the same bar for an hour"],
      ["Writing", "Draft of a short essay"],
    ],
    start: 20 * 60 + 30,
    jitter: 60,
    min: 25,
    max: 80,
    intensity: ["light", "moderate"],
    location: ["home"],
    tags: ["making"],
  },
  {
    category: "screen",
    titles: [
      ["Series episode", "Two episodes, one too many"],
      ["Scrolling", "Lost track of time"],
      ["Film night", "Something old and slow"],
    ],
    start: 21 * 60 + 40,
    jitter: 60,
    min: 30,
    max: 120,
    intensity: ["light"],
    location: ["home"],
    tags: ["evening"],
  },
  {
    category: "outdoors",
    titles: [
      ["Park walk", "Golden hour, almost empty"],
      ["Hike", "Six kilometres, steady climb"],
      ["Garden", "Pruned the roses"],
    ],
    start: 16 * 60 + 30,
    jitter: 90,
    min: 30,
    max: 150,
    intensity: ["light", "moderate", "hard"],
    location: ["outdoors"],
    tags: ["fresh-air"],
  },
  {
    category: "other",
    titles: [
      ["Appointments", "Waited forty minutes"],
      ["Rest & recovery", "Deliberately did nothing"],
      ["Paperwork", "Renewed the insurance"],
    ],
    start: 13 * 60,
    jitter: 120,
    min: 20,
    max: 70,
    intensity: ["light"],
    location: ["home", "other"],
    tags: [],
  },
];

const byCategory = new Map(TEMPLATES.map((t) => [t.category, t]));

/** Probability an entry of this category appears on a given day. */
function chance(category: string, weekend: boolean, r: () => number): boolean {
  switch (category) {
    case "sleep":
      return true;
    case "work":
      return weekend ? r() > 0.82 : true;
    case "exercise":
      return r() > 0.22;
    case "reading":
      return r() > 0.3;
    case "learning":
      return r() > 0.62;
    case "social":
      return weekend ? r() > 0.35 : r() > 0.84;
    case "chores":
      return r() > 0.7;
    case "health":
      return r() > 0.78;
    case "cooking":
      return r() > 0.45;
    case "commute":
      return weekend ? r() > 0.9 : r() > 0.25;
    case "creative":
      return r() > 0.72;
    case "screen":
      return r() > 0.55;
    case "outdoors":
      return weekend ? r() > 0.4 : r() > 0.75;
    default:
      return r() > 0.85;
  }
}

/**
 * Builds ~5 weeks of plausible entries ending today. Weekdays lean on work,
 * weekends on social/chores; exercise and reading appear most days so the
 * streak panel has something real to show. Every entry carries a start time so
 * the time-of-day heatmap is populated on first load.
 */
export function buildSampleActivities(today: DayKey, days = 35, seed = 20261031): SampleActivity[] {
  const r = rng(seed);
  const out: SampleActivity[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;

    for (const t of TEMPLATES) {
      if (!chance(t.category, weekend, r)) continue;

      // Work gets a second block on busy weekdays.
      const blocks = t.category === "work" && !weekend && r() > 0.45 ? 2 : 1;

      for (let b = 0; b < blocks; b++) {
        const [title, note] = pick(r, t.titles);
        const duration = t.min + Math.floor(r() * (t.max - t.min + 1));
        const start = t.start + Math.floor((r() - 0.5) * 2 * t.jitter) + b * 200;

        out.push({
          category: t.category,
          title,
          durationMinutes: duration,
          activityDate: date,
          startTime: clock(start),
          notes: r() > 0.55 ? note : null,
          intensity: t.intensity ? pick(r, t.intensity) : null,
          location: t.location ? pick(r, t.location) : null,
          tags: t.tags && t.tags.length && r() > 0.35 ? t.tags.join(",") : null,
        });
      }
    }
  }

  return out;
}

/** The goals a new account starts with, so the rings are not all empty. */
export function buildSampleGoals(): { category: string; period: string; targetMinutes: number }[] {
  return [
    { category: "exercise", period: "daily", targetMinutes: 45 },
    { category: "reading", period: "daily", targetMinutes: 30 },
    { category: "sleep", period: "daily", targetMinutes: 450 },
    { category: "learning", period: "weekly", targetMinutes: 300 },
    { category: "outdoors", period: "weekly", targetMinutes: 180 },
  ];
}

export { byCategory };
