import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  activitiesToCsv,
  buildReport,
  csvField,
  csvFilename,
  daysBetween,
  reportFilename,
  reportHeadline,
} from "./export";
import type { ActivityLike } from "./analytics";

const row = (over: Partial<ActivityLike> = {}): ActivityLike => ({
  id: "a1",
  category: "exercise",
  title: "Run",
  durationMinutes: 45,
  activityDate: "2026-10-28",
  startTime: "07:00",
  notes: null,
  intensity: "moderate",
  location: "outdoors",
  tags: "cardio morning",
  ...over,
});

describe("csvField", () => {
  it("leaves a plain value alone", () => {
    expect(csvField("Run")).toBe("Run");
  });

  it("quotes a value containing a comma", () => {
    expect(csvField("Run, then stretch")).toBe('"Run, then stretch"');
  });

  it("doubles embedded quotes", () => {
    expect(csvField('He said "go"')).toBe('"He said ""go"""');
  });

  it("quotes newlines so a row cannot break", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders null and undefined as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("activitiesToCsv", () => {
  it("starts with a BOM and the full header", () => {
    const csv = activitiesToCsv([]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(CSV_COLUMNS.join(","));
  });

  it("writes one row per activity with every field", () => {
    const csv = activitiesToCsv([row()]);
    const lines = csv.replace("\uFEFF", "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      "2026-10-28,07:00,exercise,Exercise,Run,45,0.75,moderate,outdoors,cardio-morning,",
    );
  });

  it("escapes a note containing a comma and a quote", () => {
    const csv = activitiesToCsv([row({ notes: 'Felt "great", honestly' })]);
    expect(csv).toContain('"Felt ""great"", honestly"');
  });

  it("uses CRLF line endings", () => {
    const csv = activitiesToCsv([row(), row({ id: "a2" })]);
    expect(csv.split("\r\n")).toHaveLength(4); // header + 2 rows + trailing
  });

  it("leaves optional fields empty rather than writing 'null'", () => {
    const csv = activitiesToCsv([
      row({ startTime: null, notes: null, intensity: null, location: null, tags: null }),
    ]);
    expect(csv).not.toContain("null");
  });
});

describe("csvFilename", () => {
  it("names the range", () => {
    expect(csvFilename("2026-10-01", "2026-10-31")).toBe(
      "dayline-activities-2026-10-01-to-2026-10-31.csv",
    );
  });
});

describe("daysBetween", () => {
  it("counts inclusively across a month boundary", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-31")).toBe(0);
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
  });
});

describe("buildReport", () => {
  const rows: ActivityLike[] = [
    row({ id: "1", activityDate: "2026-10-26", durationMinutes: 60 }),
    row({ id: "2", activityDate: "2026-10-27", durationMinutes: 30, category: "reading" }),
    row({ id: "3", activityDate: "2026-10-31", durationMinutes: 90, category: "work" }),
    // Outside the week — must not be counted.
    row({ id: "4", activityDate: "2026-10-20", durationMinutes: 500 }),
  ];

  it("covers Monday to today for a week", () => {
    const r = buildReport(rows, [], "2026-10-31", "week");
    expect(r.from).toBe("2026-10-26");
    expect(r.to).toBe("2026-10-31");
    expect(r.dayCount).toBe(6);
  });

  it("covers the 1st to today for a month", () => {
    const r = buildReport(rows, [], "2026-10-31", "month");
    expect(r.from).toBe("2026-10-01");
    expect(r.dayCount).toBe(31);
  });

  it("excludes rows outside the period", () => {
    const r = buildReport(rows, [], "2026-10-31", "week");
    expect(r.entryCount).toBe(3);
    expect(r.totalMinutes).toBe(180);
  });

  it("averages over every day in the period, not just active ones", () => {
    const r = buildReport(rows, [], "2026-10-31", "week");
    expect(r.dailyAverageMinutes).toBe(30); // 180 / 6
    expect(r.activeDays).toBe(3);
  });

  it("orders categories by time and computes shares", () => {
    const r = buildReport(rows, [], "2026-10-31", "week");
    expect(r.categories[0].category).toBe("work");
    expect(r.categories[0].minutes).toBe(90);
    expect(r.categories[0].share).toBeCloseTo(0.5, 5);
  });

  it("emits one day line per day in the period", () => {
    const r = buildReport(rows, [], "2026-10-31", "week");
    expect(r.days).toHaveLength(6);
    expect(r.days[0].date).toBe("2026-10-26");
    expect(r.days[0].totalMinutes).toBe(60);
  });

  it("sorts entries by date then start time", () => {
    const r = buildReport(rows, [], "2026-10-31", "week");
    expect(r.entries.map((e) => e.id)).toEqual(["1", "2", "3"]);
  });

  it("handles an empty period without dividing by zero", () => {
    const r = buildReport([], [], "2026-10-31", "week");
    expect(r.totalMinutes).toBe(0);
    expect(r.dailyAverageMinutes).toBe(0);
    expect(r.topCategory).toBeNull();
    expect(r.categories).toEqual([]);
  });

  it("carries goal progress into the report", () => {
    const r = buildReport(
      rows,
      [{ category: "work", period: "weekly", targetMinutes: 300 }],
      "2026-10-31",
      "week",
    );
    expect(r.goals).toHaveLength(1);
    expect(r.goals[0].actual).toBe(90);
    expect(r.goals[0].met).toBe(false);
  });
});

describe("reportFilename / reportHeadline", () => {
  it("names the file by period and end date", () => {
    const r = buildReport([], [], "2026-10-31", "week");
    expect(reportFilename(r)).toBe("dayline-weekly-report-2026-10-31.pdf");
  });

  it("summarises an empty period honestly", () => {
    const r = buildReport([], [], "2026-10-31", "week");
    expect(reportHeadline(r)).toBe("No entries in this period.");
  });

  it("names the top category in the headline", () => {
    const r = buildReport([row({ durationMinutes: 60 })], [], "2026-10-31", "week");
    expect(reportHeadline(r)).toContain("Exercise");
  });
});
