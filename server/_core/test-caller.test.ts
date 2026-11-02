// makeCaller exists so a generated app never re-derives how to call its own
// router. Living in _core means the agent imports it and cannot lose it.
import { describe, expect, it, vi } from "vitest";

// makeCaller imports appRouter (../routers), which imports ./auth (needs a real
// env + D1) and the business-layer ../db. Both are mocked below for the same
// reason: neither can run in a unit test.
//
// ../db is deliberately left REAL, unlike ./auth: it is AGENT-OWNED and differs
// per app, so this file can't know its shape ahead of time. What every app's
// ../db actually imports is `./db` — the frozen driver module — for a handle.
// Mocking `./db` (the frozen leaf) instead of `../db` (the per-app business
// layer) means the real ../db module loads for whichever app is overlaid, so
// every export it happens to have exists, and `appRouter` builds against the
// genuine module instead of a stand-in this file would have to keep re-guessing.
//
// `db` below can't be a bare `{}`: an app's ../db may build a query at MODULE
// level, so a stub with no `.select` throws the instant ../db is imported. It is
// instead a REAL drizzle instance over a D1 stub whose `prepare` is never
// called — building a query performs no I/O, so module-level query construction
// loads fine and every OTHER app's ../db (which only touches `db` inside
// function bodies this test never calls) is unaffected either way.
vi.mock("./db", async () => {
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../../drizzle/schema");
  // A D1Database-shaped object that throws if anything actually queries it.
  const d1 = {
    prepare: () => {
      throw new Error("test-caller: no database in unit tests");
    },
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  };
  return { getDb: () => drizzle(d1 as never, { schema }), atomic: vi.fn() };
});

vi.mock("./auth", () => {
  class AuthError extends Error {}
  return {
    authProvider: () => ({ login: vi.fn(), logout: vi.fn(), getSession: vi.fn() }),
    registerLocalUser: vi.fn(),
    AuthError,
    EmailTakenError: class EmailTakenError extends AuthError {},
    accountsEnabled: () => true,
    isUniqueViolation: () => false,
  };
});

const { makeCaller } = await import("./test-caller");

describe("makeCaller", () => {
  it("returns a caller with an anonymous context by default", () => {
    const caller = makeCaller();
    expect(caller).toBeDefined();
  });

  it("lets a test override the current user", () => {
    const caller = makeCaller({ user: { id: "u1" } as never });
    expect(caller).toBeDefined();
  });
});
