/* =========================
   SERVICE WORKER (OFFLINE CACHE)

   Makes the app work with no network at all: every file it needs is copied
   into the cache on install and served from there afterwards.

   The one rule that matters: CACHE_NAME must be bumped on every release.
   The activate handler below deletes any cache whose name does not match,
   so a new name is what evicts the old files. Ship a code change without
   touching this string and users keep running the old version forever -
   their browser never has a reason to look at the network again.
========================= */

const CACHE_NAME = "mmt-v67";

/* Everything needed to cold-start the app offline. "./" is listed separately
   from "./index.html" because that is the URL the browser actually requests
   when the PWA opens from the home screen, and a cache miss on it would show
   the offline error page instead of the app.

   money.js is here for the same reason index.html loads it first: app.js
   calls its functions as globals and breaks without it. */
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./money.js",
  "./ui-helpers.js",
  "./app.js",
  "./pwa.js",
  "./manifest.json",
];

/* LAUNCH IMAGES - the icon and the iOS startup images.

   These were missing, and their absence was visible: iOS paints the startup
   image while the app opens, and when it cannot get the file it paints white
   instead. Nothing here had cached them, so every cold open went to the
   network for one - and the app flashed white on the way in.

   The ?v= must match the query the markup and manifest actually request,
   because a cache lookup keys on the whole URL, query included. Bump both
   together when the artwork changes.

   Kept separate from ASSETS above because they are fetched TOLERANTLY below:
   addAll is all-or-nothing, and a single missing icon failing the install
   would strand every user on the old worker - a far worse outcome than a
   launch image that has to come from the network. */
const LAUNCH_IMAGES = [
  "./icons/icon-32x32.png?v=21",
  "./icons/icon-72x72.png?v=21",
  "./icons/icon-96x96.png?v=21",
  "./icons/icon-128x128.png?v=21",
  "./icons/icon-144x144.png?v=21",
  "./icons/icon-152x152.png?v=21",
  "./icons/icon-180x180.png?v=21",
  "./icons/icon-192x192.png?v=21",
  "./icons/icon-384x384.png?v=21",
  "./icons/icon-512x512.png?v=21",
  "./icons/splash-1170x2532.png?v=21",
  "./icons/splash-1125x2436.png?v=21",
  "./icons/splash-750x1334.png?v=21",
];

/* INSTALL - fired once per new CACHE_NAME. Pre-fetch every asset so the very
   first offline load already has everything.

   addAll is all-or-nothing: if any single file in ASSETS 404s the whole
   install fails and the old worker stays active. That is the desired
   behaviour for those - a half populated cache would serve a broken app.
   The launch images that follow are deliberately NOT held to it; see the
   note on LAUNCH_IMAGES.

   The worker deliberately waits after installation. The page detects that
   waiting state and offers a visible Refresh action, so an update never
   interrupts a form or silently swaps code underneath an open session. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS.map(url => new Request(new URL(url, self.registration.scope), { cache: "reload" }))).then(() =>
        /* Tolerant, one at a time: a launch image that 404s is logged by the
           browser and skipped, and the install still succeeds. See the note on
           LAUNCH_IMAGES for why these must not be able to fail the install. */
        Promise.all(LAUNCH_IMAGES.map((url) =>
          cache.add(new Request(new URL(url, self.registration.scope), { cache: "reload" })).catch(() => {})
        ))
      )
    )
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

/* ACTIVATE - delete every cache except the current one. This is the eviction
   step that makes bumping CACHE_NAME work.

   clients.claim takes over pages that are already open, so the new worker
   controls this load rather than only the next one. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => /^mmt-v\d+$/.test(key) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* Serve a complete release from its own cache until the user accepts the
   next one. Mixing fresh HTML with yesterday's scripts breaks offline apps. */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const navigation = event.request.mode === "navigate";
  const key = navigation ? new URL("./index.html", scope).href : event.request;
  const cacheable = navigation || [...ASSETS, ...LAUNCH_IMAGES]
    .some(asset => new URL(asset, scope).href === url.href);
  if (!cacheable) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(key);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch {
      return Response.error();
    }
  }));
});
