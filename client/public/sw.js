/* Dayline service worker.
 *
 * Three jobs:
 *   1. Precache the full app shell at install time, so the installed PWA opens
 *      instantly with the network fully off — no HTTP handshake at all.
 *   2. Serve the shell cache-first, and fall back to the cached index.html for
 *      any client-side navigation.
 *   3. Show reminder notifications (the page hands them over via postMessage).
 *
 * API calls (/trpc, /app-storage) are NEVER cached: a stale activity log would
 * be worse than an honest error — the offline-first data lives in IndexedDB,
 * not here.
 */

// Bump this on any shell change to force a fresh precache and clean old caches.
const VERSION = "v2";
const CACHE = `dayline-shell-${VERSION}`;

// Everything the shell needs to boot offline. The hashed build assets
// (/assets/*) are precached at runtime from the built index.html, so this list
// only carries the entry points and static icons/fonts that are not hashed.
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll(PRECACHE).catch(() => undefined);
        // Precache the hashed JS/CSS that the built index.html references, so a
        // cold start has zero network requests.
        try {
          const resp = await fetch("/index.html", { cache: "no-store" });
          const html = await resp.text();
          const assets = [
            ...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
          ].map((m) => m[1]);
          await cache.addAll([...new Set(assets)]).catch(() => undefined);
        } catch {
          // Offline during install — the shell still precaches; assets fill in
          // on the first successful navigation.
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the API or storage: those must always be live.
  if (url.pathname.startsWith("/trpc") || url.pathname.startsWith("/app-storage")) return;

  // Navigations: cache-first (so the installed app loads with the network off),
  // then network as a background refresh.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("/index.html").then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => undefined);
            }
            return res;
          })
          .catch(() => cached ?? Response.error());
        return cached ?? network;
      }),
    );
    return;
  }

  // Static assets: cache-first, then network (and remember it).
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request)
          .then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
            }
            return res;
          })
          .catch(() => Response.error()),
    ),
  );
});

/* The page posts { type: "SHOW_REMINDER", ... } once a reminder comes due. */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "SHOW_REMINDER") return;

  const title = data.title || "Dayline";
  const options = {
    body: data.body || "Time to log an activity.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "dayline-reminder",
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || "/log", reminderId: data.reminderId || null },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/log";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
