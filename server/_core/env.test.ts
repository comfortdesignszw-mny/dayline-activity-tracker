import { describe, expect, it } from "vitest";
import { makeEnv, type Bindings } from "./env";

// env.ts is a pure function of the bindings now — no process.env, no import-time
// throw. That makes it directly testable, which the Postgres version was not.
const d1 = {} as D1Database;

function bindings(over: Partial<Bindings> = {}): Bindings {
  return { DB: d1, ...over };
}

describe("makeEnv", () => {
  it("reads the D1 binding through", () => {
    const env = makeEnv(bindings({ JWT_SECRET: "s" }), false);
    expect(env.db).toBe(d1);
  });

  it("defaults the app slug to dayline", () => {
    expect(makeEnv(bindings({ JWT_SECRET: "s" }), false).appSlug).toBe("dayline");
  });

  it("honours an explicit APP_SLUG", () => {
    expect(makeEnv(bindings({ JWT_SECRET: "s", APP_SLUG: "other" }), false).appSlug).toBe("other");
  });

  it("treats AUTH_PROVIDER=none as no accounts", () => {
    expect(makeEnv(bindings({ JWT_SECRET: "s", AUTH_PROVIDER: "none" }), false).authProvider).toBe(
      "none",
    );
  });

  it("falls back to local for an unknown AUTH_PROVIDER", () => {
    expect(
      makeEnv(bindings({ JWT_SECRET: "s", AUTH_PROVIDER: "sso" }), false).authProvider,
    ).toBe("local");
  });

  // A missing secret in production must be a loud failure: the alternative is
  // signing every session with a value an attacker can read out of the repo.
  it("throws in production when JWT_SECRET is missing", () => {
    expect(() => makeEnv(bindings(), true)).toThrow(/JWT_SECRET/);
  });

  it("uses a dev-only secret outside production, so `wrangler dev` works unconfigured", () => {
    const env = makeEnv(bindings(), false);
    expect(env.jwtSecret).toMatch(/dev-only/);
  });

  it("never uses the dev secret in production", () => {
    const env = makeEnv(bindings({ JWT_SECRET: "real-secret" }), true);
    expect(env.jwtSecret).toBe("real-secret");
    expect(env.jwtSecret).not.toMatch(/dev-only/);
  });
});
