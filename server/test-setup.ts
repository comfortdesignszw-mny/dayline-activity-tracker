// Test bootstrap: `_core/env.ts` throws at import time when a required var is
// missing, and `server/routers.ts` transitively imports it. Tests never open a
// real connection (the db layer is mocked), so a placeholder URL is enough.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET ??= "test-secret-not-used-in-tests";
