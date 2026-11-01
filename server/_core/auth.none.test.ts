import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";

// env.ts calls required("DATABASE_URL")/required("JWT_SECRET") at load and db.ts
// opens a real driver, so both are mocked. load() stubs AUTH_PROVIDER, resets
// modules and re-registers the env mock so each call sees the chosen mode.
const insertSpy = vi.fn();
vi.mock("./db", () => ({
  db: {
    insert: () => {
      insertSpy();
      return { values: () => ({ returning: async () => [] }) };
    },
  },
}));

const fakeCtx = {} as Context;

async function load(provider?: string) {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (provider !== undefined) vi.stubEnv("AUTH_PROVIDER", provider);
  else delete process.env.AUTH_PROVIDER;
  vi.doMock("./env", () => ({
    env: {
      jwtSecret: "test-secret",
      appSlug: "test",
      isProd: false,
      authProvider: process.env.AUTH_PROVIDER ?? "local",
    },
  }));
  return import("./auth");
}

beforeEach(() => {
  insertSpy.mockClear();
});

describe("none auth mode", () => {
  it("getSession is always null in none mode", async () => {
    const { authProvider } = await load("none");
    expect(await authProvider().getSession(fakeCtx)).toBeNull();
  });

  it("login refuses with FORBIDDEN in none mode", async () => {
    const { authProvider } = await load("none");
    await expect(authProvider().login(fakeCtx, "a@b.co", "x".repeat(8))).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This app does not have user accounts.",
    });
  });

  it("registerLocalUser refuses in none mode and inserts nothing", async () => {
    const { registerLocalUser } = await load("none");
    await expect(registerLocalUser("a@b.co", "x".repeat(8))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("accountsEnabled follows AUTH_PROVIDER", async () => {
    expect((await load("none")).accountsEnabled()).toBe(false);
    expect((await load("local")).accountsEnabled()).toBe(true);
    expect((await load()).accountsEnabled()).toBe(true);
  });

  it("an unknown AUTH_PROVIDER still behaves as local", async () => {
    const { authProvider, accountsEnabled } = await load("nonee");
    expect(accountsEnabled()).toBe(true);
    // LocalAuthProvider: no cookie means anonymous, without throwing FORBIDDEN.
    const ctx = { req: { header: () => undefined, raw: { headers: new Headers() } } } as unknown as Context;
    expect(await authProvider().getSession(ctx)).toBeNull();
    await expect(authProvider().login(ctx, "a@b.co", "x".repeat(8))).rejects.not.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
