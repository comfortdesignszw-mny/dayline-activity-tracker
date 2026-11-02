import { beforeEach, describe, expect, it } from "vitest";

// auth.ts takes `env` and `db` as ARGUMENTS now (Workers have no module-level
// process.env or connection), so nothing needs mocking at import time — the
// tests pass a fake env and a fake D1-backed db directly. That is a real
// improvement over the Postgres version, where env.ts threw at import.
const insert: { throws?: unknown; values?: Record<string, unknown> } = {};

const fakeDb = {
  insert: () => ({
    values(v: Record<string, unknown>) {
      insert.values = v;
      return {
        async returning() {
          if (insert.throws) throw insert.throws;
          return [{ id: "u_1", email: v.email, name: v.name, role: "user" }];
        },
      };
    },
  }),
} as never;

const ENV = { jwtSecret: "test-secret", appSlug: "test", isProd: false, authProvider: "local" } as never;

const { registerLocalUser, EmailTakenError, AuthError, hashPassword, verifyPassword, isUniqueViolation } =
  await import("./auth");

/** What D1 actually throws on a second registration. */
function duplicateEmailError() {
  return Object.assign(new Error("UNIQUE constraint failed: users.email"), {
    code: "SQLITE_CONSTRAINT_UNIQUE",
  });
}

beforeEach(() => {
  insert.throws = undefined;
  insert.values = undefined;
});

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const stored = await hashPassword("hunter2hunter2");
    expect(await verifyPassword("hunter2hunter2", stored)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("hunter2hunter2");
    expect(await verifyPassword("hunter2hunter3", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("stores a self-describing format, so the iteration count can be raised later", async () => {
    const stored = await hashPassword("x");
    expect(stored).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it("never stores the password in the clear", async () => {
    const stored = await hashPassword("hunter2hunter2");
    expect(stored).not.toContain("hunter2hunter2");
  });

  it("returns false for a malformed or missing hash instead of throwing", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2$abc$zz$zz")).toBe(false);
  });
});

describe("registerLocalUser", () => {
  it("rejects a second signup on the same email with EmailTakenError", async () => {
    insert.throws = duplicateEmailError();

    await expect(
      registerLocalUser(ENV, fakeDb, "asce1885@gmail.com", "hunter2hunter2", "asce"),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  // The user-visible half of the bug: the thrown message is what the signup
  // form prints, and a raw 500 printed the INSERT statement plus every bound
  // param — the password hash included — into the page.
  it("says the email is taken without quoting the query or the password hash", async () => {
    insert.throws = duplicateEmailError();

    const err = await registerLocalUser(ENV, fakeDb, "asce1885@gmail.com", "hunter2hunter2", "asce").then(
      () => new Error("expected registerLocalUser to reject"),
      (e: Error) => e,
    );

    expect(err.message).toMatch(/already registered/i);
    expect(err.message).not.toMatch(/insert into|Failed query|params:|pbkdf2\$/);
  });

  it("stays an AuthError, so callers that only know that type still catch it", async () => {
    insert.throws = duplicateEmailError();

    await expect(
      registerLocalUser(ENV, fakeDb, "a@b.co", "hunter2hunter2"),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("lets any other write failure through untouched", async () => {
    const outage = new Error("D1_ERROR: network connection lost");
    insert.throws = outage;

    await expect(registerLocalUser(ENV, fakeDb, "a@b.co", "hunter2hunter2")).rejects.toBe(outage);
  });

  it("lowercases the email before storing it", async () => {
    await registerLocalUser(ENV, fakeDb, "Mixed@Case.CO", "hunter2hunter2");
    expect(insert.values?.email).toBe("mixed@case.co");
  });

  it("stores a hash, never the password", async () => {
    await registerLocalUser(ENV, fakeDb, "a@b.co", "hunter2hunter2");
    expect(String(insert.values?.passwordHash)).toMatch(/^pbkdf2\$/);
    expect(String(insert.values?.passwordHash)).not.toContain("hunter2hunter2");
  });
});

describe("isUniqueViolation", () => {
  it("recognises D1's UNIQUE constraint error", () => {
    expect(isUniqueViolation(duplicateEmailError())).toBe(true);
  });

  it("recognises it through a wrapper's cause chain", () => {
    const wrapped = Object.assign(new Error("query failed"), { cause: duplicateEmailError() });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("matches a named constraint when one is given", () => {
    expect(isUniqueViolation(duplicateEmailError(), "users.email")).toBe(true);
    expect(isUniqueViolation(duplicateEmailError(), "goals.owner_id")).toBe(false);
  });

  it("is false for an unrelated failure", () => {
    expect(isUniqueViolation(new Error("network connection lost"))).toBe(false);
  });
});
