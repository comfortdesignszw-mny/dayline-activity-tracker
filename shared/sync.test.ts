import { describe, expect, it } from "vitest";
import { isLive, isNewer, mergeById, mergeGoalsByCategory, mergeRow } from "./sync";
import type { SyncGoal } from "./sync";

const row = (id: string, updatedAt: string, deletedAt: string | null = null) => ({
  id,
  updatedAt,
  deletedAt,
});

describe("isNewer", () => {
  it("orders timestamps correctly", () => {
    expect(isNewer("2026-10-31T10:00:00.000Z", "2026-10-30T10:00:00.000Z")).toBe(true);
    expect(isNewer("2026-10-30T10:00:00.000Z", "2026-10-31T10:00:00.000Z")).toBe(false);
  });

  it("breaks equal timestamps deterministically by string", () => {
    expect(isNewer("2026-10-31T10:00:00.000Z", "2026-10-31T10:00:00.000Z")).toBe(false);
  });

  it("treats an unparseable incoming timestamp as older", () => {
    expect(isNewer("not-a-date", "2026-10-31T10:00:00.000Z")).toBe(false);
    expect(isNewer("2026-10-31T10:00:00.000Z", "not-a-date")).toBe(true);
  });
});

describe("mergeRow — last-write-wins", () => {
  it("keeps the newer of two live rows", () => {
    const local = row("a", "2026-10-30T10:00:00.000Z");
    const remote = row("a", "2026-10-31T10:00:00.000Z");
    expect(mergeRow(local, remote)).toBe(remote);
  });

  it("a tombstone wins over a live row of equal-or-older timestamp", () => {
    const local = row("a", "2026-10-30T10:00:00.000Z"); // live, older
    const remote = row("a", "2026-10-31T10:00:00.000Z", "2026-10-31T10:00:00.000Z"); // deleted
    expect(mergeRow(local, remote)).toBe(remote);
  });

  it("a strictly newer local edit beats a stale remote tombstone", () => {
    const local = row("a", "2026-10-31T12:00:00.000Z"); // live, newer than the delete
    const remote = row("a", "2026-10-31T10:00:00.000Z", "2026-10-31T10:00:00.000Z"); // deleted
    expect(mergeRow(local, remote)).toBe(local);
  });

  it("two tombstones keep the newer one", () => {
    const local = row("a", "2026-10-30T10:00:00.000Z", "2026-10-30T10:00:00.000Z");
    const remote = row("a", "2026-10-31T10:00:00.000Z", "2026-10-31T10:00:00.000Z");
    expect(mergeRow(local, remote)).toBe(remote);
  });
});

describe("mergeById", () => {
  it("merges disjoint id sets without dropping rows", () => {
    const local = [row("a", "2026-10-30T00:00:00.000Z")];
    const remote = [row("b", "2026-10-31T00:00:00.000Z")];
    const merged = mergeById(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("reconciles the same id by LWW", () => {
    const local = [row("a", "2026-10-31T10:00:00.000Z")];
    const remote = [row("a", "2026-10-30T10:00:00.000Z")];
    const merged = mergeById(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].updatedAt).toBe("2026-10-31T10:00:00.000Z");
  });
});

describe("isLive", () => {
  it("distinguishes tombstones from live rows", () => {
    expect(isLive(row("a", "x"))).toBe(true);
    expect(isLive(row("a", "x", "x"))).toBe(false);
  });
});

describe("mergeGoalsByCategory", () => {
  const goal = (category: SyncGoal["category"], id: string, updatedAt: string, deletedAt: string | null = null): SyncGoal => ({
    id,
    category,
    period: "daily",
    targetMinutes: 30,
    createdAt: updatedAt,
    updatedAt,
    deletedAt,
  });

  it("treats two goals for the same category as one row, keeping the newer", () => {
    const local = [goal("exercise", "id-a", "2026-10-31T10:00:00.000Z")];
    const remote = [goal("exercise", "id-b", "2026-10-30T10:00:00.000Z")];
    const merged = mergeGoalsByCategory(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("id-a");
  });

  it("keeps goals for distinct categories separate", () => {
    const local = [goal("exercise", "a", "2026-10-31T00:00:00.000Z")];
    const remote = [goal("reading", "b", "2026-10-31T00:00:00.000Z")];
    const merged = mergeGoalsByCategory(local, remote);
    expect(merged).toHaveLength(2);
  });
});
