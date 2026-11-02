import type { Context as HonoContext } from "hono";
import type { AppDB } from "./db";
import type { Env } from "./env";
import { authProvider } from "./auth";

// tRPC request context. Carries the Hono context (for cookie writes in auth
// mutations), the per-request D1 handle, the resolved env, and the user
// (null if anonymous).
//
// WHY `appEnv` AND NOT `env`: @hono/trpc-server builds the context as
//   { ...(await createContext(opts, c)), env: c.env }
// — it spreads the RAW bindings over our result under the key `env`. A field
// named `env` here is therefore silently replaced by `{ DB, JWT_SECRET, … }`,
// and `ctx.env.jwtSecret` reads undefined. Naming it `appEnv` keeps the typed
// config intact.
export async function createContext(c: HonoContext, env: Env, db: AppDB) {
  const user = await authProvider(env).getSession(c, env, db);
  return { c, db, appEnv: env, user };
}

export type AppContext = Awaited<ReturnType<typeof createContext>>;
