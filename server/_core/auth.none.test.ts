import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";

// auth.ts takes env + db as arguments, so each case just builds the env it
// wants. No module mocking, no process.env stubbing.
const insertSpy = vi.fn();
const fakeDb = {
  insert: () => {
    insertSpy();
    return { values: () => ({ returning: async () => [] }) };
  },
} as never;

const fakeCtx = {} as Context;

function envFor(provider: string) {
  return { jwtSecret: "test-secret", appSlug: "test", isProd: false, authProvider: provider } as never;
}

const { authProvider, accountsEnabled, registerLocalUser } = await import("./auth");

describe("none auth mode", () => {
  it("getSession is always null in none mode", async () => {
    expect(await authProvider(envFor("none")).getSession(fakeCtx, envFor("none"), fakeDb)).toBeNull();
  });

  it("login refuses with FORBIDDEN in none mode", async () => {
    const env = envFor("none");
    await expect(
      authProvider(env).login(fakeCtx, env, fakeDb, "a@b.co", "x".repeat(8)),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This app does not have user accounts.",
    });
  });

  it("registerLocalUser refuses in none mode and inserts nothing", async () => {
    insertSpy.mockClear();
    await expect(
      registerLocalUser(envFor("none"), fakeDb, "a@b.co", "x".repeat(8)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("accountsEnabled follows AUTH_PROVIDER", () => {
    expect(accountsEnabled(envFor("none"))).toBe(false);
    expect(accountsEnabled(envFor("local"))).toBe(true);
  });

  it("an unknown AUTH_PROVIDER still behaves as local", async () => {
    const env = envFor("nonee");
    expect(accountsEnabled(env)).toBe(true);
    // LocalAuthProvider: no cookie means anonymous, without throwing FORBIDDEN.
    const ctx = {
      req: { header: () => undefined, raw: { headers: new Headers() } },
    } as unknown as Context;
    expect(await authProvider(env).getSession(ctx, env, fakeDb)).toBeNull();
    await expect(
      authProvider(env).login(ctx, env, fakeDb, "a@b.co", "x".repeat(8)),
    ).rejects.not.toMatchObject({ code: "FORBIDDEN" });
  });
});
