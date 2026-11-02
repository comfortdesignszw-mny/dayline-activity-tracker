// Canonical way to call appRouter from a test.
//
// routers.ts pulls in _core/auth, which needs a real `env` (JWT secret) and a
// D1 handle. Neither exists in a unit test, so a caller of makeCaller must mock
// the _core leaves — ./auth and ./db — exactly as routers.test.ts does. Leave
// ../db (the business layer) REAL: its exports differ per app, so a hand-written
// mock of it is only ever correct for the one app it was written against.
//
// ./_core/trpc is left real: it only imports @trpc/server + superjson + a TYPE
// from ./context (erased at build time), so it has no runtime dependency on
// env/db and needs no mock.
import { appRouter } from "../routers";
import type { AppContext } from "./context";

export function makeCaller(overrides: Partial<AppContext> = {}) {
  const base = {
    c: undefined,
    db: undefined,
    env: undefined,
    user: null,
    ...overrides,
  } as unknown as AppContext;
  return appRouter.createCaller(base);
}
