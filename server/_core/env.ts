// Worker bindings + validated config.
//
// On Cloudflare there is no `process.env`: configuration arrives as the second
// argument to `fetch(request, env, ctx)`. This module turns that bag into a
// typed object once per request, so business code never reaches into a raw
// binding and never has to care whether it is running under `wrangler dev`
// (local D1, `.dev.vars`) or in production (real D1, Worker secrets).

/** The bindings declared in wrangler.jsonc. */
export interface Bindings {
  /** D1 database binding. */
  DB: D1Database;
  /** Static-asset binding (Workers Assets). */
  ASSETS?: Fetcher;
  /** HS256 signing key for session JWTs. Set with `wrangler secret put`. */
  JWT_SECRET?: string;
  /** Cookie-name suffix, so two apps on one host cannot clobber each other. */
  APP_SLUG?: string;
  /** 'local' (email + password) | 'none' (no accounts). */
  AUTH_PROVIDER?: string;
  /** Optional override for the client's API base (see client/src/_core/trpc.ts). */
  API_BASE_URL?: string;
}

export interface Env {
  db: D1Database;
  assets?: Fetcher;
  jwtSecret: string;
  appSlug: string;
  authProvider: "local" | "none";
  isProd: boolean;
}

/**
 * Build the typed env for one request.
 *
 * `JWT_SECRET` is required in production and defaulted in development: a
 * missing secret in prod must be a loud failure, because the alternative is
 * signing every session with a value an attacker can read out of the repo.
 */
export function makeEnv(bindings: Bindings, isProd: boolean): Env {
  const secret = bindings.JWT_SECRET;
  if (!secret) {
    if (isProd) {
      throw new Error(
        "JWT_SECRET is not set. Run: wrangler secret put JWT_SECRET",
      );
    }
    // Dev only. Never reached in production because of the throw above.
    return {
      db: bindings.DB,
      assets: bindings.ASSETS,
      jwtSecret: "dev-only-insecure-secret-do-not-deploy",
      appSlug: bindings.APP_SLUG ?? "dayline",
      authProvider: bindings.AUTH_PROVIDER === "none" ? "none" : "local",
      isProd,
    };
  }
  return {
    db: bindings.DB,
    assets: bindings.ASSETS,
    jwtSecret: secret,
    appSlug: bindings.APP_SLUG ?? "dayline",
    authProvider: bindings.AUTH_PROVIDER === "none" ? "none" : "local",
    isProd,
  };
}
