# Dayline — Daily Activity Tracker

An installable, offline-first PWA for logging how you actually spend your days. Log
exercise, work, reading, sleep and ten other categories, set per-category daily or
weekly goals, and see where the time went through a dashboard of charts, streaks and
goal rings.

It works with the network completely off. Every read and write goes to IndexedDB
first; a background sync engine reconciles with Postgres when a connection exists.

---

## What's in it

| Area | Detail |
|---|---|
| **Accounts** | Email + password sign-up/login, bcrypt hashes, httpOnly JWT session cookie |
| **Data model** | `activities` (14 categories, duration, date, start time, notes, intensity, location, tags), `goals` (per-category daily/weekly targets), seeded `categories` |
| **Dashboard** | Today's summary cards, 7-day stacked bar chart, category donut, goal progress rings, time-of-day heatmap, per-category streaks, recent entries |
| **Log** | Add/edit an activity with quick-pick durations, tag chips, date shortcuts |
| **History** | Filter by range, category, intensity, location, tag and free text; grouped by day with per-day totals; edit and delete |
| **Offline** | IndexedDB as source of truth, outbox queue, last-write-wins merge, soft deletes |
| **PWA** | Manifest, maskable icons, install button, service worker with full shell precache |

**Deliberately not included:** reminders/notifications, live stopwatch, sharing/teams,
CSV export, mood/energy ratings.

> **Note on leftover modules.** `shared/reminders.ts`, `shared/team.ts`,
> `shared/timer.ts`, `shared/export.ts`, `server/db-extras.ts`,
> `client/src/lib/report-pdf.ts` and `client/src/pages/_probe.ts` are unused
> remnants of an earlier, wider build. Nothing imports them, no route reaches
> them, and they are not part of the shipped app — but they are included here so
> the package matches the source tree exactly. They typecheck and their tests
> pass. Delete them freely; the app does not depend on them.

---

## Project structure

```
dayline/
├── client/                     # React 19 SPA (Vite root)
│   ├── index.html              # shell + PWA meta tags
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   ├── sw.js               # service worker: precache, cache-first, nav fallback
│   │   └── icons/              # 192, 512, maskable-512, apple-touch-icon
│   └── src/
│       ├── main.tsx            # entry; registers the service worker
│       ├── App.tsx             # routes (wouter)
│       ├── index.css           # Tailwind v4 @theme tokens (warm palette)
│       ├── _core/              # platform SDK: trpc client, auth hook, guards
│       ├── components/         # AppShell, Charts, GoalRings, SyncStatus, InstallApp
│       ├── hooks/              # useActivityLog, useOfflineStore, useSync
│       ├── lib/
│       │   ├── idb.ts          # IndexedDB wrapper (activities/goals/outbox/meta)
│       │   ├── syncEngine.ts   # push/pull, LWW merge, BroadcastChannel
│       │   └── notifications.ts# SW registration + isStandalone
│       └── pages/              # Dashboard, LogActivity, History, Login, Register
├── server/
│   ├── _core/                  # platform SDK: Hono app, tRPC, auth, db, env
│   ├── db.ts                   # all queries (owner-scoped), sync pull/push, seeding
│   └── routers.ts              # tRPC procedures
├── shared/                     # code used by BOTH client and server
│   ├── activities.ts           # category slugs, validation, formatting
│   ├── analytics.ts            # summaries, streaks, series, heatmap buckets
│   ├── sync.ts                 # merge helpers, outbox + sync row types
│   ├── sample-data.ts          # deterministic 5-week seed generator
│   └── constants.ts, types.ts
├── drizzle/
│   ├── schema.ts               # Drizzle table definitions
│   └── migrations/             # ordered SQL + meta snapshots (source of truth)
├── scripts/                    # build-server.mjs, apply-sql.mjs, record-migration.mjs
├── vite.config.ts              # React dedupe/alias, dev proxy, build output
├── vitest.config.ts
├── drizzle.config.ts
├── tsconfig.json
├── package.json
└── pnpm-lock.yaml
```

---

## Install and run locally

**Prerequisites:** Node ≥ 20.19, pnpm 11, and a Postgres 14+ database.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
#    then edit .env — at minimum DATABASE_URL and JWT_SECRET

# 3. Create the database (if it doesn't exist)
createdb dayline

# 4. Run migrations
pnpm db:migrate

# 5. Start dev (Vite on :3000, API on :3001, proxied)
pnpm dev
```

Open <http://localhost:3000>, click **Create account**, and sign up. The first sync
pull seeds your account with ~5 weeks of sample activities and five starter goals, so
the dashboard is populated immediately. (Seeding is idempotent — it only runs when the
account has zero activities.)

### Database setup notes

- **Migrations are the source of truth.** `drizzle/migrations/*.sql` are ordered and
  applied by `drizzle-kit migrate`. Never diff a live database to generate schema.
- The `categories` table is seeded **inside a migration** (`0003`, revised in `0005`),
  not by a seed script — so the 14 categories exist in production too.
- `drizzle-kit` always connects over TCP using `DATABASE_URL`. On Neon, use the
  **direct** (non-pooler) connection string for migrations.
- To change the schema: edit `drizzle/schema.ts`, then `pnpm db:generate` to emit a
  new migration, then `pnpm db:migrate`.

### Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite + API with HMR |
| `pnpm typecheck` | `tsc --noEmit` across client, server, shared |
| `pnpm test` | Vitest (19 suites) |
| `pnpm db:generate` | Emit a migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm build` | Build client → `dist/public`, bundle server → `dist/index.js` |
| `pnpm start` | Run the production server |

---

## Build for production

```bash
pnpm build     # client to dist/public, server bundled to dist/index.js
NODE_ENV=production pnpm start
```

One Hono process serves both the static SPA from `dist/public` and the tRPC API on
`PORT`. There is no Vite in production.

> **Note on served vs. packaged code:** the live app's served files are minified and
> content-hashed by the host's build pipeline. This package contains the readable
> source — the same code, before minification.

---

## How offline-first sync works

### Local store is the source of truth

`client/src/lib/idb.ts` opens IndexedDB database `dayline` (v1) with four stores:

| Store | Key | Contents |
|---|---|---|
| `activities` | `id` | full activity rows, including `updatedAt` / `deletedAt` |
| `goals` | `id` | per-category targets |
| `outbox` | `id` | queued mutations awaiting push |
| `meta` | `key` | last sync timestamp, cached user |

Every UI read comes from IndexedDB, never from the network. Every write goes to
IndexedDB **and** appends an outbox entry with a client-generated UUID
(`crypto.randomUUID()`) and a timestamp. The UI never waits on the server, which is
why logging works identically online and offline.

### Push / pull

`client/src/lib/syncEngine.ts` runs two directions:

- **Push** — send queued outbox mutations to `sync.push`. The server upserts by id,
  scoped to the owner, and returns the accepted rows.
- **Pull** — fetch the owner's full store via `sync.pull` and merge it in.

### Merge rules

Both directions use the helpers in `shared/sync.ts`:

- **Last-write-wins on `updatedAt`.** The newer ISO timestamp wins; ties keep local.
- **Soft deletes.** Deleting sets `deletedAt` rather than removing the row, so a
  tombstone propagates to other devices instead of being resurrected by a stale copy.
  `isLive()` filters tombstones out of every read.
- **Goals merge by category**, not by id, because a goal is unique per
  (owner, category) — enforced by a unique index server-side.

### When sync runs

- On app start
- On the `online` event (reconnect)
- Every 60 seconds
- Immediately after each mutation
- On a `BroadcastChannel` message from another tab

### Multi-tab and multi-device

- **Same browser, multiple tabs:** a `BroadcastChannel` named `dayline-sync` posts
  `local-change` after every mutation; other tabs re-sync immediately.
- **Different devices:** the 60-second interval plus the on-start pull. There is no
  websocket — the polling fallback is the mechanism, and it is what makes a change on
  your phone appear on your desktop within a minute without a manual refresh.

### Status indicator

`SyncStatus` shows **synced** / **syncing** / **offline with N pending**, plus a
manual **Sync now** action. Pending count comes straight from the outbox length.

---

## How the service worker works

`client/public/sw.js`, registered from `main.tsx` with scope `/`.

**Install** — opens a versioned cache (`dayline-shell-v2`) and precaches the shell:
`/`, `/index.html`, the manifest, and all four icons. It then fetches `/index.html`,
parses out every `/assets/*` reference, and precaches those hashed JS/CSS bundles too.
That second step is what makes a true zero-network cold start possible: the hashed
filenames aren't known until build time, so they're discovered at install.

**Activate** — deletes every cache whose name isn't the current one, then
`clients.claim()` so the new worker controls open pages immediately.

**Fetch**

- Non-GET, cross-origin, `/trpc` and `/app-storage` requests are **never** cached —
  a stale activity log would be worse than an honest error.
- **Navigations** are cache-first from `/index.html`, with a background network
  refresh. This is the navigation fallback: every route (`/log`, `/history`, …) is
  served the cached shell, and the client router takes it from there.
- **Static assets** are cache-first, then network, and successful responses are
  written back to the cache.

**Bump `VERSION`** in `sw.js` on any shell change to force a fresh precache and clean
out the old cache.

### Install prompt

`components/InstallApp.tsx` captures `beforeinstallprompt`, prevents the default
mini-infobar, and shows an in-app **Install app** button that calls `prompt()`. On iOS
Safari — which never fires that event — it shows Share → *Add to Home Screen*
instructions instead. The button hides itself when the app is already running
standalone (`isStandalone()`).

---

## Deploying

The app is a single Node process plus Postgres, so anything that runs containers or
Node works.

1. **Provision Postgres** and set `DATABASE_URL` (direct/non-pooler for migrations).
2. **Set environment variables** — `DATABASE_URL`, `JWT_SECRET`, `AUTH_PROVIDER=local`,
   `NODE_ENV=production`, `PORT`. Never commit `.env`.
3. **Run migrations** as a release step: `pnpm db:migrate`.
4. **Build and start:** `pnpm install --frozen-lockfile && pnpm build && pnpm start`.

A `Dockerfile` is included. Two things matter for the PWA in production:

- **Serve over HTTPS.** Service workers and install prompts require a secure origin
  (`localhost` is exempt).
- **Don't cache `sw.js` itself.** Serve it with `Cache-Control: no-cache` so browsers
  pick up new versions promptly. The hashed `/assets/*` files are safe to cache
  immutably.

If you deploy behind a path prefix, note that `vite.config.ts` sets `base: "/"` — the
app assumes it owns the origin root.

---

## Testing

```bash
pnpm test        # 19 suites: analytics, streaks, sync merge, auth, routers, db
pnpm typecheck   # strict, noUnusedLocals, noUnusedParameters
```

Coverage focuses on the parts where a bug is silent: date arithmetic across timezones,
streak edge cases (today not yet logged but the streak alive), heatmap bucket
splitting, LWW merge ordering, tombstone handling, owner scoping on every query, and
input validation.

---

## License

Provided as-is for the project it was built for.
