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

const CACHE_NAME = "mmt-v48";

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
  "./app.js",
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
  "./icons/icon-32x32.png?v=20",
  "./icons/icon-72x72.png?v=20",
  "./icons/icon-96x96.png?v=20",
  "./icons/icon-128x128.png?v=20",
  "./icons/icon-144x144.png?v=20",
  "./icons/icon-152x152.png?v=20",
  "./icons/icon-180x180.png?v=20",
  "./icons/icon-192x192.png?v=20",
  "./icons/icon-384x384.png?v=20",
  "./icons/icon-512x512.png?v=20",
  "./icons/splash-1170x2532.png?v=20",
  "./icons/splash-1125x2436.png?v=20",
  "./icons/splash-750x1334.png?v=20",
];

/* INSTALL - fired once per new CACHE_NAME. Pre-fetch every asset so the very
   first offline load already has everything.

   addAll is all-or-nothing: if any single file in ASSETS 404s the whole
   install fails and the old worker stays active. That is the desired
   behaviour for those - a half populated cache would serve a broken app.
   The launch images that follow are deliberately NOT held to it; see the
   note on LAUNCH_IMAGES.

   skipWaiting stops the new worker queueing behind the old one. Without it a
   fresh version sits idle until every tab is closed, which on an installed
   PWA can be days. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS).then(() =>
        /* Tolerant, one at a time: a launch image that 404s is logged by the
           browser and skipped, and the install still succeeds. See the note on
           LAUNCH_IMAGES for why these must not be able to fail the install. */
        Promise.all(LAUNCH_IMAGES.map((url) =>
          cache.add(url).catch(() => {})
        ))
      )
    )
  );
  self.skipWaiting();
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
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* FETCH - cache-first with background revalidation.

   The cached copy is returned immediately, so the app opens instantly and
   works with no connection. In parallel a real network request runs and
   quietly overwrites the cache for next time.

   The consequence, and the reason a deploy can look like it did not land:
   this load is served from cache, and the fresh files only arrive after it.
   A new version therefore appears on the SECOND open after deploying. When
   testing an edit, unregister the worker and clear caches or you will keep
   reading stale JavaScript and chase a bug that is not there. */
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          /* Only cache successes. Without this guard a 404 or a captive
             portal's interception page gets stored and then served happily
             offline forever. */
          if (response.ok) {
            /* A response body can only be read once, so the copy going into
               the cache has to be cloned before the original is returned. */
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        /* Offline: the network rejected, so fall back to whatever was cached.
           Resolves to undefined for an uncached URL, which surfaces as a
           normal navigation failure. */
        .catch(() => cached);

      /* Cache hit wins immediately; the fetch above keeps running to refresh
         it. On a miss, the network promise is the response. */
      return cached || fetchPromise;
    })
  );
});
