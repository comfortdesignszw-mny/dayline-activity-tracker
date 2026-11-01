import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { makeCaller } from "./_core/test-caller";
import type { SyncActivity } from "../shared/sync";

// Mock every _core module routers.ts touches (see server/_core/test-caller.ts).
vi.mock("./_core/auth", () => {
  class AuthError extends Error {}
  return {
    authProvider: () => ({ login: vi.fn(), logout: vi.fn(), getSession: vi.fn() }),
    registerLocalUser: vi.fn(),
    AuthError,
    EmailTakenError: class EmailTakenError extends AuthError {},
  };
});

vi.mock("./_core/storage", () => ({
  storageCommit: vi.fn(),
  storageDeleteOwned: vi.fn(),
  storageListByOwner: vi.fn(),
  storagePutUrl: vi.fn(),
  StorageError: class StorageError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("./db", () => ({
  listCategories: vi.fn(),
  listActivities: vi.fn(),
  getActivity: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  countActivities: vi.fn(),
  seedSampleDataIfEmpty: vi.fn(),
  syncPull: vi.fn(),
  syncPushActivities: vi.fn(),
  syncPushGoals: vi.fn(),
}));

const { sanitizeBasename } = await import("./routers");
const q = await import("./db");

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.co", name: "A", role: "user" as const };
const OTHER = { id: "22222222-2222-4222-8222-222222222222", email: "c@d.co", name: "C", role: "user" as const };

const validInput = {
  category: "exercise" as const,
  title: "Morning run",
  durationMinutes: 35,
  activityDate: "2026-10-31",
  notes: "felt good",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sanitizeBasename", () => {
  it("passes a normal filename through unchanged", () => {
    expect(sanitizeBasename("report.pdf")).toBe("report.pdf");
  });

  it("takes only the last path segment, dropping any directory traversal", () => {
    expect(sanitizeBasename("/../report.pdf")).toBe("report.pdf");
    expect(sanitizeBasename("../../etc/passwd")).toBe("passwd");
  });

  it("strips characters outside [A-Za-z0-9._-]", () => {
    expect(sanitizeBasename("my file (final)!.png")).toBe("myfilefinal.png");
  });
});

describe("activities router — auth", () => {
  it("rejects an anonymous caller on every data procedure", async () => {
    const caller = makeCaller({ user: null });
    await expect(caller.activities.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.activities.create(validInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.activities.seedSample()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("activities router — owner scoping", () => {
  it("lists only the caller's rows", async () => {
    vi.mocked(q.listActivities).mockResolvedValue([] as never);
    const caller = makeCaller({ user: USER });
    await caller.activities.list({ from: "2026-10-01", to: "2026-10-31" });
    expect(q.listActivities).toHaveBeenCalledWith(USER.id, {
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("creates with the caller as owner, ignoring any owner in the input", async () => {
    vi.mocked(q.createActivity).mockResolvedValue({ id: "x" } as never);
    const caller = makeCaller({ user: USER });
    await caller.activities.create(validInput);
    expect(q.createActivity).toHaveBeenCalledWith(USER.id, validInput);
  });

  it("updates with the caller as owner", async () => {
    vi.mocked(q.updateActivity).mockResolvedValue({ id: "x" } as never);
    const caller = makeCaller({ user: USER });
    const id = "33333333-3333-4333-8333-333333333333";
    await caller.activities.update({ id, ...validInput });
    expect(q.updateActivity).toHaveBeenCalledWith(id, USER.id, validInput);
  });

  it("404s when the row belongs to someone else", async () => {
    vi.mocked(q.updateActivity).mockResolvedValue(null as never);
    const caller = makeCaller({ user: OTHER });
    await expect(
      caller.activities.update({ id: "33333333-3333-4333-8333-333333333333", ...validInput }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("404s on delete when nothing was removed", async () => {
    vi.mocked(q.deleteActivity).mockResolvedValue({ ok: false } as never);
    const caller = makeCaller({ user: USER });
    await expect(
      caller.activities.remove({ id: "33333333-3333-4333-8333-333333333333" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("activities router — input validation", () => {
  it("rejects an unknown category", async () => {
    const caller = makeCaller({ user: USER });
    await expect(
      caller.activities.create({ ...validInput, category: "napping" as never }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects a zero or negative duration", async () => {
    const caller = makeCaller({ user: USER });
    await expect(
      caller.activities.create({ ...validInput, durationMinutes: 0 }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects a duration beyond 24 hours", async () => {
    const caller = makeCaller({ user: USER });
    await expect(
      caller.activities.create({ ...validInput, durationMinutes: 1441 }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects a malformed date", async () => {
    const caller = makeCaller({ user: USER });
    await expect(
      caller.activities.create({ ...validInput, activityDate: "31/10/2026" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects an empty title", async () => {
    const caller = makeCaller({ user: USER });
    await expect(
      caller.activities.create({ ...validInput, title: "   " }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("activities router — sample seeding", () => {
  it("delegates to the idempotent seeder for the caller", async () => {
    vi.mocked(q.seedSampleDataIfEmpty).mockResolvedValue({ seeded: true, inserted: 120 } as never);
    const caller = makeCaller({ user: USER });
    const res = await caller.activities.seedSample();
    expect(q.seedSampleDataIfEmpty).toHaveBeenCalledWith(USER.id);
    expect(res).toEqual({ seeded: true, inserted: 120 });
  });
});

describe("sync router — auth & scoping", () => {
  const validSyncRow: SyncActivity = {
    id: "44444444-4444-4444-8444-444444444444",
    category: "exercise",
    title: "Run",
    durationMinutes: 30,
    activityDate: "2026-10-31",
    startTime: null,
    notes: null,
    intensity: null,
    location: null,
    tags: null,
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
    deletedAt: null,
  };

  it("rejects an anonymous caller on pull and push", async () => {
    const caller = makeCaller({ user: null });
    await expect(caller.sync.pull()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.sync.push({ activities: [], goals: [] })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("pulls everything for the caller", async () => {
    vi.mocked(q.syncPull).mockResolvedValue({ activities: [], goals: [] } as never);
    const caller = makeCaller({ user: USER });
    await caller.sync.pull();
    expect(q.syncPull).toHaveBeenCalledWith(USER.id);
  });

  it("pushes activities and goals for the caller, ignoring any owner in the input", async () => {
    vi.mocked(q.syncPushActivities).mockResolvedValue([] as never);
    vi.mocked(q.syncPushGoals).mockResolvedValue([] as never);
    const caller = makeCaller({ user: USER });
    await caller.sync.push({ activities: [validSyncRow], goals: [] });
    expect(q.syncPushActivities).toHaveBeenCalledWith(USER.id, [validSyncRow]);
    expect(q.syncPushGoals).toHaveBeenCalledWith(USER.id, []);
  });
});
