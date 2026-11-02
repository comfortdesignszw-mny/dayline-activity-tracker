# Dayline

An offline-first daily activity tracker. Log what you did, see where the time
went, and keep a streak — on a phone, on a laptop, on a plane with the Wi-Fi
off. Built as an installable PWA on **Cloudflare Workers + D1**.

- **Dashboard** — today's totals, a 7-day stacked bar chart, a category donut,
  per-category goal rings, a time-of-day heatmap, streaks, recent entries.
- **Log** — 14 categories, duration, date, start time, notes, intensity,
  location, free-form tags.
- **History** — the full log grouped by day, filterable by range, category,
  intensity, location and tag; edit and delete in place.
- **Goals** — a daily or weekly minute target per category.
- **Offline-first** — IndexedDB is the source of truth. Every mutation queues in
  an outbox and syncs when the network returns. Last-write-wins on `updated_at`,
  with soft deletes so a deletion made offline still propagates.
- **Installable** — a service worker precaches the whole shell, so the installed
  app cold-starts with zero network requests.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers | One deployable unit serves both the API and the SPA |
| Database | Cloudflare D1 (SQLite) | Serverless SQL at the edge, no connection pool to manage |
| ORM | Drizzle (`drizzle-orm/d1`) | Typed queries; the schema is the single source of truth |
| API | tRPC 11 over Hono | End-to-end types with no codegen step |
| Client | React 19 + Vite 8 + Tailwind 4 | Fast HMR, no runtime CSS |
| Auth | Email + password, PBKDF2-SHA256 via Web Crypto, JWT in an httpOnly cookie | No Node crypto, no bcrypt CPU cost on a Worker |
| Offline | IndexedDB + outbox + service worker | Works with the network fully off |

---

## Project structure

```
.
├── client/                     # React SPA
│   ├── index.html
│   ├── public/
│   │   ├── manifest.webmanifest    # PWA manifest
│   │   ├── sw.js                   # service worker (shell precache)
│   │   └── icons/                  # 192, 512, maskable-512, apple-touch
│   └── src/
│       ├── main.tsx                # providers, SW registration, sync init
│       ├── App.tsx                 # routes
│       ├── pages/                  # Dashboard, LogActivity, History, Login, Register
│       ├── components/             # AppShell, Charts, GoalRings, SyncStatus, InstallApp
│       ├── hooks/                  # useOfflineStore, useActivityLog, useSync
│       ├── lib/
│       │   ├── idb.ts              # IndexedDB stores
│       │   └── syncEngine.ts       # push/pull, outbox, BroadcastChannel
│       └── _core/                  # trpc client, auth context, route guard
├── server/
│   ├── index.ts                # Worker entry (fetch handler)
│   ├── routers.ts              # tRPC API surface
│   ├── db.ts                   # data access + sync merge
│   └── _core/                  # env, D1 handle, auth, context, trpc, cookies
├── shared/                     # code used by BOTH sides
│   ├── activities.ts           # the 14 categories, validation, tag helpers
│   ├── analytics.ts            # streaks, goal progress, heatmap, series
│   ├── sync.ts                 # merge rules (LWW), row shapes
│   └── sample-data.ts          # first-run seed
├── drizzle/schema.ts           # SQLite schema (Drizzle)
├── migrations/                 # D1 SQL migrations (wrangler applies these)
├── scripts/seed.mjs            # apply migrations + verify seeded categories
├── wrangler.jsonc              # Worker, D1 binding, assets config
├── vite.config.ts              # SPA build → dist/client
└── .github/workflows/deploy.yml
```

---

## Prerequisites

- **Node.js 20.19+** (22 recommended)
- **pnpm 11** — `npm i -g pnpm@11`
- A **Cloudflare account** (free tier is enough) — only needed to deploy

---

## Run it locally

```bash
pnpm install
cp .dev.vars.example .dev.vars     # then set JWT_SECRET (see below)
pnpm db:migrate                    # create the local D1 schema + seed categories
pnpm dev:worker                    # Worker + local D1 on http://localhost:8787
```

That single command is enough — the Worker serves the built SPA *and* the API.
Open <http://localhost:8787>, sign up, and the account is seeded with ~5 weeks of
sample entries and five starter goals.

For **hot reload** while editing the client, run two terminals:

```bash
pnpm dev:worker     # terminal 1 — API + D1 on :8787
pnpm dev            # terminal 2 — Vite on :5173, proxies /trpc to :8787
```

Then use <http://localhost:5173>.

### Generating `JWT_SECRET`

```bash
openssl rand -base64 48
```

Paste it into `.dev.vars`. In development a missing secret falls back to a
dev-only value; **in production the Worker refuses to start without it**, because
the alternative is signing every session with a value an attacker can read out of
the repo.

### Database setup

D1 is SQLite, and `wrangler dev` keeps a **local** copy under
`.wrangler/state/` — no Postgres, no Docker, no connection string. The schema
lives in `migrations/0001_init.sql` and is applied by:

```bash
pnpm db:migrate          # local
pnpm db:migrate:remote   # the real database (after `wrangler d1 create`)
```

The fourteen categories are **seeded inside the migration**, not by a separate
script, so a freshly created database is usable immediately. `pnpm db:seed` runs
the migrations and then asserts that all 14 categories are present — useful in CI
or after a manual `d1 create`.

Inspect the local database at any time:

```bash
pnpm db:console "select category, count(*) from activities group by category"
```

---

## Build for production

```bash
pnpm build
```

This writes the SPA to `dist/client`, which is the directory the `assets` binding
in `wrangler.jsonc` serves. The Worker itself is bundled by wrangler from
`server/index.ts` at deploy time — there is no separate server build step.

---

## How offline-first sync works

**IndexedDB is the source of truth.** The UI never waits on the network: every
read comes from the local store, and every write lands there first.

1. **Write** — a mutation is written to IndexedDB, applied to React state
   optimistically, and appended to an `outbox` store with a client-generated
   UUID and a timestamp.
2. **Push** — the sync engine sends the queued rows to `sync.push`. The outbox is
   cleared only after the server accepts them, so a failed push is retried rather
   than lost.
3. **Pull** — `sync.pull` returns the user's full store, which is merged into
   IndexedDB.
4. **Merge** — last-write-wins on `updated_at`. A row whose stored `updated_at`
   is newer than the incoming one is left untouched, so a slow device pushing a
   stale edit cannot roll back a newer one. Deletions are **soft**: a `deleted_at`
   tombstone travels like any other field, so a delete made offline still beats a
   stale live copy from another device.
5. **Triggers** — sync runs on app start, on the `online` event, every 60
   seconds, and immediately after each mutation.
6. **Multi-tab / multi-device** — a `BroadcastChannel` tells other tabs in the
   same browser to re-sync; other devices converge on the next pull.

The status indicator in the sidebar shows **Synced**, **Syncing**, or
**Offline · N pending**, and offers a manual **Sync now**.

> **Why the API is never cached.** The service worker deliberately does not
> intercept `/trpc` or `/api`. A cached API response would let the sync engine
> believe it had reconciled when it had not. Letting those requests fail fast is
> what makes "offline · N pending" honest.

---

## How the service worker works

`client/public/sw.js`:

- **Install** — precaches the shell (`/`, `/index.html`, the manifest, the four
  icons) *and* the hashed JS/CSS referenced by the built `index.html`, so a cold
  start needs no network at all.
- **Fetch** — cache-first for the shell and static assets. Navigations fall back
  to the cached `index.html`, which is what makes a deep link like `/history`
  work offline.
- **Activate** — deletes every cache whose name is not the current version.
- **Versioning** — bump `VERSION` in `sw.js` on any shell change; the old cache
  is cleaned up automatically.

**Deploy note:** serve `sw.js` with `Cache-Control: no-cache` so browsers pick up
a new version promptly. Workers Assets does this for you.

---

## Deploying

### 1. Log in

```bash
npx wrangler login
```

### 2. Create the D1 database

```bash
npx wrangler d1 create dayline
```

This prints a `database_id`. **Paste it into `wrangler.jsonc`**, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`. It is left as a placeholder on purpose: a
deploy then fails loudly with "database not found" instead of silently creating a
second database.

### 3. Apply the schema to the real database

```bash
pnpm db:migrate:remote
```

### 4. Set the secret

```bash
npx wrangler secret put JWT_SECRET
```

### 5. Deploy

```bash
pnpm deploy          # builds, then `wrangler deploy`
```

Your app is live at `https://dayline.<your-subdomain>.workers.dev`.

### Wiring the GitHub repo to Cloudflare

1. Push this repo to GitHub.
2. Create an API token at **Cloudflare dashboard → My Profile → API Tokens →
   Create Token**, using the **Edit Cloudflare Workers** template. Add the
   **D1 Edit** permission.
3. Copy your **Account ID** from the Workers dashboard sidebar.
4. In the GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**, and add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. Push to `main`. `.github/workflows/deploy.yml` typechecks, tests, builds,
   applies migrations, then deploys. Pull requests run the checks but never
   deploy.

**Pages vs Workers.** This project deploys as a **Worker with static assets**
(`assets` in `wrangler.jsonc`), not as a separate Pages project — one deployable
unit, one origin, no CORS. If you would rather host the SPA on Pages and the API
on a Worker, build with `VITE_API_URL=https://your-worker.workers.dev pnpm build`
and upload `dist/client` to Pages; the client reads that variable at build time.

---

## Testing

```bash
pnpm typecheck
pnpm test
```

Tests cover the API surface (auth, owner scoping, validation), password hashing,
the sync merge rules, analytics (streaks, goal progress, heatmap bucketing), and
the service-worker-independent client helpers.

---

## Notes and limitations

- **Single currency of time.** Durations are whole minutes; a single entry is
  capped at 24 hours.
- **No reminders, stopwatch, teams, or CSV export.** These were deliberately out
  of scope for this build.
- **Sample data is per account.** A new signup is seeded once; the seeder is
  idempotent and does nothing once the account has rows.
- **The live app's served files are minified** by the host. This repository
  contains the readable source.
