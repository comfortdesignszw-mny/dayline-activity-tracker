/**
 * Workers build script for dayline-activity-tracker
 *
 * This script replaces scripts/build-server.mjs for Cloudflare Workers deploys.
 * It bundles the existing Hono server for the Workers runtime by:
 *   1. Shimming @hono/node-server (serve() → no-op, captures app.fetch)
 *   2. Shimming pg (use @neondatabase/serverless instead)
 *   3. Shimming dotenv (Workers env vars are available via process.env with nodejs_compat)
 *   4. Marking node:* and cloudflare:* as external (available at runtime)
 *   5. Appending `export default { fetch }` so Wrangler sees an ES Module Worker
 */

import esbuild from 'esbuild';
import { existsSync } from 'fs';

// ── Plugin: shim Node.js-only packages & handle externals ──────────────
const workersPlugin = {
  name: 'workers-shims',
  setup(build) {
    // Shim @hono/node-server — capture the fetch handler from serve()
    build.onResolve({ filter: /^@hono\/node-server(\/.*)?$/ }, () => ({
      path: 'shim:hono-node-server',
      namespace: 'shim',
    }));

    // Shim pg — the app should use @neondatabase/serverless on Workers
    build.onResolve({ filter: /^pg(\/.*)?$/ }, () => ({
      path: 'shim:pg',
      namespace: 'shim',
    }));

    // Shim dotenv — Workers env vars are available via process.env (nodejs_compat)
    build.onResolve({ filter: /^dotenv(\/.*)?$/ }, () => ({
      path: 'shim:dotenv',
      namespace: 'shim',
    }));

    // Mark cloudflare:* as external (Workers built-in modules)
    build.onResolve({ filter: /^cloudflare:/ }, (args) => ({
      path: args.path,
      external: true,
    }));

    // Mark node:* as external (available with nodejs_compat flag)
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      external: true,
    }));

    // Redirect bare Node.js built-in names to node: prefix & mark external
    const bareBuiltins = [
      'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto',
      'dgram', 'dns', 'events', 'fs', 'http', 'http2', 'https', 'inspector',
      'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
      'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers',
      'tls', 'tty', 'url', 'util', 'vm', 'worker_threads', 'zlib',
    ];
    const builtinsFilter = new RegExp(`^(${bareBuiltins.join('|')})$`);
    build.onResolve({ filter: builtinsFilter }, (args) => ({
      path: `node:${args.path}`,
      external: true,
    }));

    // Shim contents
    build.onLoad({ filter: /.*/, namespace: 'shim' }, (args) => {
      const shims = {
        'shim:hono-node-server': `
          export function serve(opts) {
            globalThis.__HONO_FETCH = opts.fetch;
            return { close() {} };
          }
          export function getRequestListener() { return () => {}; }
        `,
        'shim:pg': `
          export default {};
          export const Pool = class { constructor() {} query() { return Promise.resolve({ rows: [] }); } end() {} };
          export const Client = class { constructor() {} connect() {} query() { return Promise.resolve({ rows: [] }); } end() {} };
          export const types = { getTypeParser: () => (v) => v, setTypeParser: () => {} };
          export const defaults = {};
          export const Query = class {};
        `,
        'shim:dotenv': `
          export function config() { return {}; }
          export const parse = () => ({});
        `,
      };
      return {
        contents: shims[args.path] || '',
        loader: 'js',
      };
    });
  },
};

// ── Find the server entry point ────────────────────────────────────────
const entryPaths = [
  'src/server/index.ts',
  'src/server.ts',
  'src/index.ts',
  'server/index.ts',
  'src/app.ts',
];

let entryPoint = null;
for (const p of entryPaths) {
  if (existsSync(p)) {
    entryPoint = p;
    break;
  }
}

if (!entryPoint) {
  console.error(
    '✘ Could not find server entry point.\n' +
    '  Please set entryPoints manually in scripts/build-worker.mjs\n' +
    '  Tried: ' + entryPaths.join(', ')
  );
  process.exit(1);
}

console.log(`Building Workers bundle from ${entryPoint}...`);

// ── Bundle for Workers ─────────────────────────────────────────────────
await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'neutral',
  target: 'es2022',
  format: 'esm',
  outfile: 'dist/index.js',
  conditions: ['workerd', 'browser'],
  plugins: [workersPlugin],
  loader: { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx' },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // Append a default export so Wrangler sees an ES Module Worker.
  // globalThis.__HONO_FETCH is set by the @hono/node-server shim when
  // serve({ fetch: app.fetch }) is called during module initialisation.
  footer: {
    js: '\nexport default { fetch: globalThis.__HONO_FETCH || (async () => new Response("Server not initialized", { status: 500 })) };',
  },
});

console.log('\n  ⚡ dist/index.js  built for Workers\n');
