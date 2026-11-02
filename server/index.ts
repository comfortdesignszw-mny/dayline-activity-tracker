import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { getDb } from "./_core/db";
import { makeEnv, type Bindings } from "./_core/env";

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Worker entry point.
//
// One Worker serves BOTH the API and the SPA:
//   • /trpc/*        → tRPC (cookie auth, D1)
//   • /api/health    → liveness probe
//   • everything else → the static assets binding (Workers Assets), which
//                       serves the built SPA and falls back to index.html for
//                       client-side routes (configured in wrangler.jsonc)
//
// There is no filesystem and no `process.env` here. Configuration arrives as
// `env` (the bindings), and the D1 handle is built per request — see
// _core/db.ts for why a module-level handle would break under isolate reuse.
// ─────────────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true, runtime: "workers" }));

app.use("/trpc/*", async (c, next) => {
  // `wrangler dev` runs with NODE_ENV unset; production Workers set it to
  // "production". Anything else is treated as development, which only relaxes
  // the JWT_SECRET requirement (see _core/env.ts).
  const isProd = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.NODE_ENV === "production";

  const env = makeEnv(c.env, isProd);
  const db = getDb(env.db);

  return trpcServer({
    router: appRouter,
    createContext: (_opts, hono) => createContext(hono, env, db),
  })(c, next);
});

// Static assets. `run_worker_first` in wrangler.jsonc sends only /trpc and
// /api/* to this Worker; everything else is served by the assets layer before
// the Worker is ever invoked. This handler is the fallback for the case where
// the binding is present but the asset is missing (e.g. a stale deploy).
app.all("*", async (c) => {
  const assets = c.env.ASSETS;
  if (assets) return assets.fetch(c.req.raw);
  return c.text("Not found", 404);
});

export default app;
