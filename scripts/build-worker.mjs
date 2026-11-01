import esbuild from "esbuild"
import { readFileSync, existsSync } from "fs"

// --- 1. Find entry point from existing build-server.mjs ---
let entry = null
try {
  const old = readFileSync("scripts/build-server.mjs", "utf8")
  const m = old.match(/entryPoints\s*:\s*\[?\s*['"`]([^'"`]+)['"`]/)
  if (m && existsSync(m[1])) entry = m[1]
} catch {}

if (!entry) {
  for (const p of ["src/server/index.ts","src/server.ts","src/index.ts","server/index.ts","src/app.ts","src/main.ts","src/api/index.ts","api/index.ts","src/backend/index.ts","backend/index.ts"]) {
    if (existsSync(p)) { entry = p; break }
  }
}
if (!entry) { console.error("Could not find server entry point"); process.exit(1) }
console.log("Entry point:", entry)

// --- 2. Shim Node.js-only packages ---
const shimCode = {
  "shim:hono": `export function serve(o){globalThis.__HONO_FETCH=o.fetch;return{close(){}}}`,
  "shim:pg": `export default{};export const Pool=class{query(){return Promise.resolve({rows:[]})}};export const Client=class{connect(){}query(){return Promise.resolve({rows:[]})}};export const types={getTypeParser:()=>(v)=>v}`,
  "shim:dotenv": `export function config(){return{}}`,
}
const plugin = {
  name: "workers-shims",
  setup(b) {
    b.onResolve({ filter: /^@hono\/node-server(\/|$)/ }, () => ({ path: "shim:hono", namespace: "shim" }))
    b.onResolve({ filter: /^pg(\/|$)/ }, () => ({ path: "shim:pg", namespace: "shim" }))
    b.onResolve({ filter: /^dotenv(\/|$)/ }, () => ({ path: "shim:dotenv", namespace: "shim" }))
    b.onResolve({ filter: /^cloudflare:/ }, a => ({ path: a.path, external: true }))
    b.onResolve({ filter: /^node:/ }, a => ({ path: a.path, external: true }))
    const bi = ["assert","buffer","child_process","cluster","console","crypto","dgram","dns","events","fs","http","http2","https","inspector","module","net","os","path","perf_hooks","process","punycode","querystring","readline","repl","stream","string_decoder","timers","tls","tty","url","util","vm","worker_threads","zlib"]
    b.onResolve({ filter: new RegExp(`^(${bi.join("|")})$`) }, a => ({ path: `node:${a.path}`, external: true }))
    b.onLoad({ filter: /.*/, namespace: "shim" }, a => ({ contents: shimCode[a.path] || "", loader: "js" }))
  },
}

// --- 3. Bundle for Workers ---
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "neutral",
  target: "es2022",
  format: "esm",
  outfile: "dist/index.js",
  mainFields: ["module", "main"],
  conditions: ["workerd", "browser"],
  plugins: [plugin],
  define: { "process.env.NODE_ENV": '"production"' },
  footer: { js: '\nexport default { fetch: globalThis.__HONO_FETCH || (async () => new Response("Server not initialized", { status: 500 })) };' },
})
console.log("Built dist/index.js for Workers")

