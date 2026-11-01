import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Dev model (DESIGN §5.1 / M1): Vite serves the SPA on PORT (default 3000) with
// native HMR; API calls to /trpc and /app-storage are proxied to the Hono API
// process (dev:api on API_PORT, default 3001). In prod there is NO Vite — the
// single Hono process (dist/index.js) serves the built client from dist/public
// AND the API. Keeping runtime fs to that one prod shim (server/_core/serve.ts)
// is what keeps the template edge-portable (§5.7.3).
//
// base: '/' — the template ASSUMES a per-app origin at the root path. It does
// NOT support being mounted under a shared-host path prefix (DESIGN §5.1 / #13).
const WEB_PORT = Number(process.env.PORT ?? 3000);
const API_PORT = Number(process.env.API_PORT ?? 3001);
const apiProxy = { target: `http://localhost:${API_PORT}`, changeOrigin: true };

// One React instance, guaranteed.
//
// Vite 8's rolldown dep optimizer emits `import ... from "./react.js"` inside a
// pre-bundled chunk, while app code is served `react.js?v=<hash>`. The browser
// treats those as two different modules, so ReactSharedInternals is null in one
// of them and every hook throws "Cannot read properties of null (reading
// 'useState')". Excluding React (and everything that imports it) from
// optimization makes every consumer resolve the same raw file through the
// aliases below — one module, one instance.
const REACT_ENTRY = path.resolve(import.meta.dirname, "node_modules/react/index.js");
const REACT_DOM_ENTRY = path.resolve(import.meta.dirname, "node_modules/react-dom/index.js");
const REACT_DOM_CLIENT_ENTRY = path.resolve(
  import.meta.dirname,
  "node_modules/react-dom/client.js",
);
const JSX_RUNTIME_ENTRY = path.resolve(
  import.meta.dirname,
  "node_modules/react/jsx-runtime.js",
);
const JSX_DEV_RUNTIME_ENTRY = path.resolve(
  import.meta.dirname,
  "node_modules/react/jsx-dev-runtime.js",
);

export default defineConfig({
  base: "/",
  // Tailwind v4 runs as a Vite plugin (no tailwind.config / postcss / autoprefixer);
  // it auto-detects content, theme tokens live in client/src/index.css (@theme).
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: /^react$/, replacement: REACT_ENTRY },
      { find: /^react\/jsx-runtime$/, replacement: JSX_RUNTIME_ENTRY },
      { find: /^react\/jsx-dev-runtime$/, replacement: JSX_DEV_RUNTIME_ENTRY },
      { find: /^react-dom$/, replacement: REACT_DOM_ENTRY },
      { find: /^react-dom\/client$/, replacement: REACT_DOM_CLIENT_ENTRY },
      { find: "@shared", replacement: path.resolve(import.meta.dirname, "shared") },
      { find: "@", replacement: path.resolve(import.meta.dirname, "client/src") },
    ],
  },
  optimizeDeps: {
    // Everything that touches React must be pre-bundled TOGETHER, so they all
    // import the same `deps/react.js`. If one of them is served raw from the
    // pnpm store instead, it gets its own React copy, ReactSharedInternals is
    // null in one of them, and every hook throws "Cannot read properties of
    // null (reading 'useState')".
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@trpc/react-query",
      "@trpc/client",
      "@tanstack/react-query",
    ],
  },
  root: path.resolve(import.meta.dirname, "client"),
  server: {
    port: WEB_PORT,
    host: true,
    // This dev server is reachable from the public internet: a preview share
    // link (platform-side `create_preview_share_link`) proxies straight to this
    // port, and the holder is by definition someone outside the project. Both
    // options below are load-bearing because of that, not general hardening.
    //
    // allowedHosts — Vite's default is `[]`, which 403s every Host header that
    // is not an IP or localhost. Previews work today only because the upstream
    // proxy happens to rewrite Host before the request reaches this process:
    // somebody else's implementation detail standing in for configuration. If
    // that ever changes, every preview turns into "Blocked request" at once,
    // and the failure is invisible from this repo. Naming the domains makes the
    // dependency explicit and survives the day the upstream stops rewriting.
    // Leading dot = that host and any subdomain (Vite's `isHostAllowed`).
    allowedHosts: [
      ".preview.teamily.run",
      ".preview.chainopera.run",
      ".proxy.daytona.works",
    ],
    // fs.allow — the default is the workspace root, i.e. the WHOLE app tree, so
    // `/@fs/<app>/server/routers.ts` hands the server source (auth wiring, tRPC
    // procedure definitions, schema) to anyone holding a preview link. `.env`
    // is denied either way by `fs.deny`, so no credential leaks; what leaks is
    // the map of which procedures are unauthenticated — which is exactly the
    // thing a share-link visitor would need it for.
    //
    // The client only ever needs its own tree plus `shared/` (the `@shared/*`
    // alias). `server/` reaches the client through `import type` alone, which
    // esbuild erases, so it never enters the module graph. Narrowing the list
    // does not break real imports: import analysis marks each resolved module
    // path safe as it is served, which is how node_modules deps stay reachable.
    fs: {
      allow: [
        path.resolve(import.meta.dirname, "client"),
        path.resolve(import.meta.dirname, "shared"),
        path.resolve(import.meta.dirname, "node_modules"),
      ],
    },
    proxy: {
      "/trpc": apiProxy,
      "/app-storage": apiProxy,
      "/api": apiProxy,
    },
  },
  build: {
    // Client build lands in dist/public; the prod server serves it statically.
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
});
