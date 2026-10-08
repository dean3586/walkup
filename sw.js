// Walk-Up Music Service Worker
const CACHE_VERSION = 'walkup-v31';
const STATIC_ASSETS = [
  './',
  'index.html',
  'app.js',
  'styles.css',
  'roster.json',
  'manifest.json',
  'logo.png',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

// Install: precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    // cache: 'reload' skips the browser's HTTP cache, which GitHub Pages lets
    // hold files for 10 minutes; otherwise a new version could be installed
    // with the previous version's app.js.
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => caches.keys())
      .then((keys) => {
        // Pages from walkup-v30 and earlier cannot ask for the switch, so
        // take over from them straight away, as those versions did.
        const fromOldApp = keys.some((k) => {
          const m = /^walkup-v(\d+)$/.exec(k);
          return m && Number(m[1]) <= 30;
        });
        if (fromOldApp) return self.skipWaiting();
      })
  );
});

// A new version waits until the app asks it to take over, which the app does
// only when nothing is playing (see "automatic updates" in app.js).
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for GET requests
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Skip non-http(s) schemes (e.g. blob: from object URLs)
  if (!url.protocol.startsWith('http')) return;
  // Only the app's own files are cached. Settings (Supabase), song lookups
  // and song audio (Deezer) always go to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Background revalidate
        fetch(event.request)
          .then((res) => {
            if (res && res.ok) {
              caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, res.clone()));
            }
          })
          .catch(() => {});
        return cached;
      }
      return fetch(event.request)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => {
          // Offline fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('index.html');
          }
        });
    })
  );
});
