import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import {
  requestIsSecure,
  sessionCookieClearOptions,
  sessionCookieOptions,
} from "./session-cookie";

function ctx(url: string, headers: Record<string, string> = {}): Context {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    req: {
      url,
      header: (name: string) => lower[name.toLowerCase()],
    },
  } as Context;
}

const LOCAL = "http://localhost:8787/trpc/auth.login";
const DEPLOYED = "https://dayline.example.workers.dev";

describe("sessionCookieOptions", () => {
  it("plants CHIPS on HTTPS", () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "None",
      secure: true,
      partitioned: true,
    });
  });

  it("keeps Lax on localhost HTTP", () => {
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "Lax",
      secure: false,
    });
  });
});

describe("sessionCookieClearOptions", () => {
  it("covers CHIPS, unpartitioned None, and both Lax jars", () => {
    expect(sessionCookieClearOptions()).toEqual([
      { path: "/", sameSite: "None", secure: true, partitioned: true },
      { path: "/", sameSite: "None", secure: true },
      { path: "/", sameSite: "Lax", secure: true },
      { path: "/", sameSite: "Lax", secure: false },
    ]);
  });
});

describe("requestIsSecure", () => {
  it("trusts an https request URL", () => {
    expect(requestIsSecure(ctx(DEPLOYED))).toBe(true);
  });

  it("trusts Host / x-forwarded-host on Cloudflare suffixes", () => {
    expect(requestIsSecure(ctx(LOCAL, { host: "dayline.example.workers.dev" }))).toBe(true);
    expect(requestIsSecure(ctx(LOCAL, { "x-forwarded-host": "dayline.pages.dev" }))).toBe(true);
    expect(requestIsSecure(ctx(LOCAL, { host: "dayline.example.workers.dev:443" }))).toBe(true);
  });

  it("does not treat a lookalike host as an app origin", () => {
    expect(requestIsSecure(ctx(LOCAL, { host: "evil.workers.dev.example.com" }))).toBe(false);
    expect(requestIsSecure(ctx(LOCAL, { host: "notworkers.dev" }))).toBe(false);
  });

  it("treats x-forwarded-proto: https as positive", () => {
    expect(requestIsSecure(ctx(LOCAL, { "x-forwarded-proto": "https" }))).toBe(true);
    expect(requestIsSecure(ctx(LOCAL, { "x-forwarded-proto": "https,http" }))).toBe(true);
  });

  it("does not let x-forwarded-proto: http veto a later https Origin", () => {
    expect(
      requestIsSecure(ctx(LOCAL, { "x-forwarded-proto": "http", origin: DEPLOYED })),
    ).toBe(true);
  });

  it("trusts x-forwarded-ssl: on", () => {
    expect(requestIsSecure(ctx(LOCAL, { "x-forwarded-ssl": "on" }))).toBe(true);
  });

  it("trusts https Origin / Referer — the dev-proxy case", () => {
    expect(requestIsSecure(ctx(LOCAL, { origin: DEPLOYED }))).toBe(true);
    expect(requestIsSecure(ctx(LOCAL, { referer: `${DEPLOYED}/login` }))).toBe(true);
  });

  it("stays insecure for a bare localhost request with no https signal", () => {
    expect(requestIsSecure(ctx(LOCAL, { host: "localhost:8787" }))).toBe(false);
  });
});
