import { describe, expect, it } from "vitest";
import {
  activeDays,
  addDays,
  categoryStreaks,
  computeStreak,
  dayRange,
  formatDuration,
  overallStreak,
  summarizeDay,
  totalsByCategory,
  weeklySeries,
  type ActivityLike,
} from "./analytics";
import { buildSampleActivities } from "./sample-data";

const TODAY = "2026-10-31";

function row(over: Partial<ActivityLike>): ActivityLike {
  return {
    id: Math.random().toString(36).slice(2),
    category: "work",
    title: "x",
    durationMinutes: 30,
    activityDate: TODAY,
    notes: null,
    ...over,
  };
}

describe("date helpers", () => {
  it("adds and subtracts days across month boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("builds an inclusive range ending on the given day", () => {
    const r = dayRange(TODAY, 7);
    expect(r).toHaveLength(7);
    expect(r[0]).toBe("2026-10-25");
    expect(r[6]).toBe(TODAY);
  });
});

describe("formatDuration", () => {
  it("formats minutes, whole hours and mixed", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(95)).toBe("1h 35m");
  });
});

describe("summarizeDay", () => {
  it("totals only the requested day and picks the top category", () => {
    const rows = [
      row({ category: "work", durationMinutes: 120 }),
      row({ category: "exercise", durationMinutes: 45 }),
      row({ category: "work", durationMinutes: 30 }),
      row({ category: "reading", durationMinutes: 60, activityDate: "2026-10-30" }),
    ];
    const s = summarizeDay(rows, TODAY);
    expect(s.totalMinutes).toBe(195);
    expect(s.count).toBe(3);
    expect(s.topCategory).toBe("work");
    expect(s.byCategory.work).toBe(150);
  });

  it("returns nulls for an empty day", () => {
    const s = summarizeDay([], TODAY);
    expect(s.totalMinutes).toBe(0);
    expect(s.count).toBe(0);
    expect(s.topCategory).toBeNull();
  });
});

describe("totalsByCategory", () => {
  it("computes shares that sum to 1 and sorts by minutes", () => {
    const rows = [
      row({ category: "work", durationMinutes: 60 }),
      row({ category: "sleep", durationMinutes: 30 }),
      row({ category: "work", durationMinutes: 30 }),
    ];
    const t = totalsByCategory(rows);
    expect(t[0].category).toBe("work");
    expect(t[0].minutes).toBe(90);
    expect(t[0].count).toBe(2);
    expect(t.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });

  it("returns an empty list rather than dividing by zero", () => {
    expect(totalsByCategory([])).toEqual([]);
  });
});

describe("weeklySeries", () => {
  it("returns one point per day, oldest first, with per-category splits", () => {
    const rows = [
      row({ category: "work", durationMinutes: 60, activityDate: TODAY }),
      row({ category: "exercise", durationMinutes: 30, activityDate: "2026-10-25" }),
    ];
    const w = weeklySeries(rows, TODAY, 7);
    expect(w).toHaveLength(7);
    expect(w[0].date).toBe("2026-10-25");
    expect(w[0].totalMinutes).toBe(30);
    expect(w[6].totalMinutes).toBe(60);
    expect(w[6].byCategory.work).toBe(60);
    expect(w[1].totalMinutes).toBe(0);
  });
});

describe("computeStreak", () => {
  it("counts consecutive days ending today", () => {
    const days = new Set(["2026-10-31", "2026-10-30", "2026-10-29"]);
    const s = computeStreak(days, TODAY);
    expect(s.current).toBe(3);
    expect(s.pendingToday).toBe(false);
  });

  it("keeps the streak alive when today is not logged yet", () => {
    const days = new Set(["2026-10-30", "2026-10-29"]);
    const s = computeStreak(days, TODAY);
    expect(s.current).toBe(2);
    expect(s.pendingToday).toBe(true);
  });

  it("breaks the streak when yesterday is also missing", () => {
    const days = new Set(["2026-10-28", "2026-10-27"]);
    const s = computeStreak(days, TODAY);
    expect(s.current).toBe(0);
  });

  it("reports the longest historical run", () => {
    const days = new Set([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-20",
      "2026-10-31",
    ]);
    const s = computeStreak(days, TODAY);
    expect(s.longest).toBe(4);
    expect(s.current).toBe(1);
  });

  it("handles an empty log", () => {
    const s = computeStreak(new Set(), TODAY);
    expect(s).toMatchObject({ current: 0, longest: 0, lastLogged: null });
  });
});

describe("categoryStreaks / overallStreak / activeDays", () => {
  const rows = [
    row({ category: "exercise", activityDate: "2026-10-31" }),
    row({ category: "exercise", activityDate: "2026-10-30" }),
    row({ category: "reading", activityDate: "2026-10-31" }),
    row({ category: "work", activityDate: "2026-10-28" }),
  ];

  it("ranks categories by current streak", () => {
    const s = categoryStreaks(rows, TODAY);
    expect(s[0].category).toBe("exercise");
    expect(s[0].current).toBe(2);
    expect(s.find((x) => x.category === "reading")?.current).toBe(1);
  });

  it("computes the overall streak across all categories", () => {
    expect(overallStreak(rows, TODAY).current).toBe(2);
  });

  it("counts distinct active days in the window", () => {
    expect(activeDays(rows, TODAY, 7)).toBe(3);
  });
});

describe("buildSampleActivities", () => {
  it("is deterministic for a given seed", () => {
    const a = buildSampleActivities(TODAY, 14, 42);
    const b = buildSampleActivities(TODAY, 14, 42);
    expect(a).toEqual(b);
  });

  it("covers the window, includes sleep every night, and stays in range", () => {
    const rows = buildSampleActivities(TODAY, 21);
    const dates = new Set(rows.map((r) => r.activityDate));
    expect(dates.size).toBe(21);
    expect(dates.has(TODAY)).toBe(true);
    expect(dates.has("2026-10-11")).toBe(true);

    const sleepDays = new Set(rows.filter((r) => r.category === "sleep").map((r) => r.activityDate));
    expect(sleepDays.size).toBe(21);

    for (const r of rows) {
      expect(r.durationMinutes).toBeGreaterThan(0);
      expect(r.durationMinutes).toBeLessThanOrEqual(1440);
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it("produces a populated dashboard: several categories and a live streak", () => {
    const rows: ActivityLike[] = buildSampleActivities(TODAY, 35).map((r, i) => ({
      ...r,
      id: `s${i}`,
    }));
    const cats = new Set(rows.map((r) => r.category));
    expect(cats.size).toBeGreaterThanOrEqual(6);
    expect(overallStreak(rows, TODAY).current).toBeGreaterThan(0);
    expect(summarizeDay(rows, TODAY).count).toBeGreaterThan(0);
  });
});
