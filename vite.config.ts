import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Client build.
//
// `vite build` writes the SPA to dist/client, which is the directory the
// `assets` binding in wrangler.jsonc serves. There is no separate API build:
// the Worker is bundled by wrangler from server/index.ts.
//
// DEV: `pnpm dev` runs Vite on 5173 and proxies /trpc to `wrangler dev` on 8787,
// so the SPA and the Worker run side by side with HMR. Run both:
//
//     pnpm dev:worker     # terminal 1 — Worker + local D1 on :8787
//     pnpm dev            # terminal 2 — Vite on :5173
//
// `pnpm preview` builds and runs the whole thing on the Worker alone (:8787),
// which is the closest thing to production without deploying.
// ─────────────────────────────────────────────────────────────────────────────

const WEB_PORT = Number(process.env.PORT ?? 5173);
const WORKER_PORT = Number(process.env.WORKER_PORT ?? 8787);
const apiProxy = { target: `http://localhost:${WORKER_PORT}`, changeOrigin: true };

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
const JSX_RUNTIME_ENTRY = path.resolve(import.meta.dirname, "node_modules/react/jsx-runtime.js");
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
    // null in one of them, and every hook throws.
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
    // The client only ever needs its own tree plus `shared/` (the `@shared/*`
    // alias). `server/` reaches the client through `import type` alone, which
    // esbuild erases, so it never enters the module graph — and keeping it out
    // of fs.allow means the API surface is not readable from the dev server.
    fs: {
      allow: [
        path.resolve(import.meta.dirname, "client"),
        path.resolve(import.meta.dirname, "shared"),
        path.resolve(import.meta.dirname, "node_modules"),
      ],
    },
    proxy: {
      "/trpc": apiProxy,
      "/api": apiProxy,
    },
  },
  build: {
    // Workers Assets serves this directory (wrangler.jsonc → assets.directory).
    outDir: path.resolve(import.meta.dirname, "dist/client"),
    emptyOutDir: true,
  },
});
