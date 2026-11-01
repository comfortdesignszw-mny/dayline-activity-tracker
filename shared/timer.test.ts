import { describe, expect, it } from "vitest";
import {
  cappedTimerMinutes,
  clockOf,
  dayKeyOf,
  elapsedSeconds,
  formatStopwatch,
  timerMinutes,
} from "./timer";

describe("elapsedSeconds", () => {
  it("counts whole seconds between the start and now", () => {
    const start = new Date(2026, 9, 31, 10, 0, 0);
    const now = new Date(2026, 9, 31, 10, 1, 30);
    expect(elapsedSeconds(start, now)).toBe(90);
  });

  it("accepts an ISO string, which is what the API returns", () => {
    const start = "2026-10-31T08:00:00.000Z";
    const now = new Date(Date.parse(start) + 45_000);
    expect(elapsedSeconds(start, now)).toBe(45);
  });

  it("never goes negative when the clock is behind the start", () => {
    const start = new Date(2026, 9, 31, 10, 0, 0);
    const now = new Date(2026, 9, 31, 9, 59, 0);
    expect(elapsedSeconds(start, now)).toBe(0);
  });

  it("returns 0 for an unparseable start", () => {
    expect(elapsedSeconds("not a date", new Date())).toBe(0);
  });
});

describe("formatStopwatch", () => {
  it("pads every field to two digits", () => {
    expect(formatStopwatch(0)).toBe("00:00:00");
    expect(formatStopwatch(9)).toBe("00:00:09");
    expect(formatStopwatch(90)).toBe("00:01:30");
    expect(formatStopwatch(3661)).toBe("01:01:01");
  });

  it("keeps counting past 24 hours rather than wrapping", () => {
    expect(formatStopwatch(90_000)).toBe("25:00:00");
  });

  it("floors fractional seconds and clamps negatives", () => {
    expect(formatStopwatch(59.9)).toBe("00:00:59");
    expect(formatStopwatch(-5)).toBe("00:00:00");
  });
});

describe("timerMinutes", () => {
  it("rounds to the nearest minute", () => {
    expect(timerMinutes(89)).toBe(1);
    expect(timerMinutes(90)).toBe(2);
    expect(timerMinutes(150)).toBe(3);
  });

  it("never returns 0 — a short timer is still a real entry", () => {
    expect(timerMinutes(0)).toBe(1);
    expect(timerMinutes(5)).toBe(1);
  });
});

describe("cappedTimerMinutes", () => {
  it("passes a normal duration through", () => {
    expect(cappedTimerMinutes(3600)).toEqual({ minutes: 60, capped: false });
  });

  it("caps at 24 hours and reports it", () => {
    expect(cappedTimerMinutes(90_000)).toEqual({ minutes: 1440, capped: true });
  });

  it("does not flag exactly 24 hours", () => {
    expect(cappedTimerMinutes(86_400)).toEqual({ minutes: 1440, capped: false });
  });
});

describe("clockOf / dayKeyOf", () => {
  it("formats local wall-clock time", () => {
    expect(clockOf(new Date(2026, 9, 31, 7, 5))).toBe("07:05");
    expect(clockOf(new Date(2026, 9, 31, 23, 59))).toBe("23:59");
  });

  it("formats a local day key", () => {
    expect(dayKeyOf(new Date(2026, 0, 2, 12, 0))).toBe("2026-01-02");
  });
});
