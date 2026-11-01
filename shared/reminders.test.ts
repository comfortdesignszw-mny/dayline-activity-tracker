import { describe, expect, it } from "vitest";
import {
  describeCountdown,
  describeDays,
  dueReminders,
  formatReminderTime,
  isReminderDue,
  nextOccurrence,
  parseDays,
  reminderBody,
  reminderMinutes,
  type ReminderLike,
} from "./reminders";

const base: ReminderLike = {
  id: "r1",
  category: "exercise",
  title: "Morning run",
  message: null,
  timeOfDay: "07:30",
  daysOfWeek: "1,2,3,4,5",
  enabled: true,
  lastFiredOn: null,
};

// 2026-10-31 is a Saturday (day 6).
const sat = (h: number, m = 0) => new Date(2026, 9, 31, h, m, 0, 0);
// 2026-10-28 is a Wednesday (day 3).
const wed = (h: number, m = 0) => new Date(2026, 9, 28, h, m, 0, 0);

describe("parseDays / describeDays", () => {
  it("parses, dedupes and sorts a day list", () => {
    expect(parseDays("4,1,1,2")).toEqual([1, 2, 4]);
  });

  it("drops out-of-range and non-numeric values", () => {
    expect(parseDays("0,7,-1,x,6")).toEqual([0, 6]);
  });

  it("returns an empty list for null/empty input", () => {
    expect(parseDays(null)).toEqual([]);
    expect(parseDays("")).toEqual([]);
  });

  it("names the common patterns", () => {
    expect(describeDays("0,1,2,3,4,5,6")).toBe("Every day");
    expect(describeDays("1,2,3,4,5")).toBe("Weekdays");
    expect(describeDays("0,6")).toBe("Weekends");
    expect(describeDays("1,3,5")).toBe("Mon, Wed, Fri");
  });
});

describe("formatReminderTime / reminderMinutes", () => {
  it("formats 24h as a 12h clock", () => {
    expect(formatReminderTime("07:30")).toBe("7:30 am");
    expect(formatReminderTime("20:05")).toBe("8:05 pm");
    expect(formatReminderTime("00:00")).toBe("12:00 am");
    expect(formatReminderTime("12:00")).toBe("12:00 pm");
  });

  it("rejects malformed or out-of-range times", () => {
    expect(formatReminderTime("7:5")).toBeNull();
    expect(formatReminderTime("25:00")).toBeNull();
    expect(formatReminderTime("07:60")).toBeNull();
    expect(reminderMinutes("nope")).toBeNull();
  });

  it("converts to minutes since midnight", () => {
    expect(reminderMinutes("00:00")).toBe(0);
    expect(reminderMinutes("07:30")).toBe(450);
    expect(reminderMinutes("23:59")).toBe(1439);
  });
});

describe("isReminderDue", () => {
  it("is not due before its time", () => {
    expect(isReminderDue(base, wed(7, 29))).toBe(false);
  });

  it("is due at exactly its time", () => {
    expect(isReminderDue(base, wed(7, 30))).toBe(true);
  });

  it("is due later the same day (a missed nudge is not skipped)", () => {
    expect(isReminderDue(base, wed(18, 0))).toBe(true);
  });

  it("is not due on a day it does not run", () => {
    // Saturday is not in Mon–Fri.
    expect(isReminderDue(base, sat(9, 0))).toBe(false);
  });

  it("is not due when disabled", () => {
    expect(isReminderDue({ ...base, enabled: false }, wed(9, 0))).toBe(false);
  });

  it("is not due twice on the same day", () => {
    expect(isReminderDue({ ...base, lastFiredOn: "2026-10-28" }, wed(9, 0))).toBe(false);
  });

  it("is due again the next day", () => {
    // Thursday 2026-10-29, fired on Wednesday.
    expect(isReminderDue({ ...base, lastFiredOn: "2026-10-28" }, new Date(2026, 9, 29, 9, 0))).toBe(
      true,
    );
  });

  it("is not due when the time is unparseable", () => {
    expect(isReminderDue({ ...base, timeOfDay: "later" }, wed(9, 0))).toBe(false);
  });
});

describe("dueReminders", () => {
  it("returns only due reminders, earliest first", () => {
    const list: ReminderLike[] = [
      { ...base, id: "late", timeOfDay: "20:00" },
      { ...base, id: "early", timeOfDay: "06:00" },
      { ...base, id: "future", timeOfDay: "23:00" },
      { ...base, id: "off", enabled: false, timeOfDay: "06:00" },
    ];
    const due = dueReminders(list, wed(12, 0));
    // At noon only the 06:00 reminder has come round; 20:00 is still ahead.
    expect(due.map((r) => r.id)).toEqual(["early"]);

    // By 21:00 both the 06:00 and 20:00 reminders are due, earliest first.
    expect(dueReminders(list, wed(21, 0)).map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("returns an empty list when nothing is due", () => {
    expect(dueReminders([base], sat(12, 0))).toEqual([]);
  });
});

describe("nextOccurrence", () => {
  it("finds later today when the time has not passed", () => {
    const next = nextOccurrence(base, wed(6, 0));
    expect(next?.getDate()).toBe(28);
    expect(next?.getHours()).toBe(7);
  });

  it("rolls to the next matching weekday when today's time has passed", () => {
    // Wednesday 08:00 → next is Thursday 07:30.
    const next = nextOccurrence(base, wed(8, 0));
    expect(next?.getDay()).toBe(4);
    expect(next?.getHours()).toBe(7);
  });

  it("skips the weekend for a weekday reminder", () => {
    // Friday 2026-10-30 09:00 → next is Monday 2026-11-02.
    const next = nextOccurrence(base, new Date(2026, 9, 30, 9, 0));
    expect(next?.getDay()).toBe(1);
    expect(next?.getDate()).toBe(2);
  });

  it("returns null when no days are selected", () => {
    expect(nextOccurrence({ ...base, daysOfWeek: "" }, wed(6, 0))).toBeNull();
  });
});

describe("describeCountdown", () => {
  it("describes minutes, hours and days", () => {
    const now = wed(7, 0);
    expect(describeCountdown(new Date(2026, 9, 28, 7, 8), now)).toBe("in 8m");
    expect(describeCountdown(new Date(2026, 9, 28, 9, 15), now)).toBe("in 2h 15m");
    expect(describeCountdown(new Date(2026, 9, 28, 9, 0), now)).toBe("in 2h");
    expect(describeCountdown(new Date(2026, 9, 30, 9, 0), now)).toBe("in 2d 2h");
  });

  it("says now for a past or present target", () => {
    expect(describeCountdown(wed(6, 0), wed(7, 0))).toBe("now");
  });
});

describe("reminderBody", () => {
  it("prefers the reminder's own message", () => {
    expect(reminderBody({ ...base, message: "  Go!  " }, "Exercise")).toBe("Go!");
  });

  it("falls back to a category-aware nudge", () => {
    expect(reminderBody(base, "Exercise")).toBe(
      "Time for exercise — log it when you're done.",
    );
  });

  it("falls back to a general nudge with no category", () => {
    expect(reminderBody({ ...base, category: null }, null)).toBe(
      "A good moment to log what you've been doing.",
    );
  });
});
