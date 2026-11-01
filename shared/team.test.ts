import { describe, expect, it } from "vitest";
import {
  buildTeamRollup,
  canManageTeam,
  contributesToTeam,
  initials,
  isTeamRole,
} from "./team";
import type { ActivityLike } from "./analytics";

const row = (over: Partial<ActivityLike> = {}): ActivityLike => ({
  id: "a1",
  category: "exercise",
  title: "Run",
  durationMinutes: 30,
  activityDate: "2026-10-28",
  startTime: "07:00",
  notes: null,
  intensity: null,
  location: null,
  tags: null,
  ...over,
});

const members = [
  { userId: "u1", name: "Alex", email: "alex@x.co", role: "owner" as const },
  { userId: "u2", name: "Sam", email: "sam@x.co", role: "member" as const },
  { userId: "u3", name: "Robin", email: "robin@x.co", role: "viewer" as const },
];

describe("role rules", () => {
  it("recognises the three roles", () => {
    expect(isTeamRole("owner")).toBe(true);
    expect(isTeamRole("member")).toBe(true);
    expect(isTeamRole("viewer")).toBe(true);
    expect(isTeamRole("admin")).toBe(false);
  });

  it("lets only the owner manage the team", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("member")).toBe(false);
    expect(canManageTeam("viewer")).toBe(false);
    expect(canManageTeam(null)).toBe(false);
  });

  it("excludes viewers from the roll-up", () => {
    expect(contributesToTeam("owner")).toBe(true);
    expect(contributesToTeam("member")).toBe(true);
    expect(contributesToTeam("viewer")).toBe(false);
  });
});

describe("buildTeamRollup", () => {
  const rowsByUser = new Map<string, ActivityLike[]>([
    [
      "u1",
      [
        row({ id: "1", durationMinutes: 60, category: "work" }),
        row({ id: "2", durationMinutes: 30, category: "exercise" }),
      ],
    ],
    ["u2", [row({ id: "3", durationMinutes: 45, category: "work" })]],
    // A viewer's rows must never be counted, even if they were passed in.
    ["u3", [row({ id: "4", durationMinutes: 999, category: "work" })]],
  ]);

  it("sums only contributing members", () => {
    const r = buildTeamRollup(members, rowsByUser, "2026-10-31");
    expect(r.totalMinutes).toBe(135);
    expect(r.entryCount).toBe(3);
  });

  it("reports how many members were excluded", () => {
    const r = buildTeamRollup(members, rowsByUser, "2026-10-31");
    expect(r.excludedCount).toBe(1);
  });

  it("combines categories across members", () => {
    const r = buildTeamRollup(members, rowsByUser, "2026-10-31");
    const work = r.byCategory.find((c) => c.category === "work");
    expect(work?.minutes).toBe(105);
    expect(work?.share).toBeCloseTo(105 / 135, 5);
  });

  it("sorts members by total, descending", () => {
    const r = buildTeamRollup(members, rowsByUser, "2026-10-31");
    expect(r.members.map((m) => m.userId)).toEqual(["u1", "u2", "u3"]);
  });

  it("gives each member their own totals and top category", () => {
    const r = buildTeamRollup(members, rowsByUser, "2026-10-31");
    const alex = r.members.find((m) => m.userId === "u1")!;
    expect(alex.totalMinutes).toBe(90);
    expect(alex.topCategory).toBe("work");
    expect(alex.activeDays).toBe(1);
  });

  it("uses the Monday–Sunday week ending today", () => {
    const r = buildTeamRollup(members, rowsByUser, "2026-10-31");
    expect(r.from).toBe("2026-10-26");
    expect(r.to).toBe("2026-10-31");
  });

  it("ignores rows outside the week", () => {
    const old = new Map<string, ActivityLike[]>([
      ["u1", [row({ activityDate: "2026-09-01", durationMinutes: 500 })]],
    ]);
    const r = buildTeamRollup([members[0]], old, "2026-10-31");
    expect(r.totalMinutes).toBe(0);
  });

  it("handles a team with no activity", () => {
    const r = buildTeamRollup(members, new Map(), "2026-10-31");
    expect(r.totalMinutes).toBe(0);
    expect(r.byCategory).toEqual([]);
    expect(r.members).toHaveLength(3);
  });

  it("does not divide by zero when the total is 0", () => {
    const r = buildTeamRollup(members, new Map(), "2026-10-31");
    expect(r.byCategory).toEqual([]);
  });
});

describe("initials", () => {
  it("takes the first and last initial", () => {
    expect(initials("Alex Rivera", "a@x.co")).toBe("AR");
  });

  it("handles a single name", () => {
    expect(initials("Alex", "a@x.co")).toBe("AL");
  });

  it("falls back to the email local part", () => {
    expect(initials("", "sam.smith@x.co")).toBe("SS");
  });

  it("never returns an empty string", () => {
    expect(initials("", "")).toBe("?");
  });
});
