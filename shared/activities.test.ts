import { describe, expect, it } from "vitest";
import { normalizeTags, tagsFromText, tagsToText } from "./activities";

// Regression suite for two bugs found by driving the real UI against D1:
//   1. a pasted "smoke, browser" became ONE tag named "smoke,-browser"
//   2. intensity/location/startTime/tags were dropped by the router's zod
//      schema (covered in server/routers.test.ts)
describe("normalizeTags", () => {
  it("splits a comma-separated string", () => {
    expect(normalizeTags("morning, with-sam")).toEqual(["morning", "with-sam"]);
  });

  // The bug: the tag input hands over an ARRAY whose element still contains a
  // comma, and the old code only split when the input was a bare string.
  it("splits commas inside array elements too", () => {
    expect(normalizeTags(["smoke, browser"])).toEqual(["smoke", "browser"]);
  });

  it("splits a mix of clean and comma-bearing array elements", () => {
    expect(normalizeTags(["a", "b, c", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("lowercases and hyphenates internal whitespace", () => {
    expect(normalizeTags("Early Morning")).toEqual(["early-morning"]);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTags("  spaced  ")).toEqual(["spaced"]);
  });

  it("dedupes, keeping the first occurrence", () => {
    expect(normalizeTags("run, Run, RUN")).toEqual(["run"]);
  });

  it("drops empty entries from stray commas", () => {
    expect(normalizeTags("a,,b, ,c")).toEqual(["a", "b", "c"]);
  });

  it("caps at 8 tags", () => {
    expect(normalizeTags("1,2,3,4,5,6,7,8,9,10")).toHaveLength(8);
  });

  it("caps each tag at 24 characters", () => {
    expect(normalizeTags("x".repeat(40))[0]).toHaveLength(24);
  });

  it("returns an empty list for null/undefined/empty", () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags("")).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });
});

describe("tagsToText / tagsFromText", () => {
  it("round-trips through the stored comma-separated form", () => {
    const text = tagsToText(["morning", "with-sam"]);
    expect(text).toBe("morning,with-sam");
    expect(tagsFromText(text)).toEqual(["morning", "with-sam"]);
  });

  it("stores null rather than an empty string when there are no tags", () => {
    expect(tagsToText([])).toBeNull();
    expect(tagsToText("")).toBeNull();
  });

  it("reads back a legacy malformed value as separate tags", () => {
    // Rows written before the fix hold "smoke,-browser"; reading them must not
    // produce a tag with a leading hyphen.
    expect(tagsFromText("smoke,-browser")).toEqual(["smoke", "-browser"]);
  });
});
